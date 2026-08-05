import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { enforce, LIMITS } from '@/lib/rateLimit'

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY!
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? 'google/gemini-2.5-flash'

const SYSTEM = `Je bent een luchtkwaliteitsadviseur. Geef UITSLUITEND een JSON array terug op basis van deze drempelwaarden:
- CO₂ nacht > 1000 ppm → slaapkamerventilatie
- Binnen RV > 65% → vochtreductie
- Schimmelrisico > 60 → wand/hoekinspectie
- ACH < 0.9 → mechanische ventilatie / filtercontrole
- Wandtemp < dauwpunt + 2°C → condensatie/isolatie waarschuwing
Formaat exact: [{"title":"...","body":"...","severity":"info"|"warning"|"critical"}]
Geen markdown, geen codeblokken, geen tekst buiten de JSON. Nederlands. Max 4 aanbevelingen.`

export async function POST(req: NextRequest) {
  const { context } = await req.json()
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
  if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

  // Costs money per call (OpenRouter). Rate limit after auth, per user.
  const limited = enforce('recommendations', user.id, LIMITS.recommendations)
  if (limited) return limited

  if (!OPENROUTER_KEY) return NextResponse.json({ recommendations: [] })

  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json', 'X-Title': 'Luchtkwaliteit Scenarios' },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        temperature: 0.4,
        max_tokens: 600,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Scenario: ${context}` },
        ],
      }),
    })
    const d = await r.json()
    const text: string = d.choices?.[0]?.message?.content ?? ''
    const match = text.match(/\[[\s\S]*\]/)
    const recommendations = match ? JSON.parse(match[0]) : []
    return NextResponse.json({ recommendations })
  } catch (e: any) {
    return NextResponse.json({ recommendations: [], error: e?.message ?? 'fout' })
  }
}
