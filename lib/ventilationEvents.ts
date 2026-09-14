// Luchtmomenten en achtergrondwisseling uit één binnensensor (docs/huisprofiel-luchtgedrag-plan.md §3).
//
// Pure functies, geen I/O. Invoer: ruwe minuutrijen van één sensor (CO₂, T, RV), optioneel het
// uurlijkse buitenweer en het huisprofiel. Uitvoer: gelabelde momenten mét betrouwbaarheid, en
// een samenvatting per dag.
//
// Wat de sensor ziet is een sprong in de luchtwisseling van zíjn kamer, geen raam. Een raam,
// een deur naar de gang en een bewoner die de kamer verlaat geven alle drie een CO₂-daling.
// Het onderscheid zit in de snelheid (een raam: ACH ≳ 2/h; de achtergrond van een kamer:
// 0,2–1/h) en, in het stookseizoen, in een temperatuurdip. Daarom krijgt elk moment:
//   - een 95%-betrouwbaarheidsinterval op de luchtwisseling (uit de standaardfout van de
//     log-lineaire fit ln(C − C_buiten) = a − t/τ; ACH = 60/τ = −60·helling, dus het interval
//     op de helling is direct een interval op ACH), en
//   - een zekerheid 0–1 voor het label zelf, opgebouwd uit bewijs (grootte van de daling,
//     kwaliteit van de fit, temperatuurdip als het buiten koud is, daling van het
//     vochtoverschot, nacht met bekende slapers). De onderdelen staan in `evidence`.
//
// Alle pilotsensoren hangen in een slaapkamer. Zonder profiel gaan de aannames daarvan uit
// (kamer ~30 m³, slapers uit de vragenlijst); zie ROOM_VOLUME_M3.
//
// Ongevalideerd: de drempels zijn uit de literatuur en uit de eerste pilotdata, niet geijkt
// tegen raamcontacten. Dat is fase 1 van het plan.

import { vAbs } from './mouldRisk'

export interface Reading { ts: number; co2: number | null; t: number | null; rh: number | null }
export interface OutdoorReading { ts: number; t: number | null; rh: number | null }
export type EventKind = 'luchten' | 'achtergrond' | 'vochtpiek' | 'bezetting'
export interface Interval { lo: number; hi: number }

export interface VentEvent {
  kind: EventKind
  start: number
  end: number
  minutes: number
  co2Start: number
  co2End: number
  /** Positief = daling (luchten, achtergrond); negatief = stijging (bezetting). */
  co2Drop: number
  tauMin: number | null
  ach: number | null
  achCI: Interval | null
  r2: number | null
  /** °C, positief = afgekoeld tijdens het moment. */
  tempDrop: number | null
  /** g/m³, daling van het binnen–buiten-vochtverschil (alleen met buitenweer). */
  dvDrop: number | null
  /** g/m³, stijging van de absolute vochtigheid binnen (vochtpiek). */
  vRise: number | null
  outdoorT: number | null
  confidence: number
  evidence: string[]
}

export interface DaySummary {
  date: string
  readings: number
  luchtmomenten: number
  minutenGelucht: number
  /** Mediane ACH tijdens luchten, met het bereik van de intervallen. */
  achLuchten: { ach: number; lo: number; hi: number; n: number } | null
  /** Achtergrondwisseling bij gesloten raam uit trage decays. */
  achtergrond: { ach: number; lo: number; hi: number; n: number } | null
  vochtpieken: number
  /** Minuten waarin de CO₂ binnen 60 ppm van de nullijn zat: kamer op buitenniveau (raam open, of leeg). */
  minutenOpBuitenniveau: number
  /** Mediane CO₂ 01:00–05:00 lokale tijd. */
  nachtCo2: number | null
  /** Wisseling uit het nachtplateau (≥ 150 ppm boven de nullijn) met bekend aantal slapers; ±50 % door G en V. */
  nachtAch: { ach: number; lo: number; hi: number } | null
}

