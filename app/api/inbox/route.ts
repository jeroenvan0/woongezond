import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendEmail } from '@/lib/email'
import { log, errText } from '@/lib/logger'
import { verifyResendWebhook, fetchReceivedEmail, plainBody, bareAddress, ReceivedEmailEvent } from '@/lib/support/resendInbound'
import { composeSupportReply } from '@/lib/support/assistant'
import { residentContext } from '@/lib/support/context'

// Klantenservice-inbox: Resend Receiving → webhook `email.received` → assistent → antwoord.
// docs/support-assistant.md beschrijft de opzet en de DNS-stappen.
//
// Drie standen via SUPPORT_MODE:
//   draft (standaard)  het voorstel gaat naar SUPPORT_ADMIN_ADDR, de bewoner krijgt niets
//   auto               de bewoner krijgt het antwoord in dezelfde thread, admin in bcc;
//                      behalve als de assistent escaleert → dan alleen naar de admin
//   off                alleen opslaan, niets versturen
//
// Elke mail wordt in support_messages gelogd (alleen service-role leesbaar). Resend probeert
// een webhook opnieuw bij een niet-2xx, dus we antwoorden 200 zodra de mail is opgeslagen,
// ook als het model of het versturen mislukt — dat staat dan in de rij en in de logs.

export const dynamic = 'force-dynamic'

const MODE = () => (process.env.SUPPORT_MODE ?? 'draft') as 'draft' | 'auto' | 'off'
const FROM = () => process.env.SUPPORT_FROM_ADDR || process.env.ALERT_FROM_ADDR || 'Woongezond <hulp@woongezond.com>'
const ADMIN = () => process.env.SUPPORT_ADMIN_ADDR || ''

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const ok = verifyResendWebhook(
    { id: req.headers.get('svix-id'), timestamp: req.headers.get('svix-timestamp'), signature: req.headers.get('svix-signature') },
    raw,
    process.env.RESEND_WEBHOOK_SECRET,
  )
  if (!ok) return NextResponse.json({ error: 'bad_signature' }, { status: 401 })

  let event: ReceivedEmailEvent
  try { event = JSON.parse(raw) } catch { return NextResponse.json({ error: 'bad_body' }, { status: 400 }) }
  if (event.type !== 'email.received') return NextResponse.json({ ok: true, ignored: event.type })

  const s = createServiceClient()
  const emailId = event.data.email_id

  // Idempotent: Resend kan dezelfde webhook meerdere keren bezorgen.
  const { data: existing } = await s.from('support_messages').select('id').eq('resend_email_id', emailId).maybeSingle()
  if (existing) return NextResponse.json({ ok: true, duplicate: true })

  const mail = await fetchReceivedEmail(emailId)
  if (!mail) { log.error('support', 'could not fetch received email', { email_id: emailId }); return NextResponse.json({ error: 'fetch_failed' }, { status: 502 }) }

  const fromAddr = bareAddress(mail.from)
  // Eigen mail, bounces en automatische antwoorden niet beantwoorden.
  const auto = /^(mailer-daemon|postmaster|no-?reply|noreply)@/i.test(fromAddr) || /auto-?submitted/i.test(JSON.stringify(mail.headers ?? {}))
  const body = plainBody(mail)

  const { data: row } = await s.from('support_messages').insert({
    resend_email_id: emailId, message_id: mail.message_id, from_addr: fromAddr, to_addr: (mail.to ?? [])[0] ?? null,
    subject: mail.subject, body, status: auto ? 'ignored' : 'received',
  }).select('id').single()
  const rowId = row?.id
  if (auto) return NextResponse.json({ ok: true, ignored: 'auto' })

  try {
    const ctx = await residentContext(s, mail.from, { excludeResendId: emailId })
    const answer = await composeSupportReply({ from: mail.from, subject: mail.subject, body }, ctx)
    const mode = MODE()
    const toResident = mode === 'auto' && !answer.escalate
    let status: string = mode === 'off' ? 'stored' : toResident ? 'answered' : 'draft'

    if (mode !== 'off') {
      const adminNote = [
        `Van: ${mail.from}`, `Onderwerp: ${mail.subject}`, `Sensor: ${ctx.known ? `${ctx.deviceNumber ?? '?'} (${ctx.online ? 'online' : 'offline'})` : 'onbekend adres'}`,
        `Oordeel assistent: ${answer.escalate ? 'ESCALEREN' : 'kan automatisch'} — ${answer.reason}`, '',
        toResident ? '— Dit antwoord is naar de bewoner gestuurd —' : '— Voorstel (NIET verstuurd naar de bewoner) —', '', answer.reply, '',
        '— Oorspronkelijke mail —', '', body,
      ].join('\n')
      if (toResident) {
        const sent = await sendEmail({
          from: FROM(), to: fromAddr, subject: /^re:/i.test(mail.subject) ? mail.subject : `Re: ${mail.subject}`, text: answer.reply,
          replyTo: process.env.SUPPORT_REPLY_TO || undefined, bcc: ADMIN() || undefined, headers: mail.message_id ? { 'In-Reply-To': mail.message_id, References: mail.message_id } : undefined,
        })
        if (!sent) status = 'send_failed'
      } else if (ADMIN()) {
        const sent = await sendEmail({ from: FROM(), to: ADMIN(), subject: `[${answer.escalate ? 'ESCALATIE' : 'concept'}] ${mail.subject}`, text: adminNote })
        if (!sent) status = 'send_failed'
      }
    }

    await s.from('support_messages').update({ device_id: ctx.deviceId, reply: answer.reply, escalate: answer.escalate, reason: answer.reason, model: answer.model, status, handled_at: new Date().toISOString() }).eq('id', rowId)
    log.info('support', 'inbound handled', { row: rowId, known: ctx.known, escalate: answer.escalate, status })
    return NextResponse.json({ ok: true, status })
  } catch (e) {
    log.error('support', 'assistant failed', { row: rowId, detail: errText(e) })
    await s.from('support_messages').update({ status: 'error', reason: errText(e).slice(0, 300) }).eq('id', rowId)
    if (ADMIN()) await sendEmail({ from: FROM(), to: ADMIN(), subject: `[FOUT] ${mail.subject}`, text: `De assistent kon deze mail niet beantwoorden (${errText(e).slice(0, 200)}).\n\nVan: ${mail.from}\n\n${body}` })
    return NextResponse.json({ ok: true, status: 'error' })
  }
}
