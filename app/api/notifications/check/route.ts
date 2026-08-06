import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient, cronSecretOk } from '@/lib/supabase/service'
import { sendAlertEmail } from '@/lib/email'
import { enforce, LIMITS } from '@/lib/rateLimit'
import { log, errText } from '@/lib/logger'

// Threshold + liveness alerting.
//
// Two ways in, ONE implementation underneath (`sweep`):
//
//   POST /api/notifications/check                    → the signed-in user only.
//                                                      NotificationBell still polls this.
//   POST /api/notifications/check + x-cron-secret    → every user, every active device.
//                                                      Driven by woongezond-notifications.timer.
//
// The cron path is the point: before it, alerts only fired while somebody had the
// dashboard open in a browser tab, which for an unattended 10-household pilot means
// they effectively never fired.
//
// Everything here is DEVICE-scoped, not user-scoped. The old version took "the latest
// reading for this user" with no device filter, so on a multi-device account one busy
// device masked a quiet problem on another (ROADMAP M3, CALCULATIONS §8-9).

export const dynamic = 'force-dynamic'

const DEFAULTS: Record<string, { warning: number; critical: number }> = {
  co2: { warning: 1000, critical: 1500 },
  humidity: { warning: 65, critical: 75 },
}
const METRIC_META: Record<string, { name: string; unit: string }> = {
  co2: { name: 'CO₂', unit: 'ppm' },
  humidity: { name: 'Luchtvochtigheid', unit: '%' },
}

const THRESHOLD_RATE_LIMIT_MS = 2 * 60 * 60 * 1000 // 2h — don't nag about a stuck-open window
const OFFLINE_RATE_LIMIT_MS = 12 * 60 * 60 * 1000 // 12h — one reminder per half-day is plenty
const OFFLINE_AFTER_MIN = 60 // a device writes ~every 60s; an hour of silence is real

interface Device {
  id: string
  user_id: string
  name: string
}

type Threshold = { warning: number; critical: number }

// auth.users is not readable through PostgREST, so emails come from the admin API.
// Cache per sweep: a 10-household sweep should not make 10 identical lookups.
function emailLookup(supabase: SupabaseClient) {
  const cache = new Map<string, string>()
  return async (userId: string): Promise<string> => {
    const hit = cache.get(userId)
    if (hit !== undefined) return hit
    try {
      const { data, error } = await supabase.auth.admin.getUserById(userId)
      const email = error ? '' : (data.user?.email ?? '')
      cache.set(userId, email)
      return email
    } catch (e) {
      log.warn('notifications', 'could not resolve user email', { user_id: userId, detail: errText(e) })
      cache.set(userId, '')
      return ''
    }
  }
}