export interface VentilationOptions {
  outdoor?: OutdoorReading[]
  /** Slapers in de kamer (vragenlijst `occupants`); null = onbekend. */
  occupantsNight?: number | null
  room?: string | null
  roomVolumeM3?: number
  now?: number
}

export interface VentilationAnalysis {
  events: VentEvent[]
  days: DaySummary[]
  /** Nullijn: 2-percentiel van de CO₂ in het venster — de buitenwaarde zoals deze sensor die ziet. */
  co2Floor: number
  assumptions: { room: string; volumeM3: number; occupantsNight: number | null }
}

// Kamervolumes bij benadering; de pilot hangt overal in slaapkamers.
export const ROOM_VOLUME_M3: Record<string, number> = {
  slaapkamer: 30, kinderkamer: 25, woonkamer: 80, keuken: 40, badkamer: 15, anders: 40,
}
// CO₂-productie van een slapende volwassene ≈ 0,0028 L/s ≈ 10 L/h (Persily & De Jonge 2017).
const CO2_L_PER_H_SLEEPING = 10
const BUCKET_MS = 5 * 60_000
const GAP_MS = 15 * 60_000
const TZ = 'Europe/Amsterdam'

// ── Statistiek ────────────────────────────────────────────────────────────────

const median = (a: number[]) => {
  if (!a.length) return NaN
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const percentile = (a: number[], p: number) => {
  if (!a.length) return NaN
  const s = [...a].sort((x, y) => x - y)
  const i = Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))
  return s[i]
}

// t(0,975; df) voor het 95%-interval op de helling; interpolatie tussen tabelwaarden.
const T_TABLE: [number, number][] = [[1, 12.71], [2, 4.30], [3, 3.18], [4, 2.78], [5, 2.57], [6, 2.45], [8, 2.31], [10, 2.23], [15, 2.13], [20, 2.09], [30, 2.04], [60, 2.00], [120, 1.98]]
export function tQuantile975(df: number): number {
  if (df <= 1) return T_TABLE[0][1]
  for (let i = 1; i < T_TABLE.length; i++) {
    const [d1, t1] = T_TABLE[i - 1], [d2, t2] = T_TABLE[i]
    if (df <= d2) return t1 + (t2 - t1) * ((df - d1) / (d2 - d1))
  }
  return 1.96 // df > 120
}

export interface Fit { slope: number; intercept: number; se: number; r2: number; n: number }
/** Kleinste kwadraten met standaardfout van de helling. */
export function linearFit(x: number[], y: number[]): Fit | null {
  const n = x.length
  if (n < 3 || n !== y.length) return null
  let mx = 0, my = 0
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i] }
  mx /= n; my /= n
  let sxx = 0, sxy = 0, syy = 0
  for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); syy += (y[i] - my) ** 2 }
  if (sxx === 0) return null
  const slope = sxy / sxx
  const intercept = my - slope * mx
  let sse = 0
  for (let i = 0; i < n; i++) sse += (y[i] - (intercept + slope * x[i])) ** 2
  const se = n > 2 ? Math.sqrt(sse / (n - 2) / sxx) : Infinity
  const r2 = syy > 0 ? 1 - sse / syy : 1
  return { slope, intercept, se, r2, n }
}

// ── Tijd ──────────────────────────────────────────────────────────────────────

function localParts(ts: number): { date: string; hour: number } {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(new Date(ts))
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00'
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hour: Number(g('hour')) % 24 }
}

// ── Voorbewerking ─────────────────────────────────────────────────────────────

interface Bucket { ts: number; co2: number; t: number | null; rh: number | null; v: number | null; n: number }

/** 5-minuutgemiddelden, gesorteerd; alleen buckets met CO₂. */
export function bucketReadings(readings: Reading[], bucketMs = BUCKET_MS): Bucket[] {
  const map = new Map<number, { co2: number[]; t: number[]; rh: number[] }>()
  for (const r of readings) {
    if (r.co2 == null || !Number.isFinite(r.co2)) continue
    const key = Math.floor(r.ts / bucketMs) * bucketMs
    const b = map.get(key) ?? { co2: [], t: [], rh: [] }
    b.co2.push(r.co2)
    if (r.t != null && Number.isFinite(r.t)) b.t.push(r.t)
    if (r.rh != null && Number.isFinite(r.rh)) b.rh.push(r.rh)
    map.set(key, b)
  }
  const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null)
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([ts, b]) => {
    const t = avg(b.t), rh = avg(b.rh)
    return { ts: ts + bucketMs / 2, co2: avg(b.co2)!, t, rh, v: t != null && rh != null ? vAbs(t, rh) : null, n: b.co2.length }
  })
}

