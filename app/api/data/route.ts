import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { aggregateRows, pickBucketSeconds, spanSeconds, type BucketedRow } from '@/lib/bucketing'

// Eén rij naar buiten: gemiddelde per blok, plus laagste/hoogste (band in de grafiek) en
// het aantal metingen. Oudere RPC-versies zonder min/max-kolommen geven undefined → null.
function toRow(r: any): BucketedRow {
  const num = (v: unknown) => (v == null ? null : +v)
  return {
    created_at: r.created_at,
    co2: num(r.co2), temperature: num(r.temperature), humidity: num(r.humidity),
    co2_min: num(r.co2_min), co2_max: num(r.co2_max),
    temperature_min: num(r.temperature_min), temperature_max: num(r.temperature_max),
    humidity_min: num(r.humidity_min), humidity_max: num(r.humidity_max),
    n: r.n == null ? 1 : +r.n,
  }
}

// Only pass a UUID through to the RPC — anything else is ignored (falls back to
// all-devices), so a stray query param can never widen or break the query.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest) {
  const minutes = parseInt(req.nextUrl.searchParams.get('minutes') ?? '1440')
  const deviceParam = req.nextUrl.searchParams.get('device')
  const deviceId = deviceParam && UUID_RE.test(deviceParam) ? deviceParam : null
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: ()=>cookieStore.getAll(), setAll:(c)=>{try{c.forEach(({name,value,options})=>cookieStore.set(name,value,options))}catch{}} } }
  )
  // Zonder geldige sessie gaf deze route een lege lijst met status 200 terug: de RPC is
  // voor anon ingetrokken, de fallback ziet door RLS nul rijen, en de grafiek toont dan
  // "Geen data" alsof de sensor niets gemeten heeft. Een expliciete 401 maakt het verschil
  // zichtbaar (DataBanner: "sessie verlopen"). getUser() ververst en passant het
  // auth-cookie, zodat een net verlopen token hier hersteld wordt in plaats van stil te falen.
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  // Fast path: aggregate server-side in a single RPC call. The function buckets
  // the whole window down to ≤~900 rows, so it stays under Supabase's row cap
  // and avoids fetching tens of thousands of raw readings.
  //
  // B3: pass the selected device through when we have one. The two-arg RPC may not be
  // deployed yet (migration 20260806120100), so fall back to the one-arg signature on a
  // param error — the app keeps working before the migration is applied.
  let bucketed: any = null
  let rpcError: any = null
  if (deviceId) {
    const r = await supabase.rpc('air_quality_bucketed', { minutes, p_device_id: deviceId })
    if (r.error && /p_device_id|function|does not exist|argument/i.test(r.error.message ?? '')) {
      const r2 = await supabase.rpc('air_quality_bucketed', { minutes })
      bucketed = r2.data; rpcError = r2.error
    } else {
      bucketed = r.data; rpcError = r.error
    }
  } else {
    const r = await supabase.rpc('air_quality_bucketed', { minutes })
    bucketed = r.data; rpcError = r.error
  }
  if (!rpcError && bucketed) {
    const bucketSec = bucketed[0]?.bucket_seconds ?? pickBucketSeconds(minutes, null)
    const rows = bucketed.map(toRow)
    // A3: ask for the true raw count. Falls back to bucket count if the RPC isn't
    // deployed yet — no worse than today, never blocks the response.
    let rawCount = rows.length
    const rc = await supabase.rpc('air_quality_raw_count', deviceId ? { minutes, p_device_id: deviceId } : { minutes })
    if (!rc.error && typeof rc.data === 'number') rawCount = rc.data
    return NextResponse.json({ rows, bucketMinutes: Math.round(bucketSec / 60), rawCount })
  }

  // Fallback: paginate raw rows and bucket in JS (used if the RPC is unavailable).
  const since = new Date(Date.now() - minutes * 60000).toISOString()
  const PAGE = 1000
  const MAX_ROWS = 600000
  const all: any[] = []
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    let q = supabase
      .from('air_quality')
      .select('created_at,co2,temperature,humidity')
      .gte('created_at', since)
    if (deviceId) q = q.eq('device_id', deviceId)   // nooit sensoren mengen, ook niet in de fallback
    const { data, error } = await q
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data?.length) break
    all.push(...data)
    if (data.length < PAGE) break
  }
  // Zelfde keuze als de RPC: de spanne van de data bepaalt het blok, de periode het plafond.
  const bucketSec = pickBucketSeconds(minutes, spanSeconds(all))
  const rows = aggregateRows(all, bucketSec)
  return NextResponse.json({ rows, bucketMinutes: Math.round(bucketSec / 60), rawCount: all.length })
}
