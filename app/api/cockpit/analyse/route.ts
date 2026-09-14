import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { adminOrgs } from '@/lib/cockpit/auth'
import { QUESTIONS } from '@/lib/houseProfile'
import { analyseVentilation, occupantsFromProfile, type Reading, type OutdoorReading } from '@/lib/ventilationEvents'
import { vAbs } from '@/lib/mouldRisk'
import { log, errText } from '@/lib/logger'

// Analyse-tab van de cockpit, alleen org-ADMINS (docs/huisprofiel-luchtgedrag-plan.md, fase 0).
//
//   GET /api/cockpit/analyse?org=<uuid>&days=1|2|…|7
//
// Levert per sensor van de org: de reeks (5- of 15-minuutgemiddelden, op gelijke tijdstippen
// zodat alle sensoren in één grafiek passen), de gelabelde momenten met betrouwbaarheid
// (lib/ventilationEvents.ts) en de dagsamenvatting. Rekent op ruwe minuutrijen, serverkant.
// Ongevalideerd en daarom niet voor bewoners: alleen deze tab.

export const dynamic = 'force-dynamic'
const MAX_DAYS = 7
const PAGE = 1000
const MAX_PAGES = 12 // 7 dagen × 1440 ≈ 10 080 rijen

const label = (key: string, v: unknown) => (typeof v === 'string' && v ? QUESTIONS.find((q) => q.key === key)?.options.find((o) => o.value === v)?.label ?? v : null)

async function rawReadings(s: ReturnType<typeof createServiceClient>, deviceId: string, sinceIso: string): Promise<Reading[]> {
  const out: Reading[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await s.from('air_quality').select('created_at, co2, temperature, humidity')
      .eq('device_id', deviceId).gte('created_at', sinceIso).order('created_at', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) throw new Error(error.message)
    for (const r of data ?? []) out.push({ ts: new Date(r.created_at).getTime(), co2: r.co2 == null ? null : +r.co2, t: r.temperature == null ? null : +r.temperature, rh: r.humidity == null ? null : +r.humidity })
    if (!data || data.length < PAGE) break
  }
  return out
}

/** Gemiddelden per vast tijdvak, zodat sensoren op dezelfde x-waarden liggen. */
function bucketSeries(readings: Reading[], outdoor: OutdoorReading[], stepMs: number) {
  const map = new Map<number, { co2: number[]; t: number[]; rh: number[]; v: number[] }>()
  for (const r of readings) {
    const key = Math.floor(r.ts / stepMs) * stepMs
    const b = map.get(key) ?? { co2: [], t: [], rh: [], v: [] }
    if (r.co2 != null) b.co2.push(r.co2)
    if (r.t != null) b.t.push(r.t)
    if (r.rh != null) b.rh.push(r.rh)
    if (r.t != null && r.rh != null) b.v.push(vAbs(r.t, r.rh))
    map.set(key, b)
  }
  const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 100) / 100 : null)
  // Vochtoverschot: binnen − buiten. Het buitenweer is een uurwaarde; lineair interpoleren
  // tussen twee uren, anders tekent de grafiek een trap die niets met de kamer te maken heeft.
  const outV = outdoor.filter((o) => o.t != null && o.rh != null).map((o) => ({ ts: o.ts, v: vAbs(o.t!, o.rh!) }))
  const outdoorV = (ts: number): number | null => {
    if (!outV.length) return null
    let lo = 0, hi = outV.length - 1
    while (lo < hi) { const m = (lo + hi) >> 1; if (outV[m].ts < ts) lo = m + 1; else hi = m }
    const b = outV[lo], a = outV[lo - 1]
    if (a && b && a.ts <= ts && ts <= b.ts && b.ts - a.ts <= 3 * 3_600_000) return a.v + ((b.v - a.v) * (ts - a.ts)) / (b.ts - a.ts)
    const near = [a, b].filter(Boolean).sort((x, y) => Math.abs(x!.ts - ts) - Math.abs(y!.ts - ts))[0]
    return near && Math.abs(near.ts - ts) <= 2 * 3_600_000 ? near.v : null
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([t, b]) => {
    const v = avg(b.v)
    const ov = v == null ? null : outdoorV(t)
    return { t, co2: avg(b.co2), temperature: avg(b.t), humidity: avg(b.rh), v, dv: v != null && ov != null ? Math.round((v - ov) * 100) / 100 : null }
  })
}

