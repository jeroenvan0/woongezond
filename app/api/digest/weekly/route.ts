import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient, cronSecretOk } from '@/lib/supabase/service'
import { sendAlertEmail } from '@/lib/email'
import { buildWeeklyDigest, DigestRow } from '@/lib/weeklyDigest'
import { log, errText } from '@/lib/logger'

// B5 — weekly household summary email.
//
// Two ways in, ONE implementation (`digestSweep`), mirroring notifications/check:
//
//   POST /api/digest/weekly + x-cron-secret   → every household with an email. Driven by
//                                               woongezond-digest.timer (weekly). ?dry=1 to
//                                               preview counts without sending.
//   POST /api/digest/weekly                    → the signed-in user only, ALWAYS a preview
//                                               (returns the composed digest, sends nothing).
//
// Email sending is a no-op when RESEND_API_KEY is unset (lib/email), so this is safe to
// wire up before the mail provider is configured. Digest copy: lib/weeklyDigest (unit-tested).

export const dynamic = 'force-dynamic'

const WEEK_MIN = 7 * 24 * 60
const MAX_ROWS_PER_USER = 5000 // a week of ~1/min readings is ~10k; a capped recent slice
                               // is plenty for weekly averages and keeps the sweep cheap.

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
      log.warn('digest', 'could not resolve user email', { user_id: userId, detail: errText(e) })
      cache.set(userId, '')
      return ''
    }
  }
}

interface SweepResult {
  users: number
  sent: number
  skipped: number
  previews?: { label: string; subject: string; hasData: boolean }[]
}

async function digestSweep(supabase: SupabaseClient, opts: { userId?: string; preview?: boolean }): Promise<SweepResult> {
  // Active devices, grouped by household. One digest per user, not per device.
  let q = supabase.from('devices').select('id, user_id, name').eq('active', true)
  if (opts.userId) q = q.eq('user_id', opts.userId)
  const { data: devices, error } = await q
  if (error) { log.error('digest', 'devices query failed', { detail: error.message }); throw new Error(error.message) }

  const byUser = new Map<string, string[]>()
  for (const d of devices ?? []) {
    const arr = byUser.get(d.user_id) ?? []
    arr.push(d.name)
    byUser.set(d.user_id, arr)
  }

  const resolveEmail = emailLookup(supabase)
  const since = new Date(Date.now() - WEEK_MIN * 60000).toISOString()
  const previews: { label: string; subject: string; hasData: boolean }[] = []
  let sent = 0, skipped = 0

  for (const [userId, names] of byUser) {
    const { data: rows } = await supabase
      .from('air_quality')
      .select('created_at, co2, temperature, humidity')
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS_PER_USER)

    const label = names.length === 1 ? `"${names[0]}"` : 'je woning'
    const digest = buildWeeklyDigest((rows ?? []) as DigestRow[], label)

    if (opts.preview) {
      previews.push({ label, subject: digest.subject, hasData: digest.hasData })
      continue
    }

    const to = await resolveEmail(userId)
    if (!to) { skipped++; continue }
    const ok = await sendAlertEmail(to, digest.subject, digest.text)
    if (ok) { sent++; log.info('digest', 'weekly digest sent', { user_id: userId, hasData: digest.hasData }) }
    else skipped++
  }

  return { users: byUser.size, sent, skipped, ...(opts.preview ? { previews } : {}) }
}

export async function POST(req: NextRequest) {
  // ── Operator path: send to every household. ?dry=1 previews without sending.
  if (cronSecretOk(req.headers.get('x-cron-secret'))) {
    const preview = req.nextUrl.searchParams.get('dry') === '1'
    try {
      const r = await digestSweep(createServiceClient(), { preview })
      log.info('digest', 'cron digest complete', { preview, users: r.users, sent: r.sent, skipped: r.skipped })
      return NextResponse.json({ ok: true, mode: 'cron', dry: preview, ...r })
    } catch {
      return NextResponse.json({ ok: false, error: 'sweep failed' }, { status: 500 })
    }
  }

  // ── Browser path: the signed-in user only, always a preview (sends nothing).
  const cookieStore = await cookies()
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: (c) => { try { c.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} } } },
  )
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ ok: false }, { status: 401 })

  try {
    const r = await digestSweep(createServiceClient(), { userId: user.id, preview: true })
    return NextResponse.json({ ok: true, mode: 'preview', ...r })
  } catch {
    return NextResponse.json({ ok: false, error: 'preview failed' }, { status: 500 })
  }
}
