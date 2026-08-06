import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient, cronSecretOk } from '@/lib/supabase/service'
import { log, errText } from '@/lib/logger'

// Health / liveness endpoint.
//
// Two response shapes, deliberately:
//
//   GET /api/health                     → public, minimal. "is the app up, is the DB
//                                         reachable, are any devices stale" — booleans and
//                                         counts only, no device names, no locations, no
//                                         readings. This is what an uptime checker hits.
//
//   GET /api/health  + x-cron-secret    → detailed per-device breakdown for operators.
//
// The split is not paranoia: DECISIONS D1 records that get_device_locations() leaked every
// device's name + location to anyone with the public anon key, and residents' first names
// ARE the device names ("Jeroen Sensor", "Jannouk Sensor"). An unauthenticated health
// endpoint listing devices would reintroduce exactly that leak in a new place.
//
// Status codes are what a supervisor keys off, so they must mean something:
//   200 ok        — DB reachable, every active device reported recently
//   200 degraded  — DB reachable, but at least one active device is stale
//   503 error     — DB unreachable / query failed
//
// "degraded" is deliberately 200: a stale sensor is a device problem, not an app
// problem, and it must not cause a supervisor to restart or roll back the app.

export const dynamic = 'force-dynamic'

// A device writes ~every 60s (observed: 1,424 rows/day). 30 minutes of silence is
// well past jitter or a brief Wi-Fi blip, and still catches a failure the same hour.
const STALE_AFTER_MIN = 30

interface DeviceHealth {
  device_id: string
  name: string
  location: string | null
  last_seen: string | null
  minutes_since: number | null
  stale: boolean
}

export async function GET(req: NextRequest) {
  const detailed = cronSecretOk(req.headers.get('x-cron-secret'))
  const startedAt = Date.now()

  let supabase
  try {
    supabase = createServiceClient()
  } catch (e) {
    // Missing env vars land here — worth an explicit log, it is a deploy error.
    log.error('health', 'could not construct service client', { detail: errText(e) })
    return NextResponse.json({ status: 'error', database: 'unconfigured' }, { status: 503 })
  }

  // Active devices, and the newest reading for each. Two queries rather than a join:
  // air_quality is ~115k rows and growing, so we want the index-backed per-device max,
  // not a scan. The (user_id, created_at DESC) composite from M1 covers the ordering.
  const { data: devices, error: devErr } = await supabase
    .from('devices')
    .select('id, name, location, active')
    .eq('active', true)

  if (devErr) {
    log.error('health', 'devices query failed', { detail: devErr.message })
    return NextResponse.json({ status: 'error', database: 'unreachable' }, { status: 503 })
  }

  const health: DeviceHealth[] = []
  for (const d of devices ?? []) {
    const { data: rows, error } = await supabase
      .from('air_quality')
      .select('created_at')
      .eq('device_id', d.id)
      .order('created_at', { ascending: false })
      .limit(1)

    if (error) {
      log.error('health', 'last-reading query failed', { device_id: d.id, detail: error.message })
      return NextResponse.json({ status: 'error', database: 'unreachable' }, { status: 503 })
    }

    const lastSeen = rows?.[0]?.created_at ?? null
    const minutesSince = lastSeen ? Math.floor((Date.now() - new Date(lastSeen).getTime()) / 60000) : null
    health.push({
      device_id: d.id,
      name: d.name,
      location: d.location,
      last_seen: lastSeen,
      minutes_since: minutesSince,
      // A device that has never reported is stale — that is a real state today
      // (the "Feather S3" row has zero readings and nobody noticed).
      stale: minutesSince === null || minutesSince > STALE_AFTER_MIN,
    })
  }

  const stale = health.filter((h) => h.stale)
  const status = stale.length > 0 ? 'degraded' : 'ok'

  const body = {
    status,
    database: 'ok',
    checked_at: new Date().toISOString(),
    took_ms: Date.now() - startedAt,
    devices: { total: health.length, stale: stale.length },
    stale_after_minutes: STALE_AFTER_MIN,
    ...(detailed ? { detail: health.sort((a, b) => (b.minutes_since ?? Infinity) - (a.minutes_since ?? Infinity)) } : {}),
  }

  if (status === 'degraded') {
    log.warn('health', 'stale devices', { stale: stale.length, total: health.length })
  }

  return NextResponse.json(body, {
    status: 200,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
