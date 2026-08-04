import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET() {
  const cookieStore = await cookies()
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (c) => {
        try {
          c.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {}
      },
    },
  })
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ model: null })

  const { data } = await supabase
    .from('ml_models')
    .select('weights,sample_count,trained_at,metrics')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  return NextResponse.json({ model: data?.weights ?? null, meta: data ? { sampleCount: data.sample_count, trainedAt: data.trained_at, metrics: data.metrics } : null })
}