function segments(buckets: Bucket[], gapMs = GAP_MS): Bucket[][] {
  const out: Bucket[][] = []
  let cur: Bucket[] = []
  for (const b of buckets) {
    if (cur.length && b.ts - cur[cur.length - 1].ts > gapMs) { out.push(cur); cur = [] }
    cur.push(b)
  }
  if (cur.length) out.push(cur)
  return out
}

function outdoorAt(outdoor: OutdoorReading[] | undefined, ts: number): { t: number | null; v: number | null } {
  if (!outdoor?.length) return { t: null, v: null }
  // Lineair tussen de twee omliggende uurwaarden (lijst is gesorteerd); anders de
  // dichtstbijzijnde binnen 2 uur.
  let lo = 0, hi = outdoor.length - 1
  while (lo < hi) { const mid = (lo + hi) >> 1; if (outdoor[mid].ts < ts) lo = mid + 1; else hi = mid }
  const b = outdoor[lo], a = outdoor[lo - 1]
  const val = (o: OutdoorReading) => ({ t: o.t, v: o.t != null && o.rh != null ? vAbs(o.t, o.rh) : null })
  if (a && b && a.ts <= ts && ts <= b.ts && b.ts - a.ts <= 3 * 3_600_000 && a.t != null && b.t != null) {
    const w = (ts - a.ts) / (b.ts - a.ts)
    const va = val(a), vb = val(b)
    return { t: a.t + (b.t - a.t) * w, v: va.v != null && vb.v != null ? va.v + (vb.v - va.v) * w : null }
  }
  const best = [a, b].filter(Boolean).sort((x, y) => Math.abs(x!.ts - ts) - Math.abs(y!.ts - ts))[0]
  if (!best || Math.abs(best.ts - ts) > 2 * 3_600_000 || best.t == null) return { t: null, v: null }
  return val(best)
}

// ── Detectie ──────────────────────────────────────────────────────────────────

function clamp01(x: number) { return Math.max(0.05, Math.min(0.98, x)) }

/**
 * Log-lineaire fit van een dalende reeks. Het ACH-interval komt uit de standaardfout van de
 * helling én uit de onzekerheid van de nullijn (±30 ppm: sensoroffset, ASC-drift, buitenwaarde):
 * de fit wordt bij drie nullijnen gedaan en het interval is de omhullende. Zo is een strakke
 * daling naar een verkeerde nullijn niet ten onrechte "zeker".
 */
