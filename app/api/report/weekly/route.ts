import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient, cronSecretOk } from '@/lib/supabase/service'
import { weeklyReportSweep } from '@/lib/report/sweep'
import { log, errText } from '@/lib/logger'

// Weekrapport per sensor — de timer-ingang (docs/rapport-weekmail-plan.md).
//   POST /api/report/weekly + x-cron-secret            alle contacten met toestemming, laatste volle week
//   ?dry=1                                             alleen tonen wat er zou gaan (geen mail, geen log)
//   ?device=<uuid>&force=1                             één sensor, ook als deze week al verstuurd is
//   ?rolling=1                                         afgelopen 7 dagen i.p.v. ma–zo
// Geen browser-ingang: bewoners krijgen hun rapport per mail, admins via /api/cockpit.

export const dynamic = 'force-dynamic'
const UUID_RE = /^[0-9a-f-]{36}$/i

export async function POST(req: NextRequest) {
  if (!cronSecretOk(req.headers.get('x-cron-secret'))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const p = req.nextUrl.searchParams
  const device = p.get('device')
  if (device && !UUID_RE.test(device)) return NextResponse.json({ error: 'bad_device' }, { status: 400 })
  try {
    const r = await weeklyReportSweep(createServiceClient(), {
      dry: p.get('dry') === '1', force: p.get('force') === '1', rolling: p.get('rolling') === '1',
      deviceId: device ?? undefined, trigger: device ? 'manual' : 'timer',
    })
    log.info('report', 'weekly sweep complete', { dry: p.get('dry') === '1', contacts: r.contacts, sent: r.sent, skipped: r.skipped, period: r.period.key })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    log.error('report', 'weekly sweep failed', { detail: errText(e) })
    return NextResponse.json({ ok: false, error: 'sweep failed' }, { status: 500 })
  }
}