export async function GET(req: NextRequest) {
  const orgs = await adminOrgs()
  if (orgs === 'unauthenticated') return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (!orgs.length) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const requested = req.nextUrl.searchParams.get('org')
  const org = orgs.find((o) => o.id === requested) ?? orgs[0]
  const days = Math.min(MAX_DAYS, Math.max(1, parseInt(req.nextUrl.searchParams.get('days') ?? '2', 10) || 2))
  const now = Date.now()
  const sinceIso = new Date(now - days * 86_400_000).toISOString()
  const stepMs = (days <= 2 ? 5 : 15) * 60_000

  const s = createServiceClient()
  try {
    const { data: devices, error } = await s.from('devices')
      .select('id, device_number, name, location, house_profile, city_id, active')
      .eq('org_id', org.id).order('device_number', { ascending: true, nullsFirst: false })
    if (error) throw new Error(error.message)

    // Buitenweer per stad (één set per city_id, gedeeld door de sensoren in die stad).
    const cityIds = [...new Set((devices ?? []).map((d: any) => d.city_id).filter(Boolean))] as string[]
    const outdoorByCity = new Map<string, OutdoorReading[]>()
    await Promise.all(cityIds.map(async (cityId) => {
      const { data } = await s.from('city_weather').select('observed_at, temp, humidity').eq('city_id', cityId).gte('observed_at', sinceIso).order('observed_at', { ascending: true }).limit(24 * MAX_DAYS + 24)
      outdoorByCity.set(cityId, (data ?? []).map((w: any) => ({ ts: new Date(w.observed_at).getTime(), t: w.temp == null ? null : +w.temp, rh: w.humidity == null ? null : +w.humidity })))
    }))

    const out = await Promise.all((devices ?? []).map(async (d: any) => {
      const readings = await rawReadings(s, d.id, sinceIso)
      const outdoor = d.city_id ? outdoorByCity.get(d.city_id) ?? [] : []
      const hp = (d.house_profile ?? null) as Record<string, unknown> | null
      // Alle pilotsensoren hangen in een slaapkamer; zonder profiel is dat de aanname.
      const room = typeof hp?.room === 'string' && hp.room ? hp.room : 'slaapkamer'
      const a = analyseVentilation(readings, { outdoor, occupantsNight: occupantsFromProfile(hp?.occupants), room, now })
      return {
        id: d.id, device_number: d.device_number, name: d.name, active: d.active !== false,
        room: label('room', hp?.room) ?? d.location ?? null,
        profile_room: hp?.room ?? null, profile_known: !!hp,
        readings: readings.length,
        co2Floor: Number.isFinite(a.co2Floor) ? Math.round(a.co2Floor) : null,
        assumptions: a.assumptions,
        events: a.events, days: a.days,
        series: bucketSeries(readings, outdoor, stepMs),
      }
    }))

    const outdoor = Object.fromEntries([...outdoorByCity.entries()].map(([id, rows]) => [id, rows.map((r) => ({ t: r.ts, temp: r.t, humidity: r.rh }))]))
    const cityOf = Object.fromEntries((devices ?? []).map((d: any) => [d.id, d.city_id ?? null]))
    return NextResponse.json({ orgs, org, days, bucketMinutes: stepMs / 60_000, since: sinceIso, generated_at: new Date(now).toISOString(), devices: out, outdoor, cityOf }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    log.error('cockpit', 'analyse failed', { org: org.id, detail: errText(e) })
    return NextResponse.json({ error: 'query_failed' }, { status: 500 })
  }
}