function fitDecay(seg: Bucket[], floor: number, raw?: RawIndex): { tau: number; ach: number; ci: Interval; r2: number; used: number; points: number } | null {
  // Fit op de ruwe minuutrijen in het venster (15 min = 15 punten in plaats van 3 buckets);
  // pas zonder ruwe rijen op de buckets zelf. Dat scheelt een factor 5 in vrijheidsgraden.
  const pts: { ts: number; co2: number }[] = raw ? raw.between(seg[0].ts - BUCKET_MS / 2, seg[seg.length - 1].ts + BUCKET_MS / 2) : []
  const source: { ts: number; co2: number }[] = pts.length >= 6 ? pts : seg
  const one = (fl: number) => {
    const x: number[] = [], y: number[] = []
    const t0 = source[0].ts
    let used = 0
    for (const b of source) {
      const above = b.co2 - fl
      if (above <= 5) break
      used++
      x.push((b.ts - t0) / 60_000)
      y.push(Math.log(above))
    }
    const f = linearFit(x, y)
    if (!f || f.slope >= 0) return null
    const t = tQuantile975(f.n - 2)
    const ach = -60 * f.slope
    const lo = Math.max(0, -60 * (f.slope + t * f.se))
    const hi = -60 * (f.slope - t * f.se)
    return { tau: -1 / f.slope, ach, lo, hi: Number.isFinite(hi) ? hi : ach * 4, r2: f.r2, used, n: f.n }
  }
  const mid = one(floor)
  if (!mid) return null
  const alts = [one(Math.max(350, floor - 30)), one(floor + 30)].filter(Boolean) as NonNullable<ReturnType<typeof one>>[]
  const lo = Math.min(mid.lo, ...alts.map((a) => a.lo))
  const hi = Math.max(mid.hi, ...alts.map((a) => a.hi))
  // `used` telt buckets (voor start/einde van het moment), ook als de fit op ruwe rijen liep.
  const lastTs = source[Math.max(0, mid.used - 1)].ts
  let usedBuckets = 0
  for (const b of seg) { if (b.ts - BUCKET_MS / 2 <= lastTs) usedBuckets++ }
  return { tau: mid.tau, ach: mid.ach, ci: { lo, hi }, r2: mid.r2, used: Math.max(3, usedBuckets), points: mid.n }
}

/** Ruwe rijen met CO₂, gesorteerd, met een snelle vensterselectie. */
class RawIndex {
  private ts: number[]
  private rows: { ts: number; co2: number }[]
  constructor(readings: Reading[]) {
    this.rows = readings.filter((r) => r.co2 != null && Number.isFinite(r.co2)).map((r) => ({ ts: r.ts, co2: r.co2! })).sort((a, b) => a.ts - b.ts)
    this.ts = this.rows.map((r) => r.ts)
  }
  between(a: number, b: number): { ts: number; co2: number }[] {
    let lo = 0, hi = this.ts.length
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.ts[m] < a) lo = m + 1; else hi = m }
    const out: { ts: number; co2: number }[] = []
    for (let i = lo; i < this.rows.length && this.ts[i] <= b; i++) out.push(this.rows[i])
    return out
  }
}

/**
 * Aaneengesloten stukken waarin CO₂ daalt (sign = −1) of stijgt (sign = +1): beginnen bij een
 * echte stap (≥ minStep ppm per 5 min), lopen door zolang er geen tegenstap > tol is, en
 * verliezen aan het eind de vlakke staart. Zo begint een run niet al op een plateau.
 */
function monotoneRuns(seg: Bucket[], sign: 1 | -1, tol = 15, minStep = 12): [number, number][] {
  const step = (j: number) => sign * (seg[j + 1].co2 - seg[j].co2)
  const over2 = (j: number) => sign * (seg[Math.min(seg.length - 1, j + 2)].co2 - seg[j].co2)
  const out: [number, number][] = []
  let i = 0
  while (i < seg.length - 1) {
    if (step(i) < minStep) { i++; continue }
    let k = i
    while (k + 1 < seg.length && step(k) >= -tol) k++
    // Begin pas waar het echt gaat lopen (ruis op een plateau geeft ook losse stappen ≥ minStep),
    // en laat de vlakke staart vallen.
    while (i + 2 <= k && over2(i) < 2 * minStep) i++
    while (k > i + 2 && sign * (seg[k].co2 - seg[k - 2].co2) < 6) k--
    if (k > i) out.push([i, k])
    i = k + 1
  }
  return out
}

/**
 * Alle momenten in de reeks. Luchten: steile daling (ACH ≥ 1,5) na afkapping op het steile
 * deel; achtergrond: trage, lange daling (bron weg, raam dicht); vochtpiek: absolute
 * vochtigheid stijgt zonder CO₂-verandering; bezetting: CO₂ stijgt gestaag (mensen erbij).
 */
