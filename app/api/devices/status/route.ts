import { NextRequest, NextResponse } from 'next/server'
import { consume, LIMITS, clientIp } from '@/lib/rateLimit'
import { CLAIM_CODE_RE, normalizeCode } from '@/lib/houseProfile'
import { pilotStore, bootedRecently, pilotMockEnabled } from '@/lib/pilot/store'
import { issueSession, verifySession } from '@/lib/pilot/session'

// GET /api/devices/status?code=DEVICE-XXXXXX   — first call: exchanges the sticker code for
// GET /api/devices/status?session=wgs_…         — a 30-minute session; polls then use that.
//
// The resident wizard's "is my sensor online yet?" poll (docs/pilot-cockpit-plan.md §2b).
// Public. Returns deliberately little — a number, a device name, liveness, whether the
// house profile was already filled in — never the token, readings or owner. Rate-limited
// per IP and per code so the code space (32^6) cannot be walked.

export const dynamic = 'force-dynamic'
const ONLINE_WITHIN_MIN = 5

export async function GET(req: NextRequest) {
  const ip = clientIp(req.headers)
  const rl = consume(`devstatus:${ip}`, LIMITS.deviceStart)
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })

  const store = pilotStore()
  let dev
  try {
    const session = verifySession(req.nextUrl.searchParams.get('session'))
    if (session) {
      dev = await store.findById(session.deviceId)
    } else {
      const code = normalizeCode(req.nextUrl.searchParams.get('code') ?? '')
      if (!CLAIM_CODE_RE.test(code)) return NextResponse.json({ error: 'code_invalid' }, { status: 400 })
      // A test sticker (DEVICE-MOCK…) scanned against the real database: say so, instead of
      // a generic "unknown" that sends people re-typing a code that can never work.
      if (code.startsWith('DEVICE-MOCK') && !pilotMockEnabled()) return NextResponse.json({ error: 'mock_code' }, { status: 404 })
      const rlCode = consume(`devcode:${code}`, LIMITS.deviceCode)
      if (!rlCode.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rlCode.retryAfterSec) } })
      dev = await store.findByCode(code)
    }
  } catch { return NextResponse.json({ error: 'unconfigured' }, { status: 503 }) }
  if (dev === 'not_deployed') return NextResponse.json({ error: 'not_deployed' }, { status: 503 })
  if (!dev) return NextResponse.json({ error: 'code_unknown' }, { status: 404 })

  const minutes = dev.last_seen_at ? (Date.now() - new Date(dev.last_seen_at).getTime()) / 60000 : null
  const session = issueSession(dev.id)
  return NextResponse.json({
    session: session.token,
    session_expires_at: session.expires_at,
    device_number: dev.device_number,
    name: dev.name,
    ap_name: dev.device_number ? `Woongezond-${String(dev.device_number).padStart(2, '0')}` : 'Woongezond-XX',
    online: minutes != null && minutes <= ONLINE_WITHIN_MIN,
    last_seen: dev.last_seen_at,
    minutes_since: minutes == null ? null : Math.round(minutes),
    registered_at: dev.registered_at,
    recent_boot: bootedRecently(dev),
  }, { headers: { 'Cache-Control': 'no-store' } })
}
