import { NextRequest, NextResponse } from 'next/server'
import { consume, LIMITS, clientIp } from '@/lib/rateLimit'
import { parseHouseProfile, deriveDeviceColumns } from '@/lib/houseProfile'
import { pilotStore, bootedRecently, OVERWRITE_WINDOW_MIN } from '@/lib/pilot/store'
import { verifySession } from '@/lib/pilot/session'
import { TERMS_VERSION } from '@/lib/pilot/terms'

// POST /api/devices/profile { session, answers, overwrite? } — the resident's house
// questions from /start (docs/pilot-cockpit-plan.md §2b).
//
// Auth is the signed 30-minute session from /api/devices/status, bound to one device —
// never the sticker code itself. A device that is already registered is only overwritten
// when the caller says so explicitly AND the sensor was (re)plugged in the last few
// minutes: physical possession, not a photo of the sticker, unlocks a re-registration.

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers)
  const rl = consume(`devprofile:${ip}`, LIMITS.deviceStart)
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })

  const body = await req.json().catch(() => null)
  const session = verifySession(body?.session)
  if (!session) return NextResponse.json({ error: 'session_invalid' }, { status: 401 })
  const parsed = parseHouseProfile(body?.answers)
  if (!parsed.ok) return NextResponse.json({ error: 'answers_incomplete', missing: parsed.missing }, { status: 400 })
  // The terms checkbox is not decoration: no acceptance of the current version, no save.
  if (body?.terms_accepted !== true || body?.terms_version !== TERMS_VERSION) return NextResponse.json({ error: 'terms_required', terms_version: TERMS_VERSION }, { status: 400 })

  const store = pilotStore()
  let dev
  try { dev = await store.findById(session.deviceId) } catch { return NextResponse.json({ error: 'unconfigured' }, { status: 503 }) }
  if (!dev) return NextResponse.json({ error: 'code_unknown' }, { status: 404 })

  if (dev.registered_at) {
    if (body?.overwrite !== true) return NextResponse.json({ error: 'already_registered', registered_at: dev.registered_at }, { status: 409 })
    if (!bootedRecently(dev)) return NextResponse.json({ error: 'overwrite_locked', registered_at: dev.registered_at, window_min: OVERWRITE_WINDOW_MIN }, { status: 423 })
  }

  const result = await store.saveProfile(dev.id, parsed.profile, TERMS_VERSION)
  if (result !== 'ok') return NextResponse.json({ error: 'error' }, { status: 500 })
  return NextResponse.json({ ok: true, overwritten: dev.registered_at != null, derived: deriveDeviceColumns(parsed.profile) })
}