export function detectEvents(readings: Reading[], opts: VentilationOptions = {}): { events: VentEvent[]; co2Floor: number } {
  const buckets = bucketReadings(readings)
  const events: VentEvent[] = []
  if (buckets.length < 6) return { events, co2Floor: NaN }
  const raw = new RawIndex(readings)
  // Nullijn: het 2-percentiel, begrensd op 380–460 ppm. Een kamer die nooit gelucht wordt
  // haalt de buitenwaarde niet; dan is ~450 een betere nullijn dan het eigen minimum.
  const co2Floor = Math.min(460, Math.max(380, percentile(buckets.map((b) => b.co2), 0.02)))
  const night = (ts: number) => { const h = localParts(ts).hour; return h >= 0 && h < 6 }

  // Trage daling ≥ 45 min met ACH < 1,5: achtergrondwisseling bij gesloten raam (bron weg).
  const slowEvent = (run: Bucket[]) => {
    if (run.length < 3) return
    const fitSlow = fitDecay(run, co2Floor, raw)
    if (!fitSlow || fitSlow.ach >= 1.5) return
    const first = run[0], last = run[Math.max(2, fitSlow.used - 1)]
    const minutes = (last.ts - first.ts) / 60_000 + 5
    if (minutes < 45) return
    const out = outdoorAt(opts.outdoor, first.ts)
    const tempDrop = first.t != null && last.t != null ? first.t - last.t : null
    const usedDrop = first.co2 - last.co2
    if (usedDrop < 120) return
    const ev: string[] = [`CO₂ −${Math.round(usedDrop)} ppm in ${Math.round(minutes)} min`]
    let c = 0.4
    if (fitSlow.r2 >= 0.85) { c += 0.2; ev.push('strakke exponentiële daling') } else if (fitSlow.r2 >= 0.7) { c += 0.1; ev.push('redelijk exponentiële daling') } else { c -= 0.1; ev.push('grillige daling') }
    if (minutes >= 90) { c += 0.15; ev.push('lang genoeg voor een stabiele schatting') }
    if (tempDrop != null && tempDrop >= 0.7) { c -= 0.15; ev.push(`temperatuur −${tempDrop.toFixed(1)} °C: mogelijk toch een kier`) }
    if (fitSlow.ci.hi - fitSlow.ci.lo > fitSlow.ach) { c -= 0.1; ev.push('breed interval') }
    events.push({
      kind: 'achtergrond', start: first.ts, end: last.ts, minutes: Math.round(minutes),
      co2Start: Math.round(first.co2), co2End: Math.round(last.co2), co2Drop: Math.round(usedDrop),
      tauMin: fitSlow.tau, ach: fitSlow.ach, achCI: fitSlow.ci, r2: fitSlow.r2,
      tempDrop, dvDrop: null, vRise: null, outdoorT: out.t, confidence: clamp01(c), evidence: ev,
    })
  }

  for (const seg of segments(buckets)) {
    // ── Dalingen: luchten of achtergrond ───────────────────────────────────
    for (const [i, k] of monotoneRuns(seg, -1)) {
      const run = seg.slice(i, k + 1)
      const drop = run[0].co2 - run[run.length - 1].co2
      if (run.length < 3 || drop < 120) continue

      // Steile deel: begint bij de eerste stap ≥ 40 % van de grootste stap (een bron die
      // wegvalt vóór het raam opengaat geeft eerst een trage aanloop) en eindigt zodra de
      // daling per bucket onder 25 % van de grootste stap zakt.
      let maxStep = 0
      for (let j = 1; j < run.length; j++) maxStep = Math.max(maxStep, run[j - 1].co2 - run[j].co2)
      let steepStart = 0
      while (steepStart < run.length - 1 && run[steepStart].co2 - run[steepStart + 1].co2 < 0.4 * maxStep) steepStart++
      let cut = run.length
      for (let j = steepStart + 3; j < run.length; j++) {
        if (run[j - 1].co2 - run[j].co2 < 0.25 * maxStep) { cut = j; break }
      }
      const steep = run.slice(steepStart, cut)
      const steepDrop = steep.length >= 3 ? steep[0].co2 - steep[steep.length - 1].co2 : 0
      const fitSteep = steepDrop >= 120 ? fitDecay(steep, co2Floor, raw) : null

      if (fitSteep && fitSteep.ach >= 1.5) {
        const first = steep[0], last = steep[steep.length - 1]
        const out = outdoorAt(opts.outdoor, first.ts)
        const tMin = Math.min(...steep.map((b) => (b.t == null ? Infinity : b.t)))
        const tempDrop = first.t != null && Number.isFinite(tMin) ? first.t - tMin : null
        const dvDrop = first.v != null && last.v != null && out.v != null ? (first.v - out.v) - (last.v - out.v) : null
        const ev: string[] = []
        let c = 0.35
        if (steepDrop >= 300) { c += 0.15; ev.push(`CO₂ −${Math.round(steepDrop)} ppm`) } else { c += 0.08; ev.push(`CO₂ −${Math.round(steepDrop)} ppm (kleine daling)`) }
        if (fitSteep.r2 >= 0.9) { c += 0.15; ev.push('strakke exponentiële daling') } else if (fitSteep.r2 >= 0.75) { c += 0.08; ev.push('redelijk exponentiële daling') } else { ev.push('grillige daling') }
        if (fitSteep.ci.lo >= 1.0) { c += 0.15; ev.push(`interval sluit achtergrondwisseling uit (${fitSteep.points} punten)`) } else ev.push(`interval overlapt achtergrondwisseling (${fitSteep.points} punten)`)
        const cold = out.t != null && out.t < 12
        if (tempDrop != null) {
          if (cold) {
            if (tempDrop >= 0.5) { c += 0.2; ev.push(`temperatuur −${tempDrop.toFixed(1)} °C bij koud buitenweer`) }
            else if (tempDrop < 0.1) { c -= 0.15; ev.push('geen temperatuurdip ondanks koud buitenweer') }
            else ev.push(`temperatuur −${tempDrop.toFixed(1)} °C`)
          } else if (tempDrop >= 0.5) { c += 0.1; ev.push(`temperatuur −${tempDrop.toFixed(1)} °C`) }
          else if (out.t == null) ev.push('buitenweer onbekend: temperatuurdip niet te wegen')
          else ev.push('warm buiten: geen temperatuurdip te verwachten')
        }
        if (dvDrop != null) {
          if (dvDrop >= 0.5) { c += 0.1; ev.push(`vochtoverschot −${dvDrop.toFixed(1)} g/m³`) }
          else if (dvDrop < -0.3) { c -= 0.05; ev.push('vochtoverschot steeg juist') }
          else ev.push('vochtoverschot vrijwel gelijk')
        }
        if (night(first.ts) && (opts.occupantsNight ?? 0) >= 1) { c += 0.1; ev.push("'s nachts met slapers: niemand verliet de kamer") }
        // Raam of deur? Niet hard te scheiden met één sensor. Zwakke aanwijzing: een raam
        // trekt de CO₂ naar het buitenniveau, een deur naar de gang naar het huisniveau.
        const tail = run[Math.min(run.length - 1, cut + 2)]
        if (tail.co2 - co2Floor <= 80) ev.push('zakt tot buitenniveau: eerder raam dan deur')
        else if (tail.co2 - co2Floor >= 200 && cut < run.length) ev.push(`vlakt af rond ${Math.round(tail.co2)} ppm: mogelijk deur naar de rest van het huis`)
        events.push({
          kind: 'luchten', start: first.ts, end: last.ts, minutes: Math.round((last.ts - first.ts) / 60_000) + 5,
          co2Start: Math.round(first.co2), co2End: Math.round(last.co2), co2Drop: Math.round(steepDrop),
          tauMin: fitSteep.tau, ach: fitSteep.ach, achCI: fitSteep.ci, r2: fitSteep.r2,
          tempDrop, dvDrop, vRise: null, outdoorT: out.t, confidence: clamp01(c), evidence: ev,
        })
        // De trage aanloop vóór het raam (bron weg) telt als achtergrond als hij lang genoeg is;
        // de trage staart erna blijft ongelabeld: het omslagpunt is te onzeker.
        if (steepStart >= 3) slowEvent(run.slice(0, steepStart + 1))
        continue
      }
      slowEvent(run)
    }

    // ── Stijgingen: bezetting ─────────────────────────────────────────────
    for (const [i, k] of monotoneRuns(seg, 1)) {
      const run = seg.slice(i, k + 1)
      const rise = run[run.length - 1].co2 - run[0].co2
      const minutes = (run[run.length - 1].ts - run[0].ts) / 60_000 + 5
      if (run.length < 4 || rise < 200 || minutes > 180) continue
      const f = linearFit(run.map((b) => (b.ts - run[0].ts) / 60_000), run.map((b) => b.co2))
      const ev: string[] = [`CO₂ +${Math.round(rise)} ppm in ${Math.round(minutes)} min`]
      let c = 0.4
      if (f && f.r2 >= 0.9) { c += 0.2; ev.push('gestage stijging (constante bron)') } else if (f && f.r2 >= 0.75) { c += 0.1 }
      if (rise >= 400) c += 0.1
      const h = localParts(run[0].ts).hour
      if (h >= 21 || h < 1) { c += 0.1; ev.push('rond bedtijd') }
      events.push({
        kind: 'bezetting', start: run[0].ts, end: run[run.length - 1].ts, minutes: Math.round(minutes),
        co2Start: Math.round(run[0].co2), co2End: Math.round(run[run.length - 1].co2), co2Drop: -Math.round(rise),
        tauMin: null, ach: null, achCI: null, r2: f?.r2 ?? null, tempDrop: null, dvDrop: null, vRise: null,
        outdoorT: outdoorAt(opts.outdoor, run[0].ts).t, confidence: clamp01(c), evidence: ev,
      })
    }

    // ── Vochtpieken: absolute vochtigheid stijgt, CO₂ niet ────────────────
    for (let j = 0; j + 4 < seg.length; j++) {
      const a = seg[j], b = seg[j + 4] // 20 min
      if (a.v == null || b.v == null) continue
      const vRise = b.v - a.v
      const co2Change = Math.abs(b.co2 - a.co2)
      if (vRise >= 1.0 && co2Change < 100) {
        // Neem het hele stijgende stuk mee.
        let k = j + 4
        while (k + 1 < seg.length && seg[k + 1].v != null && seg[k + 1].v! >= seg[k].v! - 0.1) k++
        const last = seg[k]
        const totalRise = (last.v ?? b.v) - a.v
        const ev: string[] = [`vocht +${totalRise.toFixed(1)} g/m³`, `CO₂ ±${Math.round(co2Change)} ppm (geen extra bezetting)`]
        let c = 0.4 + (totalRise >= 2 ? 0.25 : totalRise >= 1.5 ? 0.15 : 0.05)
        if (a.t != null && last.t != null && last.t - a.t >= 0.5) { c += 0.1; ev.push('warmer: douche of koken') }
        // Zomer: vochtige buitenlucht naar binnen laten verhoogt de absolute vochtigheid óók.
        const outA = outdoorAt(opts.outdoor, a.ts)
        if (outA.v != null && a.v != null && outA.v >= a.v - 0.3) { c -= 0.15; ev.push('buitenlucht is vochtiger: kan ook luchten zijn') }
        events.push({
          kind: 'vochtpiek', start: a.ts, end: last.ts, minutes: Math.round((last.ts - a.ts) / 60_000) + 5,
          co2Start: Math.round(a.co2), co2End: Math.round(last.co2), co2Drop: Math.round(a.co2 - last.co2),
          tauMin: null, ach: null, achCI: null, r2: null, tempDrop: a.t != null && last.t != null ? a.t - last.t : null,
          dvDrop: null, vRise: totalRise, outdoorT: outdoorAt(opts.outdoor, a.ts).t, confidence: clamp01(c), evidence: ev,
        })
        j = k
      }
    }
  }

  events.sort((a, b) => a.start - b.start)
  return { events, co2Floor }
}

