import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { consume, LIMITS, clientIp } from '@/lib/rateLimit'
import { verifyReportToken } from '@/lib/report/token'
import { fetchDeviceRows } from '@/lib/report/sweep'
import { QUESTIONS } from '@/lib/houseProfile'

// GET /api/rapport?t=wgr_…&days=30 — data voor de rapportpagina zonder account.
// Het token (uit de weekmail) is aan één device gebonden; de pagina toont alleen dat device.
// Metingen worden server-side tot 15-minuutgemiddelden teruggebracht (30 dagen ≈ 2.900 punten).
// Geen naam/adres in de response, alleen de voornaam voor de aanhef.

export const dynamic = 'force-dynamic'
const BUCKET_MIN = 15

export async function GET(req: NextRequest) {
  const rl = consume(`rapport:${clientIp(req.headers)}`, LIMITS.deviceStart)
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  const tok = verifyReportToken(req.nextUrl.searchParams.get('t'))
  if (!tok) return NextResponse.json({ error: 'token_invalid' }, { status: 401 })
  const days = Math.max(7, Math.min(90, Number(req.nextUrl.searchParams.get('days') ?? 30) || 30))

  const s = createServiceClient()
  const { data: d } = await s.from('devices').select('id, device_number, location, house_profile, active, last_seen_at, device_contacts(name, report_consent_at)').eq('id', tok.deviceId).maybeSingle()
  if (!d || d.active === false) return NextResponse.json({ error: 'device_unknown' }, { status: 404 })
  const contact: any = Array.isArray((d as any).device_contacts) ? (d as any).device_contacts[0] : (d as any).device_contacts
  const name = (contact?.name ?? '').trim()
  const firstName = name && !/^fam\.?\s/i.test(name) ? name.split(/\s+/)[0] : null

  const end = new Date()
  const start = new Date(end.getTime() - days * 86400000)
  const raw = await fetchDeviceRows(s, d.id, start, end)
  const buckets = new Map<number, { n: number; co2: number; t: number; rh: number }>()
  for (const r of raw) {
    if (r.co2 == null || r.temperature == null || r.humidity == null) continue
    const k = Math.floor(new Date(r.created_at).getTime() / (BUCKET_MIN * 60000))
    const b = buckets.get(k) ?? { n: 0, co2: 0, t: 0, rh: 0 }
    b.n++; b.co2 += +r.co2; b.t += +r.temperature; b.rh += +r.humidity
    buckets.set(k, b)
  }
  const rows = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([k, b]) => ({
    created_at: new Date(k * BUCKET_MIN * 60000).toISOString(), co2: +(b.co2 / b.n).toFixed(0), temperature: +(b.t / b.n).toFixed(2), humidity: +(b.rh / b.n).toFixed(2),
  }))
  const profile = d.house_profile ?? null
  const roomLabel = profile?.room ? QUESTIONS.find((q) => q.key === 'room')?.options.find((o) => o.value === profile.room)?.label ?? profile.room : d.location

  return NextResponse.json({
    device: { number: d.device_number, room: roomLabel, profile, last_seen_at: d.last_seen_at },
    first_name: firstName, report_consent: !!contact?.report_consent_at,
    period: { start: start.toISOString(), end: end.toISOString(), days }, raw_count: raw.length, bucket_minutes: BUCKET_MIN, rows,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
