import { NextRequest, NextResponse } from 'next/server'
import { consume, LIMITS } from '@/lib/rateLimit'
import { CLAIM_CODE_RE, normalizeCode, parseHouseProfile, deriveDeviceColumns } from '@/lib/houseProfile'
import { pilotStore } from '@/lib/pilot/store'

// POST /api/devices/profile { code, answers } — the resident's house questions from
// /start (docs/pilot-cockpit-plan.md §2b). Public, code-gated: the code only ever unlocks
// the one device it was minted for. Writes house_profile (jsonb) plus the typed columns
// the science layer already reads (location/house_type/build_year/insulation).

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local'
  const rl = consume(`devprofile:${ip}`, LIMITS.deviceStart)
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })

  const body = await req.json().catch(() => null)
  const code = normalizeCode(typeof body?.code === 'string' ? body.code : '')
  if (!CLAIM_CODE_RE.test(code)) return NextResponse.json({ error: 'code_invalid' }, { status: 400 })
  const parsed = parseHouseProfile(body?.answers)
  if (!parsed.ok) return NextResponse.json({ error: 'answers_incomplete', missing: parsed.missing }, { status: 400 })

  let result
  try { result = await pilotStore().saveProfile(code, parsed.profile) } catch { return NextResponse.json({ error: 'unconfigured' }, { status: 503 }) }
  if (result === 'code_unknown') return NextResponse.json({ error: 'code_unknown' }, { status: 404 })
  if (result === 'error') return NextResponse.json({ error: 'error' }, { status: 500 })
  return NextResponse.json({ ok: true, derived: deriveDeviceColumns(parsed.profile) })
}
