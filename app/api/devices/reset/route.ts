import { NextRequest, NextResponse } from 'next/server'
import { consume, LIMITS, clientIp } from '@/lib/rateLimit'
import { verifySession } from '@/lib/pilot/session'
import { pilotStore, bootedRecently, OVERWRITE_WINDOW_MIN } from '@/lib/pilot/store'

// POST /api/devices/reset { session } — "Sensor resetten" in /start.
// Clears the registration (house profile, terms, contact) and queues 'reset_wifi' for the
// sensor, which picks it up on its next reading and reopens the setup network.
// Measurements and the token stay: the hardware keeps its identity and its history.
// Same possession proof as a handover: the sensor must have been (re)plugged in the last
// few minutes — a photo of the sticker cannot reset someone's sensor.

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const rl = consume(`devreset:${clientIp(req.headers)}`, LIMITS.deviceStart)
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })
  const body = await req.json().catch(() => null)
  const session = verifySession(body?.session)
  if (!session) return NextResponse.json({ error: 'session_invalid' }, { status: 401 })

  const store = pilotStore()
  let dev
  try { dev = await store.findById(session.deviceId) } catch { return NextResponse.json({ error: 'unconfigured' }, { status: 503 }) }
  if (!dev) return NextResponse.json({ error: 'code_unknown' }, { status: 404 })
  if (!bootedRecently(dev)) return NextResponse.json({ error: 'reset_locked', window_min: OVERWRITE_WINDOW_MIN }, { status: 423 })

  const result = await store.resetDevice(dev.id)
  if (result !== 'ok') return NextResponse.json({ error: 'error' }, { status: 500 })
  return NextResponse.json({ ok: true, command: 'reset_wifi' })
}
