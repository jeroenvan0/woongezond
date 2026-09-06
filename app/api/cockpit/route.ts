import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { weeklyReportSweep } from '@/lib/report/sweep'
import { sendEmail } from '@/lib/email'
import { QUESTIONS } from '@/lib/houseProfile'
import { log, errText } from '@/lib/logger'

// Pilot-cockpit voor org-ADMINS (docs/pilot-cockpit-plan.md §2c, docs/support-assistant.md).
//
//   GET  /api/cockpit                      sensoren van de org + contact (laag B) + laatste
//                                          rapport + klantenservice-inbox
//   POST /api/cockpit {action, …}          send_report {device_id} · support_send {id, text?}
//                                          · support_close {id}
//
// De aanroeper wordt via zijn eigen sessie gecontroleerd (org_members.role = 'admin', RLS
// laat alleen eigen lidmaatschappen zien); daarna leest de service-role de tabellen die
// voor browsers dicht zijn (report_sends, support_messages). Viewers krijgen 403: zij zien
// alleen /vloot, zonder namen.

export const dynamic = 'force-dynamic'
const UUID_RE = /^[0-9a-f-]{36}$/i
const ONLINE_MIN = 15

async function adminOrgs(): Promise<{ id: string; name: string }[] | 'unauthenticated'> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 'unauthenticated'
  const { data } = await supabase.from('org_members').select('org_id, role, organizations(name)').eq('role', 'admin')
  return (data ?? []).map((m: any) => ({ id: m.org_id, name: m.organizations?.name ?? 'Organisatie' }))
}

const roomLabel = (v: string | null | undefined) => (v ? QUESTIONS.find((q) => q.key === 'room')?.options.find((o) => o.value === v)?.label ?? v : null)

export async function GET(req: NextRequest) {
  const orgs = await adminOrgs()
  if (orgs === 'unauthenticated') return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (!orgs.length) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const requested = req.nextUrl.searchParams.get('org')
  const org = orgs.find((o) => o.id === requested) ?? orgs[0]

  const s = createServiceClient()
  const { data: devices, error } = await s.from('devices')
    .select('id, name, device_number, location, house_profile, active, last_seen_at, fw_version, boot_count, last_rssi, profile_completed_at, device_contacts(name, email, address_note, report_consent_at)')
    .eq('org_id', org.id).order('device_number', { ascending: true, nullsFirst: false })
  if (error) return NextResponse.json({ error: 'query_failed' }, { status: 500 })

  const ids = (devices ?? []).map((d: any) => d.id)
  const { data: sends } = ids.length ? await s.from('report_sends').select('device_id, sent_at, period_start, period_end, verdict, status, trigger').in('device_id', ids).order('sent_at', { ascending: false }) : { data: [] as any[] }
  const lastSend = new Map<string, any>()
  for (const r of sends ?? []) if (!lastSend.has(r.device_id)) lastSend.set(r.device_id, r)

  const now = Date.now()
  const out = (devices ?? []).map((d: any) => {
    const c = Array.isArray(d.device_contacts) ? d.device_contacts[0] : d.device_contacts
    const mins = d.last_seen_at ? Math.round((now - new Date(d.last_seen_at).getTime()) / 60000) : null
    return {
      id: d.id, device_number: d.device_number, name: d.name, active: d.active !== false,
      room: roomLabel(d.house_profile?.room) ?? d.location ?? null, registered_at: d.profile_completed_at,
      online: mins != null && mins < ONLINE_MIN, minutes_since: mins, fw_version: d.fw_version, boot_count: d.boot_count, rssi: d.last_rssi,
      contact: c ? { name: c.name, email: c.email, address_note: c.address_note, report_consent: !!c.report_consent_at } : null,
      last_report: lastSend.get(d.id) ?? null,
    }
  })

  const { data: inbox } = await s.from('support_messages')
    .select('id, created_at, handled_at, from_addr, subject, body, reply, escalate, reason, status, model, device_id')
    .neq('status', 'ignored').order('created_at', { ascending: false }).limit(50)
  const numberOf = new Map(out.map((d) => [d.id, d.device_number]))
  const inboxOut = (inbox ?? []).filter((m: any) => !m.device_id || numberOf.has(m.device_id)).map((m: any) => ({ ...m, device_number: m.device_id ? numberOf.get(m.device_id) ?? null : null }))

  return NextResponse.json({ orgs, org, devices: out, inbox: inboxOut, support_mode: process.env.SUPPORT_MODE ?? 'draft' }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const orgs = await adminOrgs()
  if (orgs === 'unauthenticated') return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (!orgs.length) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const body = await req.json().catch(() => null)
  const action = body?.action
  const s = createServiceClient()
  const orgIds = orgs.map((o) => o.id)

  try {
    if (action === 'send_report') {
      const deviceId = String(body?.device_id ?? '')
      if (!UUID_RE.test(deviceId)) return NextResponse.json({ error: 'bad_device' }, { status: 400 })
      const { data: d } = await s.from('devices').select('id, org_id').eq('id', deviceId).maybeSingle()
      if (!d || !orgIds.includes(d.org_id)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
      const r = await weeklyReportSweep(s, { deviceId, force: true, rolling: true, trigger: 'manual' })
      const item = r.items[0] ?? null
      if (!item) return NextResponse.json({ error: 'no_contact' }, { status: 409 })
      return NextResponse.json({ ok: item.status === 'sent', item })
    }

    if (action === 'support_send' || action === 'support_close') {
      const id = Number(body?.id)
      if (!Number.isFinite(id)) return NextResponse.json({ error: 'bad_id' }, { status: 400 })
      const { data: m } = await s.from('support_messages').select('id, from_addr, subject, message_id, reply, device_id, status').eq('id', id).maybeSingle()
      if (!m) return NextResponse.json({ error: 'not_found' }, { status: 404 })
      if (m.device_id) {
        const { data: d } = await s.from('devices').select('org_id').eq('id', m.device_id).maybeSingle()
        if (!d || !orgIds.includes(d.org_id)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
      }
      if (action === 'support_close') {
        await s.from('support_messages').update({ status: 'closed', handled_at: new Date().toISOString() }).eq('id', id)
        return NextResponse.json({ ok: true })
      }
      const text = typeof body?.text === 'string' && body.text.trim() ? body.text.trim().slice(0, 6000) : m.reply
      if (!text) return NextResponse.json({ error: 'empty' }, { status: 400 })
      const ok = await sendEmail({
        from: process.env.SUPPORT_FROM_ADDR || process.env.ALERT_FROM_ADDR, to: m.from_addr,
        subject: /^re:/i.test(m.subject ?? '') ? m.subject : `Re: ${m.subject ?? 'je vraag'}`, text,
        headers: m.message_id ? { 'In-Reply-To': m.message_id, References: m.message_id } : undefined,
      })
      await s.from('support_messages').update({ reply: text, status: ok ? 'answered' : 'send_failed', handled_at: new Date().toISOString() }).eq('id', id)
      return NextResponse.json({ ok })
    }

    return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
  } catch (e) {
    log.error('cockpit', 'action failed', { action, detail: errText(e) })
    return NextResponse.json({ error: 'error' }, { status: 500 })
  }
}