async function sweep(
  supabase: SupabaseClient,
  opts: { userId?: string; dry?: boolean },
): Promise<{ devices: number; created: string[] }> {
  let q = supabase.from('devices').select('id, user_id, name').eq('active', true)
  if (opts.userId) q = q.eq('user_id', opts.userId)
  const { data: devices, error: devErr } = await q
  if (devErr) {
    log.error('notifications', 'devices query failed', { detail: devErr.message })
    throw new Error(devErr.message)
  }

  const created: string[] = []
  const resolveEmail = emailLookup(supabase)
  const now = Date.now()

  for (const device of (devices ?? []) as Device[]) {
    // Latest reading for THIS device.
    const { data: latestRows, error: readErr } = await supabase
      .from('air_quality')
      .select('co2, humidity, created_at')
      .eq('device_id', device.id)
      .order('created_at', { ascending: false })
      .limit(1)
    if (readErr) {
      log.error('notifications', 'reading query failed', { device_id: device.id, detail: readErr.message })
      continue
    }
    const latest = latestRows?.[0]

    // Recent alerts for this device, for rate limiting. Widest window we use, then
    // filtered per type below — one query instead of one per alert type.
    const { data: recent } = await supabase
      .from('notifications')
      .select('type, created_at')
      .eq('user_id', device.user_id)
      .eq('device_id', device.id)
      .gte('created_at', new Date(now - OFFLINE_RATE_LIMIT_MS).toISOString())
    const lastOfType = new Map<string, number>()
    for (const r of recent ?? []) {
      const t = new Date(r.created_at).getTime()
      if (!lastOfType.has(r.type) || t > lastOfType.get(r.type)!) lastOfType.set(r.type, t)
    }
    const suppressed = (type: string, windowMs: number) => {
      const last = lastOfType.get(type)
      return last !== undefined && now - last < windowMs
    }

    const raise = async (type: string, message: string, metadata: Record<string, unknown>, subject: string) => {
      if (opts.dry) {
        created.push(type)
        log.info('notifications', 'DRY RUN — would raise', { device_id: device.id, type, message })
        return
      }
      const { error } = await supabase.from('notifications').insert({
        user_id: device.user_id,
        device_id: device.id,
        type,
        message,
        metadata,
      })
      if (error) {
        log.error('notifications', 'insert failed', { device_id: device.id, type, detail: error.message })
        return
      }
      created.push(type)
      log.info('notifications', 'alert raised', { device_id: device.id, type })
      const to = await resolveEmail(device.user_id)
      if (to) await sendAlertEmail(to, subject, `${message}\n\nBekijk je dashboard voor details.`)
    }

    // ── Liveness. A silent sensor is the failure mode that actually bit us: the live
    // device stopped 2026-08-03 and nobody noticed for days (docs/known-issues.md KI-3).
    const lastSeenMs = latest?.created_at ? new Date(latest.created_at).getTime() : null
    const minutesSince = lastSeenMs === null ? null : Math.floor((now - lastSeenMs) / 60000)
    if (minutesSince === null || minutesSince > OFFLINE_AFTER_MIN) {
      const type = 'device_offline'
      if (!suppressed(type, OFFLINE_RATE_LIMIT_MS)) {
        const howLong =
          minutesSince === null
            ? 'heeft nog nooit gemeten'
            : minutesSince < 120
              ? `is al ${minutesSince} minuten stil`
              : `is al ${Math.floor(minutesSince / 60)} uur stil`
        await raise(
          type,
          `Sensor "${device.name}" ${howLong}. Controleer de stroom en de wifi-verbinding.`,
          { device_id: device.id, minutes_since: minutesSince, severity: 'warning' },
          `[Luchtkwaliteit] Sensor "${device.name}" offline`,
        )
      }
      // Don't evaluate thresholds against a stale reading — a two-day-old CO2 value is
      // not a fact about the room right now, and alerting on it would be a lie.
      continue
    }

    if (!latest) continue

    // ── Thresholds. Device-specific rows win over the user-level default (device_id null).
    const cfg: Record<string, Threshold> = {
      co2: { ...DEFAULTS.co2 },
      humidity: { ...DEFAULTS.humidity },
    }
    const { data: thrRows } = await supabase
      .from('thresholds')
      .select('metric, warning_value, critical_value, device_id')
      .eq('user_id', device.user_id)
      .or(`device_id.eq.${device.id},device_id.is.null`)
    // Apply user-level first, then device-level, so device-level overrides.
    for (const pass of [null, device.id]) {
      for (const r of thrRows ?? []) {
        if (r.device_id !== pass) continue
        if (!cfg[r.metric]) continue
        if (r.warning_value != null) cfg[r.metric].warning = +r.warning_value
        if (r.critical_value != null) cfg[r.metric].critical = +r.critical_value
      }
    }

    const values: Record<string, number> = {
      co2: latest.co2 != null ? Math.round(+latest.co2) : NaN,
      humidity: latest.humidity != null ? +(+latest.humidity).toFixed(1) : NaN,
    }

    for (const metric of Object.keys(values)) {
      const value = values[metric]
      if (isNaN(value)) continue
      const t = cfg[metric]
      let severity: 'critical' | 'warning' | null = null
      let thresholdVal = 0
      if (value >= t.critical) {
        severity = 'critical'
        thresholdVal = t.critical
      } else if (value >= t.warning) {
        severity = 'warning'
        thresholdVal = t.warning
      }
      if (!severity) continue

      const type = `threshold_${metric}_${severity}`
      if (suppressed(type, THRESHOLD_RATE_LIMIT_MS)) continue

      const meta = METRIC_META[metric]
      const sevNl = severity === 'critical' ? 'kritiek' : 'attentie'
      await raise(
        type,
        `${meta.name} is ${value} ${meta.unit} (${sevNl} > ${thresholdVal}) op "${device.name}".`,
        { metric, value, threshold: thresholdVal, severity, device_id: device.id },
        `[Luchtkwaliteit] ${severity === 'critical' ? 'Kritieke' : 'Attentie'}: ${meta.name} ${value} ${meta.unit}`,
      )
    }
  }

  return { devices: devices?.length ?? 0, created }
}

export async function POST(req: NextRequest) {
  // ── Operator path: sweep everyone. `?dry=1` reports what would fire and writes
  // nothing — use it to sanity-check before enabling the timer, or after changing
  // thresholds, without spamming residents.
  if (cronSecretOk(req.headers.get('x-cron-secret'))) {
    const dry = req.nextUrl.searchParams.get('dry') === '1'
    try {
      const r = await sweep(createServiceClient(), { dry })
      log.info('notifications', 'cron sweep complete', { dry, devices: r.devices, created: r.created.length })
      return NextResponse.json({ ok: true, mode: 'cron', dry, ...r })
    } catch (e) {
      log.error('notifications', 'cron sweep failed', { detail: errText(e) })
      return NextResponse.json({ ok: false, error: 'sweep failed' }, { status: 500 })
    }
  }

  // ── Browser path: the signed-in user's own devices only.
  const cookieStore = await cookies()
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (c) => {
          try {
            c.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {}
        },
      },
    },
  )
  const {
    data: { user },
  } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ ok: false }, { status: 401 })

  // The bell polls every 120s per open tab; several tabs are normal, a loop is not.
  // The cron path above is deliberately NOT limited — it is trusted and scheduled.
  const limited = enforce('notifications', user.id, LIMITS.notifications)
  if (limited) return limited

  try {
    // Service client, but hard-scoped to the caller's own user_id.
    const r = await sweep(createServiceClient(), { userId: user.id })
    return NextResponse.json({ ok: true, mode: 'session', checked: r.devices > 0, ...r })
  } catch (e) {
    log.error('notifications', 'session sweep failed', { user_id: user.id, detail: errText(e) })
    return NextResponse.json({ ok: false, error: 'sweep failed' }, { status: 500 })
  }
}
