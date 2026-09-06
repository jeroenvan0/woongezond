import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient, cronSecretOk } from '@/lib/supabase/service'
import { sendEmail } from '@/lib/email'
import { log } from '@/lib/logger'

// Stand 'delayed': verstuur alle voorstellen waarvan het verzendmoment is verstreken.
//   POST /api/inbox/flush + x-cron-secret   (timer, elke 5 min; ?dry=1 toont alleen)
// Alleen status 'scheduled' met send_at <= nu; escalaties hebben nooit die status.

export const dynamic = 'force-dynamic'
const FROM = () => process.env.SUPPORT_FROM_ADDR || process.env.ALERT_FROM_ADDR || 'Woongezond <help@woongezond.com>'
const ADMIN = () => process.env.SUPPORT_ADMIN_ADDR || ''

export async function POST(req: NextRequest) {
  if (!cronSecretOk(req.headers.get('x-cron-secret'))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const dry = req.nextUrl.searchParams.get('dry') === '1'
  const s = createServiceClient()
  const { data: due, error } = await s.from('support_messages').select('id, from_addr, subject, message_id, reply, send_at').eq('status', 'scheduled').lte('send_at', new Date().toISOString()).order('send_at').limit(50)
  if (error) return NextResponse.json({ ok: false, error: 'query_failed' }, { status: 500 })
  let sent = 0, failed = 0
  for (const m of due ?? []) {
    if (dry || !m.reply) continue
    const ok = await sendEmail({
      from: FROM(), to: m.from_addr, subject: /^re:/i.test(m.subject ?? '') ? m.subject : `Re: ${m.subject ?? 'je vraag'}`, text: m.reply,
      bcc: ADMIN() || undefined, headers: m.message_id ? { 'In-Reply-To': m.message_id, References: m.message_id } : undefined,
    })
    await s.from('support_messages').update({ status: ok ? 'answered' : 'send_failed', handled_at: new Date().toISOString() }).eq('id', m.id)
    if (ok) sent++; else failed++
    log.info('support', 'scheduled reply ' + (ok ? 'sent' : 'FAILED'), { row: m.id })
  }
  return NextResponse.json({ ok: true, dry, due: (due ?? []).length, sent, failed, ids: (due ?? []).map((m) => m.id) })
}
