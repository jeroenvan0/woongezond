// Simuleer een binnenkomende klantenservice-mail zonder Resend: zoekt de context bij het
// afzenderadres, laat de assistent (OpenRouter) antwoorden en print het resultaat.
//   npm run support:sim -- --from jeroen@x.nl --subject "Lampje knippert" --body "Mijn sensor knippert 2 keer..."
//   npm run support:sim -- --from jeroen@x.nl --file vraag.txt --send   # stuurt het antwoord via Resend naar --from
//   npm run support:sim -- --inbox                                      # laatste écht ontvangen mail bij Resend
//   npm run support:sim -- --inbox --send                               # …en beantwoord die in dezelfde thread
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { composeSupportReply } from '../lib/support/assistant'
import { residentContext } from '../lib/support/context'
import { fetchReceivedEmail, plainBody } from '../lib/support/resendInbound'
import { sendEmail } from '../lib/email'

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : undefined }
let from = arg('--from') ?? 'onbekend@example.com'
let subject = arg('--subject') ?? 'Vraag over mijn sensor'
let body = arg('--file') ? readFileSync(arg('--file')!, 'utf8') : (arg('--body') ?? 'Hoi, mijn sensor knippert steeds twee keer. Wat moet ik doen?')
let messageId: string | undefined
let resendId: string | undefined

if (process.argv.includes('--inbox')) {
  // Zelfde pad als de webhook, maar dan handmatig: nieuwste ontvangen mail ophalen.
  const r = await fetch('https://api.resend.com/emails/receiving?limit=1', { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } })
  const list = await r.json()
  const latest = list?.data?.[0]
  if (!latest) { console.error('geen ontvangen mails bij Resend'); process.exit(1) }
  const mail = await fetchReceivedEmail(latest.id)
  if (!mail) { console.error('mail ophalen mislukt'); process.exit(1) }
  from = mail.from; subject = mail.subject; body = plainBody(mail); messageId = mail.message_id; resendId = mail.id
  console.log(`ontvangen: ${mail.created_at} · van ${from} · aan ${mail.to.join(', ')} · "${subject}"`)
  console.log(`tekst: ${body.slice(0, 200).replace(/\n/g, ' ')}`)
}

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const ctx = await residentContext(s, from, { excludeResendId: resendId })
console.log(`geheugen: ${ctx.history?.length ?? 0} eerdere mail(s) van dit adres`)
console.log(`context: ${ctx.known ? `sensor ${ctx.deviceNumber} (${ctx.online ? 'online' : 'offline'}), ${ctx.firstName ?? 'geen voornaam'}` : 'onbekend adres'}`)
const t0 = Date.now()
const a = await composeSupportReply({ from, subject, body }, ctx)
console.log(`model: ${a.model} · ${Date.now() - t0} ms · escaleren: ${a.escalate} (${a.reason})`)
console.log('\n' + a.reply + '\n')

let status = 'draft'
if (process.argv.includes('--send')) {
  const ok = await sendEmail({
    from: process.env.SUPPORT_FROM_ADDR || process.env.ALERT_FROM_ADDR, to: ctx.email, subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`, text: a.reply,
    headers: messageId ? { 'In-Reply-To': messageId, References: messageId } : undefined,
  })
  console.log(ok ? `verstuurd naar ${ctx.email}` : 'NIET verstuurd')
  status = ok ? 'answered' : 'send_failed'
}

// Zelfde logregel als de webhook schrijft, zodat handmatige tests ook in support_messages staan.
if (resendId) {
  const { error } = await s.from('support_messages').upsert(
    { resend_email_id: resendId, message_id: messageId, from_addr: ctx.email, subject, body, device_id: ctx.deviceId, reply: a.reply, escalate: a.escalate, reason: a.reason, model: a.model, status, handled_at: new Date().toISOString() },
    { onConflict: 'resend_email_id' },
  )
  console.log(error ? `support_messages: ${error.message}` : `support_messages: gelogd (${status})`)
}
