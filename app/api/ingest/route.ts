import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { consume, LIMITS } from '@/lib/rateLimit'
import { log, errText } from '@/lib/logger'
import { pilotMockEnabled, pilotStore, RECENT_BOOT_UPTIME_S } from '@/lib/pilot/store'

// Per-device sensor ingest — the pilot's write path (Feather S3). See docs/pilot-feather-s3-plan.md.
//
// The device authenticates with its own ingest token (header `x-device-token`, or
// `?token=`), NOT the anon key. We look the token up with the service role, find the
// device (and its owner), and insert the reading scoped to that device_id/user_id. This
// replaces the baseline anon-sync hole that could only write to one hardcoded user.
//
// No cookie/session auth: a sensor is not a browser user. The token IS the credential.

export const dynamic = 'force-dynamic'

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}
const intOrNull = (v: unknown): number | null => {
  const n = num(v)
  return n == null ? null : Math.round(n)
}

export async function POST(req: NextRequest) {
  const token = (req.headers.get('x-device-token') || req.nextUrl.searchParams.get('token') || '').trim()
  if (!token) return NextResponse.json({ error: 'token_required' }, { status: 401 })

  // Rate-limit per token BEFORE any DB work, so a flood of bad tokens is cheap to reject.
  const rl = consume(`ingest:${token.slice(0, 40)}`, LIMITS.ingest)
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited', retryAfter: rl.retryAfterSec }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'bad_body' }, { status: 400 })

  const co2 = intOrNull(body.co2)
  const temperature = num(body.temperature ?? body.temp)
  const humidity = num(body.humidity ?? body.rh)
  const voc_index = intOrNull(body.voc_index ?? body.voc)
  const nox_index = intOrNull(body.nox_index ?? body.nox)
  // Optional device telemetry for the cockpit (docs/pilot-cockpit-plan.md §3, fase 1).
  const rssi = intOrNull(body.rssi)
  const fw = typeof body.fw === 'string' ? body.fw.slice(0, 32) : null
  const bootCount = intOrNull(body.boot_count)
  const uptimeS = intOrNull(body.uptime_s)
  if (co2 == null && temperature == null && humidity == null) {
    return NextResponse.json({ error: 'no_metrics' }, { status: 400 })
  }

  // Local UX testing without a database (PILOT_MOCK=1, never in production): a mock
  // token marks the mock device as seen and stores nothing.
  if (pilotMockEnabled()) {
    const mock = pilotStore().mockIngest(token, { rssi, fw, boot_count: bootCount, uptime_s: uptimeS })
    if (mock) return NextResponse.json({ ok: true, device_id: mock.id, claimed: false, mock: true })
  }

  let supabase
  try { supabase = createServiceClient() } catch (e) {
    log.error('ingest', 'service client unavailable', { detail: errText(e) })
    return NextResponse.json({ error: 'unconfigured' }, { status: 503 })
  }

  // Resolve the device from its token. Service role, so RLS doesn't hide it.
  const { data: device, error: devErr } = await supabase
    .from('devices')
    .select('id, user_id, active')
    .eq('ingest_token', token)
    .limit(1)
    .maybeSingle()
  if (devErr) { log.error('ingest', 'device lookup failed', { detail: devErr.message }); return NextResponse.json({ error: 'error' }, { status: 500 }) }
  if (!device) return NextResponse.json({ error: 'invalid_token' }, { status: 401 })
  if (device.active === false) return NextResponse.json({ error: 'device_inactive' }, { status: 403 })

  // Insert scoped to this device. user_id may be null until the resident claims it; the
  // claim RPC backfills those rows (migration 20260806120400).
  const { error: insErr } = await supabase.from('air_quality').insert({
    device_id: device.id,
    user_id: device.user_id ?? null,
    co2, temperature, humidity, voc_index, nox_index,
  })
  if (insErr) { log.error('ingest', 'insert failed', { device_id: device.id, detail: insErr.message }); return NextResponse.json({ error: 'insert_failed' }, { status: 500 }) }

  // Liveness bookkeeping on the device row (migration 20260905120000): cheap for the
  // /start status poll and the cockpit. Best effort — never turn a stored reading into
  // an error for the sensor, and tolerate the columns not existing yet.
  const touch: Record<string, unknown> = { last_seen_at: new Date().toISOString() }
  if (rssi != null) touch.last_rssi = rssi
  if (fw) touch.fw_version = fw
  if (bootCount != null) touch.boot_count = bootCount
  // A small uptime = the sensor was just (re)plugged; /start uses this as possession proof.
  if (uptimeS != null && uptimeS >= 0 && uptimeS < RECENT_BOOT_UPTIME_S) touch.last_boot_at = new Date(Date.now() - uptimeS * 1000).toISOString()
  const { error: touchErr } = await supabase.from('devices').update(touch).eq('id', device.id)
  if (touchErr && !/column|schema cache/i.test(touchErr.message)) log.warn('ingest', 'last_seen update failed', { device_id: device.id, detail: touchErr.message })

  return NextResponse.json({ ok: true, device_id: device.id, claimed: device.user_id != null })
}
