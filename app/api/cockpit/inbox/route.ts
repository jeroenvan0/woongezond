import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { adminOrgs } from '@/lib/cockpit/auth'
import { QUESTIONS } from '@/lib/houseProfile'

// Inbox van de klantenservice voor org-ADMINS (docs/support-assistant.md).
//
//   GET /api/cockpit/inbox?org=&device=&status=open|done|all&q=&limit=
//
// Levert alles wat er per sensor / bewoner is gecommuniceerd: inkomende mails met het
// (voorgestelde of verstuurde) antwoord, én de verstuurde rapporten, zodat de pagina één
// tijdlijn per sensor kan tonen. Namen komen uit device_contacts (laag B, alleen admins).
// Mails van adressen die bij geen enkele sensor horen, horen bij de org waarvan de
// aanroeper admin is als hij maar één org heeft; anders staan ze bij "onbekend".

export const dynamic = 'force-dynamic'
const UUID_RE = /^[0-9a-f-]{36}$/i
const OPEN = ['received', 'draft', 'scheduled', 'stored', 'error', 'send_failed']
const roomLabel = (v: string | null | undefined) => (v ? QUESTIONS.find((q) => q.key === 'room')?.options.find((o) => o.value === v)?.label ?? v : null)

export async function GET(req: NextRequest) {
  const orgs = await adminOrgs()
  if (orgs === 'unauthenticated') return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (!orgs.length) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const p = req.nextUrl.searchParams
  const org = orgs.find((o) => o.id === p.get('org')) ?? orgs[0]
  const device = p.get('device')
  if (device && !UUID_RE.test(device)) return NextResponse.json({ error: 'bad_device' }, { status: 400 })
  const status = p.get('status') === 'open' ? 'open' : p.get('status') === 'done' ? 'done' : 'all'
  const q = (p.get('q') ?? '').trim().slice(0, 80)
  const limit = Math.max(20, Math.min(500, Number(p.get('limit') ?? 200) || 200))

  const s = createServiceClient()
  const { data: devices } = await s.from('devices').select('id, device_number, name, location, house_profile, active, device_contacts(name, email, report_consent_at, report_frequency)').eq('org_id', org.id).order('device_number', { ascending: true, nullsFirst: false })
  const devOut = (devices ?? []).map((d: any) => {
    const c = Array.isArray(d.device_contacts) ? d.device_contacts[0] : d.device_contacts
    return { id: d.id, device_number: d.device_number, name: d.name, active: d.active !== false, room: roomLabel(d.house_profile?.room) ?? d.location ?? null, contact_name: c?.name ?? null, contact_email: c?.email ?? null, report_consent: !!c?.report_consent_at, report_frequency: c?.report_frequency ?? 'weekly' }
  })
  const byId = new Map(devOut.map((d) => [d.id, d]))
  const ids = devOut.map((d) => d.id)

  // Mails: van sensoren in deze org, plus (bij één org) de mails zonder sensor.
  let mq = s.from('support_messages').select('id, created_at, handled_at, send_at, from_addr, to_addr, subject, body, reply, escalate, reason, status, model, device_id').order('created_at', { ascending: false }).limit(limit)
  if (device) mq = mq.eq('device_id', device)
  else if (orgs.length === 1) mq = ids.length ? mq.or(`device_id.in.(${ids.join(',')}),device_id.is.null`) : mq.is('device_id', null)
  else mq = ids.length ? mq.in('device_id', ids) : mq.eq('id', -1)
  if (status === 'open') mq = mq.in('status', OPEN)
  if (status === 'done') mq = mq.in('status', ['answered', 'closed'])
  if (q) mq = mq.or(`subject.ilike.%${q.replace(/[%,()]/g, '')}%,body.ilike.%${q.replace(/[%,()]/g, '')}%,from_addr.ilike.%${q.replace(/[%,()]/g, '')}%`)
  const { data: msgs, error } = await mq
  if (error) return NextResponse.json({ error: 'query_failed' }, { status: 500 })
  const messages = (msgs ?? []).map((m: any) => {
    const d = m.device_id ? byId.get(m.device_id) : null
    return { ...m, device_number: d?.device_number ?? null, room: d?.room ?? null, contact_name: d?.contact_name ?? null, open: OPEN.includes(m.status) }
  })

  // Rapporten: dezelfde tijdlijn.
  let rq = s.from('report_sends').select('id, device_id, sent_at, period_start, period_end, verdict, status, trigger, readings').order('sent_at', { ascending: false }).limit(limit)
  rq = device ? rq.eq('device_id', device) : ids.length ? rq.in('device_id', ids) : rq.eq('id', -1)
  const { data: reps } = await rq
  const reports = (reps ?? []).map((r: any) => ({ ...r, device_number: byId.get(r.device_id)?.device_number ?? null, contact_name: byId.get(r.device_id)?.contact_name ?? null }))

  // Tellers per sensor over ALLE mails (niet alleen de gefilterde).
  const { data: allMsgs } = await s.from('support_messages').select('device_id, status').or(ids.length ? `device_id.in.(${ids.join(',')}),device_id.is.null` : 'device_id.is.null')
  const perDevice: Record<string, { open: number; total: number }> = {}
  let open = 0, escalated = 0
  for (const m of allMsgs ?? []) {
    const k = (m as any).device_id ?? 'unknown'
    perDevice[k] = perDevice[k] ?? { open: 0, total: 0 }
    perDevice[k].total++
    if (OPEN.includes((m as any).status)) { perDevice[k].open++; open++ }
  }
  for (const m of messages) if (m.escalate && m.open) escalated++

  return NextResponse.json({ orgs, org, devices: devOut, messages, reports, counts: { open, escalated, total: (allMsgs ?? []).length, per_device: perDevice }, support_mode: process.env.SUPPORT_MODE ?? 'draft' }, { headers: { 'Cache-Control': 'no-store' } })
}
