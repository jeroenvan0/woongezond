import { log, errText } from '@/lib/logger'

// Alert email via the Resend HTTP API.
//
// No-op (and says so, once, at info level) when RESEND_API_KEY is unset — that is a
// supported configuration, not a failure. When it IS configured, a failed send is a
// real problem for an unattended pilot: it means a resident was not told about a
// critical CO2 reading. So: retry once, then log loudly. The previous version
// swallowed every failure in `catch {}`.

const RETRY_DELAY_MS = 1500

async function post(key: string, payload: unknown): Promise<{ ok: true } | { ok: false; detail: string }> {
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (r.ok) return { ok: true }
    // Resend puts the reason in the body; it is short and has no PII beyond the address.
    return { ok: false, detail: `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}` }
  } catch (e) {
    return { ok: false, detail: errText(e) }
  }
}

export interface EmailMessage {
  to: string
  subject: string
  text: string
  html?: string
  from?: string                     // default ALERT_FROM_ADDR
  replyTo?: string
  bcc?: string
  headers?: Record<string, string>  // e.g. In-Reply-To / References to stay in a thread
}

/** Alert/digest email, plain text only. Kept for existing callers. */
export function sendAlertEmail(to: string, subject: string, body: string): Promise<boolean> {
  return sendEmail({ to, subject, text: body })
}

/** Send one email (text + optional HTML alternative) via Resend. Same retry/logging policy. */
export async function sendEmail({ to, subject, text, html, from: fromOverride, replyTo, bcc, headers }: EmailMessage): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  const from = fromOverride || process.env.ALERT_FROM_ADDR || 'alerts@woongezond.nl'
  if (!key) return false
  if (!to) {
    log.warn('email', 'no recipient address; skipping alert email', { subject })
    return false
  }

  // Antwoorden op elke mail van de app (rapport, alert, klantenservice) landen bij de
  // klantenservice-inbox: SUPPORT_REPLY_TO is het ontvangstadres op het Resend-subdomein.
  const reply = replyTo || process.env.SUPPORT_REPLY_TO
  const payload = {
    from, to, subject, text,
    ...(html ? { html } : {}),
    ...(reply ? { reply_to: reply } : {}),
    ...(bcc ? { bcc } : {}),
    ...(headers ? { headers } : {}),
  }

  const first = await post(key, payload)
  if (first.ok) return true
  log.warn('email', 'alert send failed, retrying once', { to, subject, detail: first.detail })

  await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))

  const second = await post(key, payload)
  if (second.ok) {
    log.info('email', 'alert send succeeded on retry', { to, subject })
    return true
  }
  log.error('email', 'alert send failed twice; resident was NOT notified', {
    to,
    subject,
    detail: second.detail,
  })
  return false
}
