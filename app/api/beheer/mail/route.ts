import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { adminOrgs } from '@/lib/cockpit/auth'
import { sendEmail } from '@/lib/email'
import { reportFrom, EMAIL_RE } from '@/lib/settings'
import { isFrequency, FREQUENCY_LABEL } from '@/lib/report/period'
import { consume, LIMITS } from '@/lib/rateLimit'
import { log, errText } from '@/lib/logger'

// GET  /api/beheer/mail                    per sensor: wie krijgt het rapport, hoe vaak, en wanneer ging het laatst
// POST /api/beheer/mail {action, …}        save_contact {device_id, name?, email?, frequency?, consent?}
//                                          test_mail {device_id}
//
// Alleen org-admins, en alleen voor sensoren van hún organisatie — de device_id uit het
// verzoek wordt gecontroleerd tegen die lijst, zodat een admin van corporatie A niet het
// mailadres van een bewoner van corporatie B kan aanpassen.

export const dynamic = 'force-dynamic'

async function myDeviceIds(s: ReturnType<typeof createServiceClient>, orgIds: string[]): Promise<Set<string>> {
  const { data } = await s.from('devices').select('id').in('org_id', orgIds)
  return new Set((data ?? []).map((d: { id: string }) => d.id))
}

export async function GET() {
  const orgs = await adminOrgs()
  if (orgs === 'unauthenticated') return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (!orgs.length) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  let s
  try { s = createServiceClient() } catch (e) {
    log.error('beheer', 'service client niet beschikbaar', { detail: errText(e) })
    return NextResponse.json({ error: 'unconfigured' }, { status: 503 })
  }

  const orgIds = orgs.map((o) => o.id)
  const { data: devices } = await s
    .from('devices')
    .select('id, device_number, name, active, device_contacts(name, email, report_consent_at, report_frequency)')
    .in('org_id', orgIds)
    .order('device_number', { ascending: true, nullsFirst: false })

  const ids = (devices ?? []).map((d: any) => d.id)
  const { data: sends } = ids.length
    ? await s.from('report_sends').select('device_id, sent_at, status, verdict').in('device_id', ids).order('sent_at', { ascending: false })
    : { data: [] as any[] }
  const lastSend = new Map<string, any>()
  for (const r of sends ?? []) if (!lastSend.has(r.device_id)) lastSend.set(r.device_id, r)

  const list = (devices ?? []).map((d: any) => {
    const c = Array.isArray(d.device_contacts) ? d.device_contacts[0] : d.device_contacts
    return {
      device_id: d.id,
      device_number: d.device_number,
      device_name: d.name,
      active: d.active !== false,
      name: c?.name ?? null,
      email: c?.email ?? null,
      // Toestemming is het echte aan/uit: zonder report_consent_at stuurt de sweep niets,
      // ook niet als er een adres staat (docs/rapport-weekmail-plan.md).
      consent: !!c?.report_consent_at,
      frequency: isFrequency(c?.report_frequency) ? c.report_frequency : 'weekly',
      last_send: lastSend.get(d.id) ?? null,
    }
  })

  return NextResponse.json({ orgs, list, from: await reportFrom() }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const orgs = await adminOrgs()
  if (orgs === 'unauthenticated') return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (!orgs.length) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const action = String(body?.action ?? '')
  const deviceId = String(body?.device_id ?? '')

  let s
  try { s = createServiceClient() } catch { return NextResponse.json({ error: 'unconfigured' }, { status: 503 }) }

  const mine = await myDeviceIds(s, orgs.map((o) => o.id))
  if (!mine.has(deviceId)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (action === 'save_contact') {
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '') || null
    const email = str(body?.email, 160)?.toLowerCase() ?? null
    if (email && !EMAIL_RE.test(email)) return NextResponse.json({ error: 'email_invalid' }, { status: 400 })

    const patch: Record<string, unknown> = { device_id: deviceId, updated_at: new Date().toISOString() }
    if ('name' in (body ?? {})) patch.name = str(body?.name, 80)
    if ('email' in (body ?? {})) patch.email = email
    if ('frequency' in (body ?? {})) {
      if (!isFrequency(body.frequency)) return NextResponse.json({ error: 'frequency_invalid' }, { status: 400 })
      patch.report_frequency = body.frequency
    }
    // Toestemming intrekken wist de datum; geven zet 'm op nu. Zonder adres kan er geen
    // toestemming zijn — anders staat er een sensor "aan" die nergens heen kan mailen.
    if ('consent' in (body ?? {})) {
      if (body.consent && !(email ?? (await s.from('device_contacts').select('email').eq('device_id', deviceId).maybeSingle()).data?.email)) {
        return NextResponse.json({ error: 'email_required' }, { status: 400 })
      }
      patch.report_consent_at = body.consent ? new Date().toISOString() : null
    }

    const { error } = await s.from('device_contacts').upsert(patch, { onConflict: 'device_id' })
    if (error) {
      log.error('beheer', 'contact opslaan mislukt', { device_id: deviceId, detail: error.message })
      return NextResponse.json({ error: 'save_failed' }, { status: 500 })
    }
    log.info('beheer', 'contact gewijzigd', { device_id: deviceId, by: user?.email ?? null })
    return NextResponse.json({ ok: true })
  }

  if (action === 'test_mail') {
    const rl = consume(`beheer:testmail:${user?.id ?? 'onbekend'}`, LIMITS.beheerSync)
    if (!rl.ok) return NextResponse.json({ error: 'rate_limited', retryAfter: rl.retryAfterSec }, { status: 429 })

    const { data: c } = await s.from('device_contacts').select('name, email, report_frequency').eq('device_id', deviceId).maybeSingle()
    if (!c?.email) return NextResponse.json({ error: 'no_address' }, { status: 400 })

    const freq = isFrequency(c.report_frequency) ? c.report_frequency : 'weekly'
    const ok = await sendEmail({
      from: await reportFrom(),
      to: c.email,
      subject: 'Testbericht van Woongezond',
      text: [
        c.name ? `Hallo ${c.name.split(/\s+/)[0]},` : 'Hallo,',
        '',
        'Dit is een testbericht om te controleren of onze e-mail bij je aankomt.',
        `Je staat ingesteld op een ${FREQUENCY_LABEL[freq]} rapport over de luchtkwaliteit in je woning.`,
        '',
        'Je hoeft hier niets mee te doen. Klopt er iets niet, antwoord dan gerust op deze mail.',
        '',
        'Woongezond',
      ].join('\n'),
    })
    if (!ok) {
      // sendEmail logt zelf waarom; hier telt alleen dat de beheerder het meteen ziet.
      return NextResponse.json({ error: 'send_failed' }, { status: 502 })
    }
    log.info('beheer', 'testmail verstuurd', { device_id: deviceId, by: user?.email ?? null })
    return NextResponse.json({ ok: true, to: c.email })
  }

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
}
