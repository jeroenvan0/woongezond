// Luchtmomenten van één sensor op de echte data (lib/ventilationEvents.ts), in de terminal.
//
//   npm run analyse -- --device "Slaapkamer Jeroen" --days 7
//   npm run analyse -- --device <uuid> --days 3 --events
//
// --device   naam (ilike), sensornummer of uuid
// --days     venster in dagen (standaard 7, max 30)
// --events   alle momenten tonen (standaard: alleen de dagsamenvatting + de laatste 25)
// --json     ruwe uitvoer als JSON (voor verder onderzoek)
// --list     alle sensoren met laatste meting en aantal metingen in het venster
//
// Leest met de service-role uit .env.local; verstuurt niets en schrijft niets.

import { createClient } from '@supabase/supabase-js'
import { analyseVentilation, occupantsFromProfile, EVENT_LABEL, type Reading, type OutdoorReading } from '../lib/ventilationEvents'

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : undefined }
const who = arg('--device') ?? 'Slaapkamer'
const days = Math.min(30, Math.max(1, parseInt(arg('--days') ?? '7', 10) || 7))
const showAll = process.argv.includes('--events')
const asJson = process.argv.includes('--json')

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const UUID_RE = /^[0-9a-f-]{36}$/i
const hhmm = (t: number) => new Date(t).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' })
const dayShort = (t: number) => new Date(t).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Amsterdam' })
const f2 = (x: number) => x.toFixed(2)
const ci = (a: { ach: number; lo: number; hi: number } | null) => (a ? `${f2(a.ach)}/h [${f2(a.lo)}–${f2(a.hi)}]` : '—')

async function main() {
  if (process.argv.includes('--list')) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString()
    const { data: all } = await s.from('devices').select('id, name, device_number, location, active').order('device_number', { ascending: true, nullsFirst: false })
    for (const d of all ?? []) {
      const { count } = await s.from('air_quality').select('id', { count: 'exact', head: true }).eq('device_id', d.id).gte('created_at', since)
      const { data: last } = await s.from('air_quality').select('created_at').eq('device_id', d.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
      console.log(`${String(d.device_number ?? '–').padStart(2)}  ${(d.name ?? '').padEnd(28)} ${(d.location ?? '').padEnd(14)} ${d.active === false ? 'uit ' : 'aan '} ${String(count ?? 0).padStart(6)} metingen/${days}d  laatste ${last?.created_at ?? '—'}  ${d.id}`)
    }
    return
  }
  let q = s.from('devices').select('id, name, device_number, location, house_profile, city_id, user_id')
  if (UUID_RE.test(who)) q = q.eq('id', who)
  else if (/^\d+$/.test(who)) q = q.eq('device_number', parseInt(who, 10))
  else q = q.ilike('name', `%${who}%`)
  const { data: devs, error } = await q.limit(10)
  if (error) throw new Error(error.message)
  if (!devs?.length) { console.error(`Geen sensor gevonden voor "${who}"`); process.exit(1) }
  if (devs.length > 1) console.error(`Meerdere sensoren; eerste gekozen: ${devs.map((d: any) => `${d.device_number ?? '–'} ${d.name}`).join(' | ')}`)
  const d: any = devs[0]

  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const readings: Reading[] = []
  for (let page = 0; page < 60; page++) {
    const { data, error } = await s.from('air_quality').select('created_at, co2, temperature, humidity').eq('device_id', d.id).gte('created_at', since).order('created_at', { ascending: true }).range(page * 1000, page * 1000 + 999)
    if (error) throw new Error(error.message)
    for (const r of data ?? []) readings.push({ ts: new Date(r.created_at).getTime(), co2: r.co2 == null ? null : +r.co2, t: r.temperature == null ? null : +r.temperature, rh: r.humidity == null ? null : +r.humidity })
    if (!data || data.length < 1000) break
  }
  let outdoor: OutdoorReading[] = []
  if (d.city_id) {
    const { data } = await s.from('city_weather').select('observed_at, temp, humidity').eq('city_id', d.city_id).gte('observed_at', since).order('observed_at', { ascending: true }).limit(24 * 31)
    outdoor = (data ?? []).map((w: any) => ({ ts: new Date(w.observed_at).getTime(), t: w.temp == null ? null : +w.temp, rh: w.humidity == null ? null : +w.humidity }))
  }
  const hp = (d.house_profile ?? null) as Record<string, unknown> | null
  const a = analyseVentilation(readings, { outdoor, occupantsNight: occupantsFromProfile(hp?.occupants), room: typeof hp?.room === 'string' ? hp.room : 'slaapkamer' })

  if (asJson) { console.log(JSON.stringify({ device: { id: d.id, name: d.name, device_number: d.device_number }, readings: readings.length, outdoor: outdoor.length, ...a }, null, 1)); return }

  console.log(`\n${d.device_number ?? '–'} ${d.name} · ${readings.length} metingen in ${days} dagen · buitenweer ${outdoor.length} uur · nullijn ${Number.isFinite(a.co2Floor) ? Math.round(a.co2Floor) : '?'} ppm`)
  console.log(`aannames: ${a.assumptions.room} ~${a.assumptions.volumeM3} m³, slapers ${a.assumptions.occupantsNight ?? 'onbekend'}\n`)
  console.log('dag          metingen  gelucht      ACH luchten            achtergrond              nacht CO₂  nacht-ACH               vochtpieken  op buitenniveau')
  for (const x of a.days) {
    console.log(`${x.date}   ${String(x.readings).padStart(5)}    ${String(x.luchtmomenten).padStart(2)}× ${String(x.minutenGelucht).padStart(4)} min  ${ci(x.achLuchten).padEnd(22)} ${ci(x.achtergrond).padEnd(24)} ${x.nachtCo2 == null ? '    —' : String(x.nachtCo2).padStart(5)}      ${ci(x.nachtAch).padEnd(22)} ${String(x.vochtpieken).padEnd(11)}  ${(x.minutenOpBuitenniveau / 60).toFixed(1)} u`)
  }
  const counts = a.events.reduce((m, e) => m.set(e.kind, (m.get(e.kind) ?? 0) + 1), new Map<string, number>())
  console.log(`\n${a.events.length} momenten: ${[...counts.entries()].map(([k, n]) => `${n}× ${k}`).join(', ')}\n`)
  const list = showAll ? a.events : a.events.slice(-25)
  for (const e of list) {
    const achTxt = e.ach != null && e.achCI ? ci({ ach: e.ach, ...e.achCI }) : e.vRise != null ? `+${e.vRise.toFixed(1)} g/m³` : ''
    console.log(`${dayShort(e.start)} ${hhmm(e.start)}–${hhmm(e.end)}  ${EVENT_LABEL[e.kind].padEnd(24)} ${String(e.minutes).padStart(4)} min  ${String(e.co2Start).padStart(4)}→${String(e.co2End).padEnd(4)}  ${achTxt.padEnd(22)} ${Math.round(e.confidence * 100)}%  ${e.evidence.join(' · ')}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
