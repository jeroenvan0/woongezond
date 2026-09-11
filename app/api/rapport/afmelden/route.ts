import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { consume, LIMITS, clientIp } from '@/lib/rateLimit'
import { verifyReportToken } from '@/lib/report/token'
import { log } from '@/lib/logger'

// POST /api/rapport/afmelden { t } — "geen rapport meer ontvangen" uit de weekmail.
// Zet report_consent_at op NULL; naam en e-mail blijven staan zodat de bewoner zich via de
// QR-pagina weer kan aanmelden. Zelfde token als de rapportpagina.

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const rl = consume(`afmelden:${clientIp(req.headers)}`, LIMITS.deviceStart)
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  const body = await req.json().catch(() => null)
  const tok = verifyReportToken(body?.t)
  if (!tok) return NextResponse.json({ error: 'token_invalid' }, { status: 401 })
  const s = createServiceClient()
  const { error } = await s.from('device_contacts').update({ report_consent_at: null, updated_at: new Date().toISOString() }).eq('device_id', tok.deviceId)
  if (error) return NextResponse.json({ error: 'error' }, { status: 500 })
  log.info('report', 'resident unsubscribed from weekly report', { device_id: tok.deviceId })
  return NextResponse.json({ ok: true })
}
