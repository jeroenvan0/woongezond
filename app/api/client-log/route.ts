import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { log } from '@/lib/logger'
import { consume, LIMITS, clientIp } from '@/lib/rateLimit'

// Ontvangt meldingen van lib/clientLog.ts (mislukte fetches in de browser) en zet ze als
// één JSON-regel in de journal. Geen opslag, geen inhoud van metingen — alleen soort,
// status, pad, pagina en wie.
//
// Bewust ook zonder sessie bereikbaar: een verlopen sessie (401) is precies zo'n melding.
// Daarom per IP begrensd en strak gevalideerd, zodat het geen open logsink wordt.

const KINDS = new Set(['auth', 'rate-limited', 'server', 'network'])

// Routes waar de app zélf een 429 geeft (lib/rateLimit.ts enforce/consume). Een 429 op een
// ander pad kwam niet uit de app: dan was het nginx (zone in ops/vps/nginx-rate-limiting.conf)
// of Supabase. Dat verschil is het eerste wat je bij zo'n melding wilt weten.
const APP_LIMITED = /^\/api\/(chat|recommendations|ml\/retrain|notifications\/check|ingest|beheer\/(mail|sync)|rapport|devices\/)/

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers)
  if (!consume(`clientlog:${ip}`, LIMITS.clientLog).ok) return new NextResponse(null, { status: 429 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const kind = typeof body?.kind === 'string' && KINDS.has(body.kind) ? body.kind : null
  if (!kind) return NextResponse.json({ error: 'bad kind' }, { status: 400 })
  const status = Number.isInteger(body?.status) && body.status >= 100 && body.status <= 599 ? body.status : null
  const path = typeof body?.path === 'string' ? body.path.slice(0, 300) : ''
  const page = typeof body?.page === 'string' ? body.page.slice(0, 200) : ''

  let userId: string | null = null
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
    )
    const { data } = await supabase.auth.getUser()
    userId = data.user?.id ?? null
  } catch { /* geen sessie is hier geen fout */ }

  const origin = status === 429 ? (APP_LIMITED.test(path) ? 'app' : 'proxy-or-upstream') : undefined
  log.warn('client', 'fetch failed in browser', { kind, status, path, page, user_id: userId, ip, ...(origin ? { origin } : {}) })
  return new NextResponse(null, { status: 204 })
}