// ── Samenvatting per dag ──────────────────────────────────────────────────────

function pooled(evs: VentEvent[]): { ach: number; lo: number; hi: number; n: number } | null {
  const withAch = evs.filter((e) => e.ach != null && e.achCI)
  if (!withAch.length) return null
  return {
    ach: median(withAch.map((e) => e.ach!)),
    lo: percentile(withAch.map((e) => e.achCI!.lo), 0.25),
    hi: percentile(withAch.map((e) => e.achCI!.hi), 0.75),
    n: withAch.length,
  }
}

export function summarizeDays(readings: Reading[], events: VentEvent[], co2Floor: number, opts: VentilationOptions = {}): DaySummary[] {
  const room = opts.room && ROOM_VOLUME_M3[opts.room] ? opts.room : 'slaapkamer'
  const volume = opts.roomVolumeM3 ?? ROOM_VOLUME_M3[room]
  const occ = opts.occupantsNight ?? null
  const byDate = new Map<string, { readings: number; night: number[]; nearOutdoor: number }>()
  for (const r of readings) {
    const { date, hour } = localParts(r.ts)
    const d = byDate.get(date) ?? { readings: 0, night: [], nearOutdoor: 0 }
    d.readings++
    if (r.co2 != null && hour >= 1 && hour < 5) d.night.push(r.co2)
    if (r.co2 != null && Number.isFinite(co2Floor) && r.co2 <= co2Floor + 60) d.nearOutdoor++
    byDate.set(date, d)
  }
  const evByDate = new Map<string, VentEvent[]>()
  for (const e of events) {
    const { date } = localParts(e.start)
    evByDate.set(date, [...(evByDate.get(date) ?? []), e])
  }
  return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, d]) => {
    const evs = evByDate.get(date) ?? []
    const lucht = evs.filter((e) => e.kind === 'luchten')
    const nachtCo2 = d.night.length >= 12 ? Math.round(median(d.night)) : null
    let nachtAch: DaySummary['nachtAch'] = null
    if (nachtCo2 != null && occ != null && occ >= 1 && Number.isFinite(co2Floor) && nachtCo2 - co2Floor >= 150) {
      // C_ss − C_buiten = G/(n·V)  →  n = G / (V · ΔC)   met G in m³/h en ΔC als volumefractie.
      const g = (occ * CO2_L_PER_H_SLEEPING) / 1000
      const ach = g / (volume * (nachtCo2 - co2Floor) * 1e-6)
      nachtAch = { ach, lo: ach * 0.6, hi: ach * 1.6 }
    }
    return {
      date, readings: d.readings,
      luchtmomenten: lucht.length,
      minutenGelucht: lucht.reduce((s, e) => s + e.minutes, 0),
      achLuchten: pooled(lucht),
      achtergrond: pooled(evs.filter((e) => e.kind === 'achtergrond')),
      vochtpieken: evs.filter((e) => e.kind === 'vochtpiek').length,
      minutenOpBuitenniveau: d.nearOutdoor, // één meting per minuut in de pilot
      nachtCo2, nachtAch,
    }
  })
}

export function analyseVentilation(readings: Reading[], opts: VentilationOptions = {}): VentilationAnalysis {
  const sorted = [...readings].sort((a, b) => a.ts - b.ts)
  const outdoor = opts.outdoor ? [...opts.outdoor].sort((a, b) => a.ts - b.ts) : undefined
  const o = { ...opts, outdoor }
  const { events, co2Floor } = detectEvents(sorted, o)
  const room = opts.room && ROOM_VOLUME_M3[opts.room] ? opts.room : 'slaapkamer'
  return {
    events, co2Floor,
    days: summarizeDays(sorted, events, co2Floor, o),
    assumptions: { room, volumeM3: opts.roomVolumeM3 ?? ROOM_VOLUME_M3[room], occupantsNight: opts.occupantsNight ?? null },
  }
}

export const EVENT_LABEL: Record<EventKind, string> = {
  luchten: 'Gelucht (raam of deur)', achtergrond: 'Achtergrond (raam dicht)', vochtpiek: 'Vochtpiek', bezetting: 'Bezetting',
}

/** Slapers uit de vragenlijst ('0'…'4+') als getal. */
export function occupantsFromProfile(v: unknown): number | null {
  if (typeof v !== 'string' || !v) return null
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : null
}
