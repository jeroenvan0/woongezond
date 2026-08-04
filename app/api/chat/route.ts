import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { CHAT_SYSTEM_PROMPT, CHAT_TOOLS, buildDataSummary, formatSensorQuery } from '@/lib/chatTools'
import { toSeries, buildDiagnosis, Diagnosis } from '@/lib/reportAnalytics'
import { analyzeNights, NightsAnalysis } from '@/lib/nightForecast'
import { beforeAfter } from '@/lib/trends'

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY!
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? 'google/gemini-2.5-flash'
const MAX_TOOL_ROUNDS = 4

async function fetchWeatherText(): Promise<string> {
  const KEY = process.env.OPENWEATHER_API_KEY
  if (!KEY) return ''
  const LAT = '52.37',
    LON = '4.89'
  try {
    const [wr, pr] = await Promise.all([
      fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${LAT}&lon=${LON}&units=metric&lang=nl&appid=${KEY}`, {
        next: { revalidate: 600 },
      }).then((r) => r.json()),
      fetch(`https://api.openweathermap.org/data/2.5/air_pollution?lat=${LAT}&lon=${LON}&appid=${KEY}`, {
        next: { revalidate: 900 },
      }).then((r) => r.json()),
    ])
    const m = wr.main ?? {},
      w = wr.wind ?? {},
      wx = (wr.weather ?? [{}])[0] ?? {}
    const aqiLabels: Record<number, string> = { 1: 'Goed', 2: 'Redelijk', 3: 'Matig', 4: 'Slecht', 5: 'Zeer slecht' }
    const comp = (pr.list ?? [{}])[0]?.components ?? {}
    const aqi = (pr.list ?? [{}])[0]?.main?.aqi
    const lines = [
      'Actuele buitenomstandigheden (' + (wr.name ?? 'onbekend') + '):',
      `  Temperatuur:      ${m.temp != null ? m.temp.toFixed(1) : '—'} °C`,
      `  Luchtvochtigheid: ${m.humidity ?? '—'} %`,
      `  Luchtdruk:        ${m.pressure ?? '—'} hPa`,
      `  Wind:             ${w.speed ?? '—'} m/s`,
      `  Conditie:         ${(wx.description ?? '—').replace(/^\w/, (c: string) => c.toUpperCase())}`,
    ]
    if (aqi)
      lines.push(
        '',
        'Buitenluchtkwaliteit:',
        `  AQI:   ${aqiLabels[aqi] ?? '—'} (${aqi})`,
        `  PM2.5: ${comp.pm2_5 ?? '—'} µg/m³ | PM10: ${comp.pm10 ?? '—'} µg/m³ | NO₂: ${comp.no2 ?? '—'} | O₃: ${comp.o3 ?? '—'}`,
      )
    return lines.join('\n')
  } catch {
    return 'Buitenweerdata niet beschikbaar.'
  }
}

// ── Tool-result formatters ───────────────────────────────────────────────────

const fmtDay = (ms: number) => new Date(ms).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })

function formatNights(a: NightsAnalysis | null): string {
  if (!a) return 'Er zijn nog te weinig nachten gemeten om nachten te kunnen vergelijken.'
  const verdict =
    a.lastPeakVsMedian <= -50
      ? 'beter (lager) dan gemiddeld'
      : a.lastPeakVsMedian >= 50
        ? 'slechter (hoger) dan gemiddeld'
        : 'vergelijkbaar met gemiddeld'
  const recent = a.nights
    .slice(-7)
    .map((n) => `  ${fmtDay(n.dateMs)}: piek ${Math.round(n.peak)} ppm (stijging +${Math.round(n.rise)} ppm)`)
  return [
    `Nachtanalyse over ${a.nights.length} nachten:`,
    `Laatste nacht — piek ${Math.round(a.last.peak)} ppm, stijging +${Math.round(a.last.rise)} ppm t.o.v. de avond.`,
    `Mediaan over alle nachten — piek ${a.medianPeak} ppm, stijging +${a.medianRise} ppm.`,
    `De laatste nacht was ${verdict} (${a.lastPeakVsMedian >= 0 ? '+' : ''}${a.lastPeakVsMedian} ppm t.o.v. de mediaanpiek).`,
    'Recente nachten:',
    ...recent,
  ].join('\n')
}

