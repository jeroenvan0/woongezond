import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'node:child_process'
import { adminOrgs } from '@/lib/cockpit/auth'
import { consume, LIMITS } from '@/lib/rateLimit'
import { createClient } from '@/lib/supabase/server'
import { log, errText } from '@/lib/logger'

// POST /api/beheer/sync — start de nachtelijke backup nu, in plaats van wachten tot 03:00.
//
// De app draait als root op dezelfde VPS als de timer (ops/vps/woongezond-react-dev.service),
// dus systemctl is bereikbaar. Bewust géén parameters: de unitnaam staat hardcoded, er komt
// niets uit het verzoek in de opdracht terecht. --no-block omdat een inhaalslag minuten kan
// duren en het verzoek daar niet op hoeft te wachten; de status lees je terug via
// /api/beheer/status zodra het script klaar is.

export const dynamic = 'force-dynamic'

const UNIT = 'supabase-sync.service'

function systemctl(...args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile('systemctl', args, { timeout: 10_000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: (stdout || stderr || '').trim() })
    })
  })
}

export async function POST(_req: NextRequest) {
  const orgs = await adminOrgs()
  if (orgs === 'unauthenticated') return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (!orgs.length) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const rl = consume(`beheer:sync:${user?.id ?? 'onbekend'}`, LIMITS.beheerSync)
  if (!rl.ok) {
    return NextResponse.json({ error: 'rate_limited', retryAfter: rl.retryAfterSec }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })
  }

  // Al bezig? Dan niet nog een keer starten — een tweede run zou dezelfde watermerken lezen.
  const active = await systemctl('is-active', UNIT)
  if (active.out === 'activating' || active.out === 'active') {
    return NextResponse.json({ ok: true, already_running: true, state: active.out })
  }

  const started = await systemctl('start', '--no-block', UNIT)
  if (!started.ok) {
    log.error('beheer', 'sync starten mislukt', { detail: started.out })
    return NextResponse.json({ error: 'start_failed', detail: started.out.slice(0, 300) }, { status: 500 })
  }
  log.info('beheer', 'backup handmatig gestart', { by: user?.email ?? null })
  return NextResponse.json({ ok: true, already_running: false })
}
