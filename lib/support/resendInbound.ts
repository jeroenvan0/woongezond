import { createHmac, timingSafeEqual } from 'crypto'

// Inkomende mail via Resend Receiving (docs/support-assistant.md).
//
// Resend zet een MX-record op een (sub)domein, ontvangt de mail, en POST een webhook
// `email.received` met alleen metadata. De body halen we daarna op via de API. Webhooks zijn
// ondertekend volgens Svix (svix-id / svix-timestamp / svix-signature, HMAC-SHA256 over
// "id.timestamp.body" met de base64-gedecodeerde secret na "whsec_").

export interface ReceivedEmailEvent {
  type: string
  created_at: string
  data: {
    email_id: string
    created_at: string
    from: string
    to: string[]
    cc?: string[]
    subject: string
    message_id: string
    attachments?: { id: string; filename: string; content_type: string }[]
  }
}

export interface ReceivedEmail {
  id: string
  from: string
  to: string[]
  subject: string
  text: string | null
  html: string | null
  message_id: string
  headers?: Record<string, string>
  created_at: string
}

const TOLERANCE_S = 5 * 60

/** Verifieer een Resend/Svix-webhook. `rawBody` moet de ongewijzigde request-body zijn. */
export function verifyResendWebhook(
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  rawBody: string,
  secret: string | undefined,
  now = Date.now(),
): boolean {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false
  const ts = Number(headers.timestamp)
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > TOLERANCE_S) return false
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = createHmac('sha256', secretBytes).update(`${headers.id}.${headers.timestamp}.${rawBody}`).digest('base64')
  const exp = Buffer.from(expected)
  for (const part of headers.signature.split(' ')) {
    const [version, sig] = part.split(',')
    if (version !== 'v1' || !sig) continue
    const got = Buffer.from(sig)
    if (got.length === exp.length && timingSafeEqual(got, exp)) return true
  }
  return false
}

/** Volledige inhoud van een ontvangen mail ophalen (de webhook bevat alleen metadata). */
export async function fetchReceivedEmail(emailId: string, key = process.env.RESEND_API_KEY): Promise<ReceivedEmail | null> {
  if (!key) return null
  const r = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { Authorization: `Bearer ${key}` },
  })
  if (!r.ok) return null
  const j = await r.json()
  return {
    id: j.id, from: j.from, to: j.to ?? [], subject: j.subject ?? '', text: j.text ?? null, html: j.html ?? null,
    message_id: j.message_id ?? '', headers: j.headers ?? {}, created_at: j.created_at,
  }
}

/** "Naam <adres>" → "adres" (kleine letters). */
export function bareAddress(s: string): string {
  const m = s.match(/<([^>]+)>/)
  return (m ? m[1] : s).trim().toLowerCase()
}

/** Platte tekst uit een mail: text-part, anders HTML gestript. Quotes van eerdere mails eraf. */
export function plainBody(e: { text: string | null; html: string | null }): string {
  let t = e.text ?? ''
  if (!t && e.html) t = e.html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  // Geciteerde eerdere berichten weglaten ("Op ... schreef ...:" / "On ... wrote:" / "> ").
  const cut = t.search(/\n(Op .{5,120} schreef .{0,120}:|On .{5,120} wrote:|-{3,} ?Original Message|Van: .*\nVerzonden:)/i)
  if (cut > 0) t = t.slice(0, cut)
  return t.split('\n').filter((l) => !l.trim().startsWith('>')).join('\n').trim().slice(0, 6000)
}
