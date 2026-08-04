import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { rTotaalForInsulation } from '@/lib/calculations'

// Historical outdoor weather + wall properties for the logged-in user's house.
// The schimmelrisico page joins this hourly series onto its indoor T/RH samples
// to reconstruct wall-surface conditions, using the per-device insulation class
// to set R_totaal (see lib/calculations.ts::calcWallConditions).

export const dynamic = 'force-dynamic'

const DEFAULT_CITY = { lat: 52.37, lon: 4.89 } // Amsterdam fallback

export async function GET(req: NextRequest) {
  const minutes = parseInt(req.nextUrl.searchParams.get('minutes') ?? String(28 * 1440))
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

  // Primary device for this user → its city + insulation class. Falls back to
  // the default Amsterdam city / 'poor' insulation when no device context exists.
  const { data: ctxData } = await supabase.rpc('schimmel_device_context').maybeSingle()
  const ctx = ctxData as { insulation?: string; city_id?: string } | null
  const insulation: string = ctx?.insulation ?? 'poor'
  const rTotaal = rTotaalForInsulation(insulation)

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
  if (!cityId) return NextResponse.json({ rows: [], cityId: null, insulation, rTotaal })

  const since = new Date(Date.now() - minutes * 60000).toISOString()
  const { data, error } = await supabase
    .from('city_weather')
    .select('observed_at, temp, humidity')
    .eq('city_id', cityId)
    .gte('observed_at', since)
    .order('observed_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ rows: data ?? [], cityId, insulation, rTotaal })
}
