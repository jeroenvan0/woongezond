import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

function bucketMinutes(minutes: number): number {
  if (minutes <= 2*1440)   return 1
  if (minutes <= 7*1440)   return 5
  if (minutes <= 30*1440)  return 15
  if (minutes <= 90*1440)  return 60
  if (minutes <= 365*1440) return 360
  return 720
}

function aggregate(rows: any[], bucketMin: number) {
  if (bucketMin <= 1 || !rows.length) return rows
  const bucketSec = bucketMin * 60
  const buckets: Record<number, any> = {}
  for (const r of rows) {
    const ts = new Date(r.created_at)
    const key = Math.floor(ts.getTime() / 1000 / bucketSec)
    if (!buckets[key]) buckets[key] = { created_at: r.created_at, co2: [], temperature: [], humidity: [] }
    if (r.co2 != null)          buckets[key].co2.push(+r.co2)
    if (r.temperature != null)  buckets[key].temperature.push(+r.temperature)
    if (r.humidity != null)     buckets[key].humidity.push(+r.humidity)
  }
  return Object.values(buckets).sort((a,b) => a.created_at.localeCompare(b.created_at)).map(b => ({
    created_at:  b.created_at,
    co2:         b.co2.length         ? b.co2.reduce((s:number,v:number)=>s+v,0)/b.co2.length         : null,
    temperature: b.temperature.length ? b.temperature.reduce((s:number,v:number)=>s+v,0)/b.temperature.length : null,
    humidity:    b.humidity.length    ? b.humidity.reduce((s:number,v:number)=>s+v,0)/b.humidity.length    : null,
  }))
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
    const bucketSec = bucketed[0]?.bucket_seconds ?? bucketMinutes(minutes) * 60
    const rows = bucketed.map((r: any) => ({
      created_at: r.created_at,
      co2: r.co2,
      temperature: r.temperature,
      humidity: r.humidity,
    }))
    // A3: ask for the true raw count. Falls back to bucket count if the RPC isn't
    // deployed yet — no worse than today, never blocks the response.
    let rawCount = rows.length
    const rc = await supabase.rpc('air_quality_raw_count', deviceId ? { minutes, p_device_id: deviceId } : { minutes })
    if (!rc.error && typeof rc.data === 'number') rawCount = rc.data
    return NextResponse.json({ rows, bucketMinutes: Math.round(bucketSec / 60), rawCount })
  }

  // Fallback: paginate raw rows and bucket in JS (used if the RPC is unavailable).
  const since = new Date(Date.now() - minutes * 60000).toISOString()
  const bucketMin = bucketMinutes(minutes)
  const PAGE = 1000
  const MAX_ROWS = 600000
  const all: any[] = []
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { data, error } = await supabase
      .from('air_quality')
      .select('created_at,co2,temperature,humidity')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data?.length) break
    all.push(...data)
    if (data.length < PAGE) break
  }
  const rows = aggregate(all, bucketMin)
  return NextResponse.json({ rows, bucketMinutes: bucketMin, rawCount: all.length })
}
