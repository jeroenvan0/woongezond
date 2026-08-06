import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { buildTrainingSet, train } from '@/lib/ml'
import { enforce, LIMITS } from '@/lib/rateLimit'
import { SensorReading } from '@/lib/ml'

async function client() {
  const cookieStore = await cookies()
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (c) => {
        try {
          c.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {}
      },
    },
  })
}

async function fetchReadings(supabase: any, days: number): Promise<SensorReading[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const readings: SensorReading[] = []
  const PAGE = 1000
  for (let offset = 0; offset < 200000; offset += PAGE) {
    const { data, error } = await supabase
      .from('air_quality')
      .select('created_at,co2,temperature,humidity')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error || !data?.length) break
    for (const r of data) {
      readings.push({
        timestamp: new Date(r.created_at).getTime(),
        co2: +(r.co2 ?? 0),
        temperature: +(r.temperature ?? 0),
        humidity: +(r.humidity ?? 0),
      })
    }
    if (data.length < PAGE) break
  }
  return readings
}

export async function POST(req: Request) {
  const supabase = await client()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

  // Scans up to 200k rows and refits the model — expensive, and pointless to repeat
  // within the hour since the fit barely moves.
  const limited = enforce('ml-retrain', user.id, LIMITS.mlRetrain)
  if (limited) return limited

  const body = await req.json().catch(() => ({}))
  const days = body.days ?? 30

  const readings = await fetchReadings(supabase, days)
  if (readings.length < 50) {
    return NextResponse.json({ ok: false, reason: 'insufficient_data', readings: readings.length })
  }

  const { X, yCo2, yRh } = buildTrainingSet(readings, 1.0)
  if (X.length < 10) {
    return NextResponse.json({ ok: false, reason: 'insufficient_samples', samples: X.length })
  }

  const weights = train(X, yCo2, yRh)
  const { error } = await supabase.from('ml_models').upsert({
    user_id: user.id,
    weights,
    trained_at: weights.trainedAt,
    sample_count: weights.sampleCount,
    metrics: weights.metrics,
  })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    sampleCount: weights.sampleCount,
    metrics: weights.metrics,
    trainedAt: weights.trainedAt,
  })
}
