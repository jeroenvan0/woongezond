import { NextRequest, NextResponse } from 'next/server'
import { consume, LIMITS, clientIp } from '@/lib/rateLimit'
import { verifySession } from '@/lib/pilot/session'
import { pilotStore } from '@/lib/pilot/store'

// POST /api/devices/contact { session, name?, email?, address_note? } — the optional last
// step of /start: "wil je een rapport over je eigen huis ontvangen?". Stored in
// device_contacts, the ONLY table that links a sensor number to a person
// (docs/pilot-cockpit-plan.md §2c). Session-gated like the profile; empty email = no
// report consent. Never returned to the client.

export const dynamic = 'force-dynamic'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export async function POST(req: NextRequest) {
  const rl = consume(`devcontact:${clientIp(req.headers)}`, LIMITS.deviceStart)
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })

  const body = await req.json().catch(() => null)
  const session = verifySession(body?.session)
  if (!session) return NextResponse.json({ error: 'session_invalid' }, { status: 401 })

  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '') || null
  const email = str(body?.email, 160)?.toLowerCase() ?? null
  if (email && !EMAIL_RE.test(email)) return NextResponse.json({ error: 'email_invalid' }, { status: 400 })
  const contact = { name: str(body?.name, 80), email, address_note: str(body?.address_note, 160) }
  if (!contact.name && !contact.email && !contact.address_note) return NextResponse.json({ error: 'empty' }, { status: 400 })

  let result
  try { result = await pilotStore().saveContact(session.deviceId, contact) } catch { return NextResponse.json({ error: 'unconfigured' }, { status: 503 }) }
  if (result !== 'ok') return NextResponse.json({ error: 'error' }, { status: 500 })
  return NextResponse.json({ ok: true, report_by_email: !!email })
}