function formatDiagnosis(d: Diagnosis): string {
  const lines = [
    `Conclusie: ${d.conclusieTxt} (${d.sevLabel}).`,
    d.ach ? `Ventilatie: ACH ${d.ach.achGem}/uur (${d.ach.voldoet ? 'voldoet aan norm ≥0,9' : 'ONDER de norm van 0,9'}).` : '',
    d.nacht ? `CO₂ nacht/dag: ${d.nacht.gemNacht}/${d.nacht.gemDag} ppm${d.nacht.probleem ? ' (loopt \'s nachts te hoog op)' : ''}.` : '',
    `Schimmelrisico > 60: ${d.pctMr60.toFixed(0)}% van de tijd.`,
    d.cv ? `Vochtprofiel: ${d.cv.interpretatie} (gem. RV ${d.cv.gemRh}%).` : '',
    'Bevindingen:',
    d.findings.length ? d.findings.map((f) => `  - ${f.text}`).join('\n') : '  - Geen structurele afwijkingen.',
  ]
  return lines.filter(Boolean).join('\n')
}

export async function POST(req: NextRequest) {
  const { messages, sessionId } = await req.json()
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

  if (!OPENROUTER_KEY) return NextResponse.json({ reply: '⚠ Voeg OPENROUTER_API_KEY toe om de AI-chat te activeren.' })

  // RLS-scoped, server-side aggregated fetch (one row per bucket).
  async function fetchBucketed(minutes: number) {
    const { data } = await supabase.rpc('air_quality_bucketed', { minutes })
    return (data ?? []).map((r: any) => ({ created_at: r.created_at, co2: r.co2, temperature: r.temperature, humidity: r.humidity }))
  }

  // System prompt with recent data + weather context
  const { data: recentRows } = await supabase
    .from('air_quality')
    .select('created_at,co2,temperature,humidity')
    .order('created_at', { ascending: false })
    .limit(720)
  const rows = (recentRows ?? []).slice().reverse()
  const now = new Date()
  let system = CHAT_SYSTEM_PROMPT(
    now.toISOString(),
    now.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  )
  system += `\n\n## Huidige dashboarddata\n${buildDataSummary(rows)}`
  const weatherCtx = await fetchWeatherText()
  if (weatherCtx) system += `\n\n## Actuele buitenomstandigheden\n${weatherCtx}`

  const apiMsgs: any[] = [{ role: 'system', content: system }]
  for (const m of messages) if (m.role === 'user' || m.role === 'assistant') apiMsgs.push({ role: m.role, content: m.content ?? '' })

  async function post(msgs: any[], withTools: boolean) {
    const body: any = { model: OPENROUTER_MODEL, messages: msgs, max_tokens: 900, temperature: 0.5 }
    if (withTools) {
      body.tools = CHAT_TOOLS
      body.tool_choice = 'auto'
    }
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_KEY}`,
        'HTTP-Referer': 'https://vostech.group',
        'X-Title': 'Luchtkwaliteit Dashboard',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    return r.json()
  }

  async function executeTool(name: string, args: any): Promise<string> {
    try {
      if (name === 'query_sensor_data') {
        const { start, end } = args
        if (!start || !end) return 'Ongeldige periode.'
        const { data } = await supabase
          .from('air_quality')
          .select('created_at,co2,temperature,humidity')
          .gte('created_at', start)
          .lte('created_at', end)
          .order('created_at', { ascending: true })
          .limit(20000)
        return formatSensorQuery(data ?? [], start, end)
      }
      if (name === 'query_current_weather') return (await fetchWeatherText()) || 'Buitenweerdata niet beschikbaar.'
      if (name === 'analyze_nights') {
        const rows = await fetchBucketed(14 * 1440)
        const readings = rows
          .filter((r: any) => r.co2 != null && r.created_at)
          .map((r: any) => ({ timestamp: new Date(r.created_at).getTime(), co2: +r.co2 }))
        return formatNights(analyzeNights(readings, Date.now()))
      }
      if (name === 'get_diagnosis') {
        const days = Math.max(1, Math.min(90, Math.round(args?.days ?? 14)))
        const rows = await fetchBucketed(days * 1440)
        const series = toSeries(rows as any)
        if (!series.co2.length) return 'Geen sensordata beschikbaar voor de diagnose.'
        return formatDiagnosis(buildDiagnosis(series))
      }
      if (name === 'intervention_effects') {
        const { data: ivs } = await supabase
          .from('interventions')
          .select('label,intervention_date')
          .order('intervention_date', { ascending: false })
          .limit(15)
        if (!ivs?.length) return 'Er zijn nog geen interventies geregistreerd om het effect van te meten.'
        const rows = await fetchBucketed(120 * 1440) // wide window for the ±2-week comparisons
        const fmt = (a: number | null, b: number | null, u: string) =>
          a == null || b == null ? '—' : `${a}→${b}${u} (${b - a >= 0 ? '+' : ''}${(b - a).toFixed(0)}${u})`
        const lines = ivs.map((iv: any) => {
          const ba = beforeAfter(rows as any, iv.intervention_date)
          if (!ba) return `${iv.intervention_date} — ${iv.label}: onvoldoende data rond deze datum.`
          return `${iv.intervention_date} — ${iv.label}: CO₂ ${fmt(ba.co2Before, ba.co2After, ' ppm')}, RV ${fmt(ba.rhBefore, ba.rhAfter, '%')}, gezondheidsscore ${ba.scoreBefore ?? '—'}→${ba.scoreAfter ?? '—'}`
        })
        return ['Effect van interventies (gemiddelde 2 weken vóór → ná):', ...lines].join('\n')
      }
      return `Onbekende tool: ${name}`
    } catch (e: any) {
      return `Tool-uitvoeringsfout in ${name}: ${e?.message ?? e}`
    }
  }

  let reply = 'Sorry, ik kon geen antwoord genereren.'
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const allowTools = round < MAX_TOOL_ROUNDS - 1
      const result = await post(apiMsgs, allowTools)
      const message = result.choices?.[0]?.message
      if (!message) break
      apiMsgs.push(message)
      const toolCalls = message.tool_calls ?? []
      if (!toolCalls.length) {
        reply = (message.content ?? '').trim() || reply
        break
      }
      for (const tc of toolCalls) {
        let args = {}
        try {
          args = JSON.parse(tc.function?.arguments || '{}')
        } catch {}
        const toolResult = await executeTool(tc.function?.name ?? '', args)
        apiMsgs.push({ role: 'tool', tool_call_id: tc.id ?? '', content: toolResult })
      }
    }
  } catch (e: any) {
    reply = `⚠ Verbindingsfout: ${e?.message ?? e}`
  }

  // Persist; return assistant message id for feedback
  let messageId: string | null = null
  if (sessionId) {
    await supabase.from('chat_messages').insert({ session_id: sessionId, role: 'user', content: messages[messages.length - 1]?.content ?? '' })
    const { data: am } = await supabase.from('chat_messages').insert({ session_id: sessionId, role: 'assistant', content: reply }).select('id').single()
    messageId = am?.id ?? null
    const { count } = await supabase.from('chat_messages').select('id', { count: 'exact', head: true }).eq('session_id', sessionId)
    await supabase.from('chat_sessions').update({ message_count: count ?? 0, updated_at: new Date().toISOString() }).eq('id', sessionId)
  }

  return NextResponse.json({ reply, messageId })
}
