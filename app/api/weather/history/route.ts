import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { rTotaalForInsulation } from '@/lib/calculations'

// Historical outdoor weather + house context for one sensor. The schimmelrisico page and
// the cockpit join this hourly series onto the indoor T/RH samples (lib/mouldRisk.ts):
// outdoor temperature for the cold-spot surface, outdoor humidity for the moisture load,
// and the house profile for the cold-spot factor.
//
// ?device=<uuid> → that sensor (RLS: your own, or one in an org you administer). Without
// it: your own most recently active sensor, as before.

export const dynamic = 'force-dynamic'

const DEFAULT_CITY = { lat: 52.37, lon: 4.89 } // Amsterdam fallback
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest) {
  const minutes = Math.min(parseInt(req.nextUrl.searchParams.get('minutes') ?? String(28 * 1440)) || 28 * 1440, 400 * 1440)
  const deviceParam = req.nextUrl.searchParams.get('device')
  const deviceId = deviceParam && UUID_RE.test(deviceParam) ? deviceParam : null
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (c) => {
          try {
            c.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {}
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // The chosen sensor (RLS decides whether you may see it), else your primary device.
  // Falls back to the default Amsterdam city / 'poor' insulation without device context.
  let ctx: { id?: string; insulation?: string | null; city_id?: string | null; house_profile?: Record<string, string> | null } | null = null
  if (deviceId) {
    const { data } = await supabase.from('devices').select('id, insulation, city_id, house_profile').eq('id', deviceId).maybeSingle()
    ctx = data
  }
  if (!ctx) {
    const { data: ctxData } = await supabase.rpc('schimmel_device_context').maybeSingle()
    const c = ctxData as { device_id?: string; insulation?: string; city_id?: string } | null
    if (c?.device_id) {
      const { data } = await supabase.from('devices').select('house_profile').eq('id', c.device_id).maybeSingle()
      ctx = { id: c.device_id, insulation: c.insulation, city_id: c.city_id, house_profile: data?.house_profile ?? null }
    }
  }
  const insulation: string = ctx?.insulation ?? 'poor'
  const rTotaal = rTotaalForInsulation(insulation)
  const profile = ctx?.house_profile ?? null
  const device = ctx?.id ?? null

  let cityId = ctx?.city_id ?? null
  if (!cityId) {
    const { data: fallback } = await supabase
      .from('cities')
      .select('id')
      .eq('lat', DEFAULT_CITY.lat)
      .eq('lon', DEFAULT_CITY.lon)
      .limit(1)
      .maybeSingle()
    cityId = fallback?.id ?? null
  }
  if (!cityId) return NextResponse.json({ rows: [], cityId: null, insulation, rTotaal, profile, device })

  // Hourly rows; 90 days is ~2 200 rows, past PostgREST's page cap — so page through.
  const since = new Date(Date.now() - minutes * 60000).toISOString()
  const rows: { observed_at: string; temp: number | null; humidity: number | null }[] = []
  for (let off = 0; off < 20000; off += 1000) {
    const { data, error } = await supabase
      .from('city_weather')
      .select('observed_at, temp, humidity')
      .eq('city_id', cityId)
      .gte('observed_at', since)
      .order('observed_at', { ascending: true })
      .range(off, off + 999)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }

  return NextResponse.json({ rows, cityId, insulation, rTotaal, profile, device })
}
