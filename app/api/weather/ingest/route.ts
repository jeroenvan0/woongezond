import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Hourly weather ingestion — one OpenWeather call per CITY that has an active
// device, written to city_weather. Triggered by the woongezond-weather systemd
// timer; protected by the x-cron-secret header. Uses the service-role key so it
// can write past RLS (city_weather has no authenticated INSERT policy).

export const dynamic = 'force-dynamic'

interface OwmRow {
  temp: number | null
  humidity: number | null
  pressure: number | null
  wind_speed: number | null
  description: string | null
}

async function fetchCity(lat: number, lon: number, key: string): Promise<OwmRow | null> {
  try {
    const r = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&lang=nl&appid=${key}`,
      { cache: 'no-store' },
    )
    if (!r.ok) return null
    const d = await r.json()
    const m = d.main ?? {}, w = d.wind ?? {}, wx = (d.weather ?? [{}])[0] ?? {}
    return {
      temp: m.temp ?? null,
      humidity: m.humidity ?? null,
      pressure: m.pressure ?? null,
      wind_speed: w.speed ?? null,
      description: (wx.description ?? '').replace(/^\w/, (c: string) => c.toUpperCase()) || null,
    }
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const key = process.env.OPENWEATHER_API_KEY
  if (!key) return NextResponse.json({ error: 'OPENWEATHER_API_KEY not set' }, { status: 500 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  // Only fetch cities that actually have an active device — no wasted API calls.
  const { data: devices, error: devErr } = await supabase
    .from('devices')
    .select('city_id')
    .eq('active', true)
    .not('city_id', 'is', null)
  if (devErr) return NextResponse.json({ error: devErr.message }, { status: 500 })

  const cityIds = [...new Set((devices ?? []).map((d) => d.city_id))]
  if (!cityIds.length) return NextResponse.json({ ingested: 0, cities: 0 })

  const { data: cities, error: cityErr } = await supabase
    .from('cities')
    .select('id, name, lat, lon')
    .in('id', cityIds)
  if (cityErr) return NextResponse.json({ error: cityErr.message }, { status: 500 })

  // Bucket the observation to the top of the current hour so upserts are idempotent.
  const observed = new Date()
  observed.setMinutes(0, 0, 0)
  const observedAt = observed.toISOString()

  let ingested = 0
  const failures: string[] = []
  for (const c of cities ?? []) {
    const wx = await fetchCity(c.lat, c.lon, key)
    if (!wx || wx.temp == null) {
      failures.push(c.name ?? c.id)
      continue
    }
    const { error } = await supabase
      .from('city_weather')
      .upsert({ city_id: c.id, observed_at: observedAt, ...wx }, { onConflict: 'city_id,observed_at' })
    if (error) failures.push(`${c.name ?? c.id}: ${error.message}`)
    else ingested++
  }

  return NextResponse.json({ ingested, cities: cities?.length ?? 0, observedAt, failures })
}
