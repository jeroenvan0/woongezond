import type { SupabaseClient } from '@supabase/supabase-js'
import { buildWeeklyDeviceReport } from '@/lib/report/weeklyDeviceReport'
import { QUESTIONS, HouseProfile } from '@/lib/houseProfile'
import { bareAddress } from './resendInbound'
import type { ResidentContext } from './assistant'

// Context van precies één bewoner, opgezocht op e-mailadres (laag B → laag A). Service-role.
// Geeft `known:false` als het adres niet in device_contacts staat.

const label = (key: keyof HouseProfile, v: string | undefined) => QUESTIONS.find((q) => q.key === key)?.options.find((o) => o.value === v)?.label ?? v ?? null

export async function residentContext(s: SupabaseClient, fromHeader: string, opts: { excludeResendId?: string } = {}): Promise<ResidentContext & { deviceId: string | null; email: string }> {
  const email = bareAddress(fromHeader)
  // Gespreksgeheugen: eerdere mails van dit adres (met het antwoord dat erop ging), oud → nieuw.
  let hq = s.from('support_messages').select('created_at, body, reply, status, resend_email_id').eq('from_addr', email).neq('status', 'ignored').order('created_at', { ascending: false }).limit(6)
  if (opts.excludeResendId) hq = hq.neq('resend_email_id', opts.excludeResendId)
  const { data: prior } = await hq
  const history = (prior ?? []).reverse().map((h: any) => ({ at: h.created_at, body: h.body ?? '', reply: h.status === 'answered' ? h.reply : null }))
  const empty = { known: false, firstName: null, deviceNumber: null, room: null, online: null, lastSeenMinutesAgo: null, fwVersion: null, profileSummary: null, weekSummary: null, history, deviceId: null, email }
  const { data: c } = await s.from('device_contacts').select('device_id, name, devices(id, device_number, location, house_profile, last_seen_at, fw_version)').ilike('email', email).limit(1).maybeSingle()
  if (!c) return empty
  const d: any = Array.isArray((c as any).devices) ? (c as any).devices[0] : (c as any).devices
  if (!d) return empty

  const since = new Date(Date.now() - 7 * 86400000)
  const rows: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await s.from('air_quality').select('created_at, co2, temperature, humidity').eq('device_id', d.id).gte('created_at', since.toISOString()).order('created_at').range(from, from + 999)
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  const p: Partial<HouseProfile> | null = d.house_profile ?? null
  const report = buildWeeklyDeviceReport(rows, { number: d.device_number, room: p?.room ?? d.location, profile: p }, { name: c.name }, { start: since, end: new Date() })
  const lastSeen = d.last_seen_at ? new Date(d.last_seen_at).getTime() : null
  const minutesAgo = lastSeen ? Math.round((Date.now() - lastSeen) / 60000) : null
  const name = (c.name ?? '').trim()
  const firstName = name && !/^fam\.?\s/i.test(name) ? name.split(/\s+/)[0] : null

  const profileSummary = p
    ? [label('house_type', p.house_type), label('build_period', p.build_period), p.glazing && `${label('glazing', p.glazing)} glas`, p.ventilation && `ventilatie: ${label('ventilation', p.ventilation)}`, p.occupants && `${p.occupants} slaper(s) in de kamer`, p.moisture && `vochtklachten: ${label('moisture', p.moisture)}`]
        .filter(Boolean).join(', ')
    : null

  // Alleen de tekstversie zonder aanhef/voettekst: cijfers en tips.
  const weekSummary = report.hasData
    ? report.text.split('\n').filter((l) => l && !/^(Hoi|Hallo|Je krijgt deze mail|— Woongezond|Dit is je weekrapport)/.test(l)).join('\n')
    : null

  return {
    known: true, firstName, deviceNumber: d.device_number, room: p?.room ? String(label('room', p.room)).toLowerCase() : d.location,
    online: minutesAgo == null ? null : minutesAgo < 15, lastSeenMinutesAgo: minutesAgo, fwVersion: d.fw_version ?? null,
    profileSummary: profileSummary || null, weekSummary, history, deviceId: d.id, email,
  }
}
