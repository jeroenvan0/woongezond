/**
 * One-off / re-runnable historical weather backfill.
 *
 * OpenWeather's free tier only returns *current* weather, so the hourly ingest
 * cron can't fill the past. Open-Meteo's archive/forecast API is free, needs no
 * key, and serves hourly history — we use it to populate city_weather for every
 * city over the last N days. Upserts on (city_id, observed_at), so it's safe to
 * re-run and it harmonises with the live OpenWeather hourly rows.
 *
 *   npx tsx scripts/backfill-weather.mts [days]   (default 35)
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// Load env from .env.local (tsx doesn't do this automatically).
const env: Record<string, string> = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2]
}

const days = Math.min(Math.max(parseInt(process.argv[2] ?? '35', 10) || 35, 1), 92)
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

interface Row {
  city_id: string
  observed_at: string
  temp: number | null
  humidity: number | null
  pressure: number | null
  wind_speed: number | null
}

async function backfillCity(city: { id: string; name: string | null; lat: number; lon: number }) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}` +
    `&hourly=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m` +
    `&past_days=${days}&forecast_days=1&timezone=UTC`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Open-Meteo ${r.status} for ${city.name}`)
  const d: any = await r.json()
  const h = d.hourly ?? {}
  const time: string[] = h.time ?? []

  const rows: Row[] = time.map((t, i) => ({
    city_id: city.id,
    observed_at: new Date(`${t}:00Z`).toISOString(), // "2026-05-22T00:00" → top-of-hour UTC
    temp: h.temperature_2m?.[i] ?? null,
    humidity: h.relative_humidity_2m?.[i] ?? null,
    pressure: h.surface_pressure?.[i] ?? null,
    wind_speed: h.wind_speed_10m?.[i] != null ? +(h.wind_speed_10m[i] / 3.6).toFixed(2) : null, // km/h → m/s
  })).filter((row) => row.temp != null)

  // Upsert in chunks to stay well under request limits.
  let written = 0
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const { error } = await supabase
      .from('city_weather')
      .upsert(chunk, { onConflict: 'city_id,observed_at' })
    if (error) throw new Error(`upsert ${city.name}: ${error.message}`)
    written += chunk.length
  }
  console.log(`  ${city.name ?? city.id}: ${written} hourly rows (${days}d)`)
}

const { data: cities, error } = await supabase.from('cities').select('id, name, lat, lon')
if (error) throw error
console.log(`Backfilling ${cities?.length ?? 0} cities, last ${days} days…`)
for (const c of cities ?? []) await backfillCity(c as any)
console.log('Done.')
