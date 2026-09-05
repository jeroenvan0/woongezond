import { NextRequest, NextResponse } from 'next/server'
import { consume, LIMITS } from '@/lib/rateLimit'
import { CLAIM_CODE_RE, normalizeCode } from '@/lib/houseProfile'
import { pilotStore } from '@/lib/pilot/store'

// GET /api/devices/status?code=DEVICE-XXXX — the resident wizard's "is my sensor online
// yet?" poll (docs/pilot-cockpit-plan.md §2b). Public: the claim code on the sticker is
// the only credential. Returns deliberately little — a number, a device name and
// liveness. Never the token, never readings, never the owner.

export const dynamic = 'force-dynamic'
const ONLINE_WITHIN_MIN = 5

export async function GET(req: NextRequest) {
  const code = normalizeCode(req.nextUrl.searchParams.get('code') ?? '')
  if (!CLAIM_CODE_RE.test(code)) return NextResponse.json({ error: 'code_invalid' }, { status: 400 })
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local'
  const rl = consume(`devstatus:${ip}`, LIMITS.deviceStart)
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })

  let dev
  try { dev = await pilotStore().findByCode(code) } catch { return NextResponse.json({ error: 'unconfigured' }, { status: 503 }) }
  if (dev === 'not_deployed') return NextResponse.json({ error: 'not_deployed' }, { status: 503 })
  if (!dev) return NextResponse.json({ error: 'code_unknown' }, { status: 404 })

  const minutes = dev.last_seen_at ? (Date.now() - new Date(dev.last_seen_at).getTime()) / 60000 : null
  return NextResponse.json({
    device_number: dev.device_number,
    name: dev.name,
    ap_name: dev.device_number ? `Woongezond-${String(dev.device_number).padStart(2, '0')}` : 'Woongezond-XX',
    online: minutes != null && minutes <= ONLINE_WITHIN_MIN,
    last_seen: dev.last_seen_at,
    minutes_since: minutes == null ? null : Math.round(minutes),
    profile_completed: dev.profile_completed,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
