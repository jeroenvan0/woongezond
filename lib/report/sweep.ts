import type { SupabaseClient } from '@supabase/supabase-js'
import { buildWeeklyDeviceReport, WeeklyDeviceReport } from './weeklyDeviceReport'
import { issueReportToken } from './token'
import { lastFullWeek, rollingWeek, WeekPeriod } from './period'
import { sendEmail } from '@/lib/email'
import { log, errText } from '@/lib/logger'

// Wekelijkse verzending per SENSOR (docs/rapport-weekmail-plan.md). Eén implementatie voor
// de timer (alle contacten met toestemming), de dry-run en "nu versturen" in de cockpit.
// Idempotent via report_sends (device, weekstart); `force` omzeilt dat voor een handmatige
// verzending. Geen e-mailadres in de logs of het resultaat: alleen device-id en -nummer.

export interface SweepItem {
  device_id: string
  device_number: number | null
  verdict: WeeklyDeviceReport['verdict']
  readings: number
  subject: string
  status: 'sent' | 'dry' | 'duplicate' | 'failed' | 'inactive'
}
export interface SweepResult { period: { start: string; end: string; key: string }; contacts: number; sent: number; skipped: number; items: SweepItem[] }

export interface SweepOptions {
  dry?: boolean
  deviceId?: string          // alleen dit device
  force?: boolean            // negeer report_sends (handmatig)
  rolling?: boolean          // afgelopen 7 dagen i.p.v. laatste volle week
  trigger?: 'timer' | 'manual'
  now?: Date
}

export function publicBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL || 'https://woongezond.com/admin').replace(/\/$/, '')
}

export async function fetchDeviceRows(s: SupabaseClient, deviceId: string, start: Date, end: Date) {
  const rows: { created_at: string; co2: number | null; temperature: number | null; humidity: number | null }[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await s.from('air_quality').select('created_at, co2, temperature, humidity').eq('device_id', deviceId)
      .gte('created_at', start.toISOString()).lt('created_at', end.toISOString()).order('created_at').range(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < 1000 || rows.length >= 20000) break
  }
  return rows
}

export async function weeklyReportSweep(s: SupabaseClient, opts: SweepOptions = {}): Promise<SweepResult> {
  const now = opts.now ?? new Date()
  const period: WeekPeriod = opts.rolling ? rollingWeek(now) : lastFullWeek(now)
  let q = s.from('device_contacts').select('device_id, name, email, report_consent_at, devices(id, device_number, location, house_profile, active)')
    .not('email', 'is', null).not('report_consent_at', 'is', null)
  if (opts.deviceId) q = q.eq('device_id', opts.deviceId)
  const { data: contacts, error } = await q
  if (error) throw new Error(error.message)

  const items: SweepItem[] = []
  let sent = 0, skipped = 0
  for (const c of contacts ?? []) {
    const d: any = Array.isArray((c as any).devices) ? (c as any).devices[0] : (c as any).devices
    if (!d) { skipped++; continue }
    const base = { device_id: d.id, device_number: d.device_number ?? null }
    if (d.active === false) { items.push({ ...base, verdict: 'nodata', readings: 0, subject: '', status: 'inactive' }); skipped++; continue }

    if (!opts.force && !opts.dry) {
      const { data: prior } = await s.from('report_sends').select('id').eq('device_id', d.id).eq('period_start', period.startKey).eq('status', 'sent').maybeSingle()
      if (prior) { items.push({ ...base, verdict: 'nodata', readings: 0, subject: '', status: 'duplicate' }); skipped++; continue }
    }

    const rows = await fetchDeviceRows(s, d.id, period.start, period.end)
    const profile = d.house_profile ?? null
    const { token } = issueReportToken(d.id, now.getTime())
    const links = { report: `${publicBaseUrl()}/rapport?t=${token}`, unsubscribe: `${publicBaseUrl()}/rapport/afmelden?t=${token}` }
    const report = buildWeeklyDeviceReport(rows, { number: d.device_number, room: profile?.room ?? d.location, profile }, { name: c.name }, { start: period.start, end: period.end }, links)
    const item: SweepItem = { ...base, verdict: report.verdict, readings: rows.length, subject: report.subject, status: 'dry' }

    if (!opts.dry) {
      const ok = await sendEmail({ to: c.email!, subject: report.subject, text: report.text, html: report.html })
      item.status = ok ? 'sent' : 'failed'
      const { error: insErr } = await s.from('report_sends').upsert(
        { device_id: d.id, period_start: period.startKey, period_end: period.endKey, status: item.status, verdict: report.verdict, readings: rows.length, trigger: opts.trigger ?? 'timer', sent_at: now.toISOString() },
        { onConflict: 'device_id,period_start' },
      )
      if (insErr) log.warn('report', 'report_sends write failed', { device_id: d.id, detail: insErr.message })
      if (ok) sent++; else skipped++
      log.info('report', 'weekly report ' + item.status, { device_id: d.id, device_number: d.device_number, verdict: report.verdict, readings: rows.length })
    }
    items.push(item)
  }
  return { period: { start: period.start.toISOString(), end: period.end.toISOString(), key: period.startKey }, contacts: (contacts ?? []).length, sent, skipped, items }
}

export { errText }
