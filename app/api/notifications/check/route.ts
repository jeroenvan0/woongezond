import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

// Default thresholds when the user has not configured any (mirrors notifications.py).
const DEFAULTS: Record<string, { warning: number; critical: number }> = {
  co2: { warning: 1000, critical: 1500 },
  humidity: { warning: 65, critical: 75 },
}
const METRIC_META: Record<string, { name: string; unit: string }> = {
  co2: { name: 'CO₂', unit: 'ppm' },
  humidity: { name: 'Luchtvochtigheid', unit: '%' },
}
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000 // 2 hours

// Optional email via Resend HTTP API — no-op unless RESEND_API_KEY is set.
async function sendEmail(to: string, subject: string, body: string) {
  const key = process.env.RESEND_API_KEY
  const from = process.env.ALERT_FROM_ADDR || 'alerts@woongezond.nl'
  if (!key || !to) return
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text: body }),
    })
  } catch {
    /* best effort */
  }
}

export async function POST() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
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
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false }, { status: 401 })

  // Latest reading for this user
  const { data: latestRows } = await supabase
    .from('air_quality')
    .select('co2,humidity,created_at')
    .order('created_at', { ascending: false })
    .limit(1)
  const latest = latestRows?.[0]
  if (!latest) return NextResponse.json({ ok: true, checked: false })

  // Merge thresholds with defaults
  const cfg: Record<string, { warning: number; critical: number }> = {
    co2: { ...DEFAULTS.co2 },
    humidity: { ...DEFAULTS.humidity },
  }
  const { data: thrRows } = await supabase
    .from('thresholds')
    .select('metric,warning_value,critical_value')
    .eq('user_id', user.id)
  for (const r of thrRows ?? []) {
    if (cfg[r.metric]) {
      if (r.warning_value != null) cfg[r.metric].warning = +r.warning_value
      if (r.critical_value != null) cfg[r.metric].critical = +r.critical_value
    }
  }

  // Recently raised alert types (rate limit)
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString()
  const { data: recent } = await supabase
    .from('notifications')
    .select('type')
    .eq('user_id', user.id)
    .gte('created_at', cutoff)
  const recentTypes = new Set((recent ?? []).map((r) => r.type))

  const values: Record<string, number> = {
    co2: latest.co2 != null ? Math.round(+latest.co2) : NaN,
    humidity: latest.humidity != null ? +(+latest.humidity).toFixed(1) : NaN,
  }

  const created: string[] = []
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
    const alertType = `threshold_${metric}_${severity}`
    if (recentTypes.has(alertType)) continue

    const meta = METRIC_META[metric]
    const msg = `${meta.name} is ${value} ${meta.unit} (${severity === 'critical' ? 'kritiek' : 'attentie'} > ${thresholdVal}).`
    const { error } = await supabase.from('notifications').insert({
      user_id: user.id,
      type: alertType,
      message: msg,
      metadata: { metric, value, threshold: thresholdVal, severity },
    })
    if (!error) {
      created.push(alertType)
      const sevTxt = severity === 'critical' ? 'Kritieke' : 'Attentie'
      await sendEmail(
        user.email ?? '',
        `[Luchtkwaliteit] ${sevTxt}: ${meta.name} ${value} ${meta.unit}`,
        `${msg}\n\nBekijk je dashboard voor details.`,
      )
    }
  }

  return NextResponse.json({ ok: true, checked: true, created })
}
