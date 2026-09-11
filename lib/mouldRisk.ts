// Schimmelrisico — koudste plek + VTT-groeimodel + vochtbelasting + winterverwachting.
//
// Vervangt lib/mouldModels.ts (de Flask-port). Die had drie fouten die de uitkomst
// bepaalden: (1) de "VTT"-stap was niet het gepubliceerde model — M=1 in 17 uur i.p.v.
// weken, 87% afname per droge dag, hogere RV gaf een LAGER evenwicht; (2) de WoonScore
// kon nooit boven ~54 komen, dus nooit "hoog risico"; (3) de wand werd als vlak
// muurdeel met Rsi 0,13 gerekend, niet als koudste plek. Zie CALCULATIONS.md §4.
//
// Opbouw, alles puur (geen I/O):
//   1. Koudste plek: temperatuurfactor f (NEN 2778 / ISO 13788) per bouwperiode, of gemeten.
//        θ_opp = θ_e + f·(θ_i − θ_e)        RV_opp = p_i / p_sat(θ_opp)
//   2. Groei: VTT-schimmelindex M (0–6), Hukka & Viitanen 1999 + Ojanen et al. 2010
//      (gevoeligheidsklassen), in dagen gerekend, met afname volgens het model.
//   3. Vochtbelasting: Δv = v_binnen − v_buiten (g/m³), omgerekend naar winterniveau met
//      de seizoenslijn uit ISO 13788 (Δv lineair naar 0 bij 20 °C buiten).
//   4. Winterverwachting: januari-omstandigheden + gemeten vochtbelasting + f.
//
// Geen enkele uitkomst hier is gevalideerd tegen inspecties; de pilot is daarvoor.

import type { HouseProfile } from './houseProfile'

// ── Fysica ────────────────────────────────────────────────────────────────────

/** Verzadigingsdampdruk (hPa), Magnus (Sonntag 1990), geldig −45…60 °C. */
export function pSat(T: number): number {
  return 6.112 * Math.exp((17.62 * T) / (243.12 + T))
}

/** Absolute vochtigheid (g/m³) uit temperatuur (°C) en RV (%). */
export function vAbs(T: number, rh: number): number {
  return (216.7 * ((rh / 100) * pSat(T))) / (T + 273.15)
}

/** Dampdruk (hPa) uit absolute vochtigheid (g/m³) bij temperatuur T. */
function pFromV(v: number, T: number): number {
  return (v * (T + 273.15)) / 216.7
}

/** Oppervlaktetemperatuur en -RV op een plek met temperatuurfactor f. */
export function surfaceConditions(Ti: number, rhi: number, Te: number, f: number): { t: number; rh: number } {
  const t = Te + f * (Ti - Te)
  const rh = Math.min(100, ((rhi / 100) * pSat(Ti)) / pSat(t) * 100)
  return { t, rh }
}

// ── 1. Koudste plek ─────────────────────────────────────────────────────────

// Temperatuurfactor van de koudste plek (hoek, latei, vloerrand), niet van het vlakke
// muurdeel. Het Bouwbesluit eist f ≥ 0,65 voor nieuwbouw; ongeïsoleerde hoeken in oude
// woningen zitten rond 0,5. Dit zijn ordegroottes per bouwperiode — één meting met een
// IR-thermometer op een koude ochtend, f = (θ_hoek − θ_e)/(θ_i − θ_e), is beter.
export const F_BY_PERIOD: Record<string, number> = {
  voor_1945: 0.5, // massief metselwerk, geen spouw
  '1945_1974': 0.55, // ongeïsoleerde spouw, betonnen koudebruggen (balkons, lateien)
  '1975_1991': 0.65, // eerste spouwisolatie
  '1992_2005': 0.7,
  na_2005: 0.75,
}
const F_BY_INSULATION: Record<string, number> = { poor: 0.5, moderate: 0.6, good: 0.7, excellent: 0.75 }
const F_DEFAULT = 0.5 // onbekend → voorzichtig

export type FSource = 'gemeten' | 'bouwperiode' | 'isolatie' | 'standaard'

/**
 * Temperatuurfactor voor de koudste plek. Volgorde: gemeten → bouwperiode uit de
 * vragenlijst → isolatieklasse van het apparaat (alleen zonder vragenlijst; die klasse
 * leunt op het glas en zegt weinig over de muur) → 0,5.
 */
export function coldSpotFactor(
  profile?: Partial<HouseProfile> | null,
  insulation?: string | null,
  measured?: number | null,
): { f: number; source: FSource } {
  if (measured != null && measured >= 0.2 && measured <= 0.98) return { f: measured, source: 'gemeten' }
  let f: number | undefined
  let source: FSource = 'standaard'
  if (profile?.build_period && F_BY_PERIOD[profile.build_period] != null) { f = F_BY_PERIOD[profile.build_period]; source = 'bouwperiode' }
  else if (!profile && insulation && F_BY_INSULATION[insulation] != null) { f = F_BY_INSULATION[insulation]; source = 'isolatie' }
  f ??= F_DEFAULT
  // Enkel glas: het kozijn en de dagkant zijn de koudste plek, ongeacht het bouwjaar.
  if (profile?.glazing === 'enkel') f = Math.min(f, 0.5)
  return { f, source }
}

// Maandnormaal buitentemperatuur Amsterdam/De Bilt (°C), gelijk aan lib/trends.ts.
// Alleen als terugval wanneer er geen weermeting is — nooit een vaste 5 °C in de zomer.
export const MONTH_NORMAL_C = [3.5, 4.2, 7.0, 10.5, 14.8, 17.8, 19.9, 19.6, 16.4, 12.0, 7.5, 4.5]

/** Benadering bodemtemperatuur op ~1 m diepte (°C): gem. 10,5, piek half aug., dal half feb. */
export function groundTemp(ts: number): number {
  const d = new Date(ts)
  const doy = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86_400_000
  return 10.5 + 4.5 * Math.sin((2 * Math.PI * (doy - 135)) / 365)
}

// ── 2. VTT-schimmelindex (Hukka & Viitanen 1999; Ojanen et al. 2010) ──────────

export type SensitivityClass = 'VS' | 'S' | 'MR' | 'R'

interface VttParams { k1Low: number; k1High: number; A: number; B: number; C: number; rhMin: number; cMat: number }

// Ojanen et al. (2010), tabel met gevoeligheidsklassen. cMat (relatieve afname) is een
// keuze binnen de in dat artikel genoemde range (1 / 0,5 / 0,25 / 0,1).
export const VTT_CLASSES: Record<SensitivityClass, VttParams> = {
  VS: { k1Low: 1, k1High: 2, A: 1, B: 7, C: 2, rhMin: 80, cMat: 1 }, // onbehandeld hout
  S: { k1Low: 0.578, k1High: 0.386, A: 0.3, B: 6, C: 1, rhMin: 80, cMat: 0.5 }, // behang, gipsplaat, verf op stoffige pleister
  MR: { k1Low: 0.072, k1High: 0.097, A: 0, B: 5, C: 1.5, rhMin: 85, cMat: 0.25 }, // beton, kalkzandsteen, metselwerk
  R: { k1Low: 0.033, k1High: 0.014, A: 0, B: 3, C: 1, rhMin: 85, cMat: 0.1 }, // glas, metaal, gladde kunststof
}

export const SENSITIVITY_LABELS: Record<SensitivityClass, string> = {
  VS: 'Hout (onbehandeld) — zeer gevoelig',
  S: 'Behang, gips, pleister — gevoelig',
  MR: 'Beton, metselwerk — matig bestand',
  R: 'Tegels, glas, kunststof — bestand',
}

/** Kritieke RV (%) voor groei bij temperatuur T (°C). */
export function vttRhCrit(T: number, rhMin = 80): number {
  if (T > 20) return rhMin
  return Math.max(rhMin, -0.00267 * T ** 3 + 0.16 * T ** 2 - 3.13 * T + 100)
}

export interface VttState { m: number; hoursUnfavourable: number }

/**
 * Eén tijdstap van de VTT-index. dtH in uren. Groei per dag:
 *   dM/dt = k1·k2 / (7·exp(−0,68·ln T − 13,9·ln RV + 66,02))
 * met k2 = max(1 − exp(2,3·(M − M_max)), 0). Afname onder ongunstige condities (per dag):
 * −0,032 de eerste 6 uur, 0 tot 24 uur, daarna −0,016; maal cMat.
 */
export function vttAdvance(s: VttState, T: number, rh: number, dtH: number, cls: SensitivityClass = 'S'): VttState {
  const p = VTT_CLASSES[cls]
  const crit = vttRhCrit(T, p.rhMin)
  if (T > 0 && T < 50 && rh >= crit) {
    const x = (crit - rh) / (crit - 100) // 0 bij de drempel, 1 bij 100%
    const mMax = p.A + p.B * x - p.C * x * x
    const k1 = s.m < 1 ? p.k1Low : p.k1High
    const k2 = Math.max(1 - Math.exp(2.3 * (s.m - mMax)), 0)
    const tWeeks = Math.exp(-0.68 * Math.log(T) - 13.9 * Math.log(Math.max(rh, 1)) + 66.02)
    const perDay = (k1 * k2) / (7 * tWeeks)
    return { m: Math.min(6, s.m + (perDay * dtH) / 24), hoursUnfavourable: 0 }
  }
  const e0 = s.hoursUnfavourable
  const e1 = e0 + dtH
  const overlap = (a: number, b: number) => Math.max(0, Math.min(e1, b) - Math.max(e0, a))
  const decline = (p.cMat * (0.032 * overlap(0, 6) + 0.016 * overlap(24, Infinity))) / 24
  return { m: Math.max(0, s.m - decline), hoursUnfavourable: e1 }
}

/** Dagen tot index `target` bij constante condities (null = niet binnen `maxDays`). */
export function vttDaysTo(target: number, T: number, rh: number, cls: SensitivityClass = 'S', maxDays = 180): number | null {
  let s: VttState = { m: 0, hoursUnfavourable: 0 }
  for (let h = 1; h <= maxDays * 24; h++) {
    s = vttAdvance(s, T, rh, 1, cls)
    if (s.m >= target) return h / 24
  }
  return null
}

export function mouldIndexText(m: number): string {
  if (m < 0.5) return 'geen groei'
  if (m < 1) return 'groei op gang, nog niet te zien'
  if (m < 2) return 'beginnende groei (microscopisch)'
  if (m < 3) return 'enkele kolonies (microscopisch)'
  if (m < 4) return 'zichtbare schimmelplekjes'
  return 'duidelijk zichtbare schimmel'
}

// ── 3 + 4. Beoordeling ────────────────────────────────────────────────────────

export type Level = 'laag' | 'verhoogd' | 'hoog'
export type LoadLevel = 'laag' | 'normaal' | 'hoog' | 'zeer hoog'
export type Reliability = 'laag' | 'matig' | 'hoog'

export interface IndoorSample { ts: number; t: number; rh: number }
export interface OutdoorSample { ts: number; t: number; rh: number | null }

export interface MouldInputs {
  indoor: IndoorSample[]   // oplopend in tijd
  outdoor: OutdoorSample[] // uurlijks weer, oplopend in tijd
  profile?: Partial<HouseProfile> | null
  insulation?: string | null
  fMeasured?: number | null
  material?: SensitivityClass
  now?: number
}

export interface MouldAssessment {
  f: number
  fSource: FSource
  material: SensitivityClass
  series: { ts: number[]; tIndoor: number[]; rhIndoor: number[]; tSurface: number[]; rhSurface: number[]; mi: number[] }
  now: {
    level: Level
    mi: number
    miMax: number
    rhSurface: number | null
    pctAbove80: number | null   // % van de tijd, laatste 14 dagen, oppervlakte-RV ≥ 80%
    condensHours: number        // uren met RV_opp ≥ 100% (condens) in de laatste 14 dagen
    outdoorMeasured: boolean    // false = maandnormaal gebruikt (geen weerdata)
  }
  load: {
    dv0: number                 // vochtoverschot omgerekend naar ≤0 °C buiten (g/m³)
    range: [number, number]     // p25–p75
    n: number
    basis: 'dagen' | 'nachten' | 'vragenlijst'
    reliability: Reliability
    level: LoadLevel
    recentDv: number | null     // gemeten Δv, gemiddelde laatste 7 dagen (g/m³)
  }
  winter: {
    te: number
    ti: number
    tiMeasured: boolean
    rhIndoor: number
    tSurface: number
    rhSurface: number
    rhSurfaceRange: [number, number]
    level: Level
    levelRange: [Level, Level]
    daysToVisible: number | null // dagen tot M ≥ 3 in de koudste hoek, constante wintercondities
    daysToStart: number | null   // dagen tot M ≥ 1
  }
}

// Winterreferentie: koudste maand (januari) volgens dezelfde maandnormalen, RV ≈ 88%.
export const WINTER_TE = MONTH_NORMAL_C[0]
export const WINTER_RHE = 88

const OUTDOOR_TAU_H = 12        // muren dempen dagschommelingen; ~12 u voor metselwerk
const MAX_OUTDOOR_GAP_MS = 3 * 3_600_000
const MAX_STEP_H = 6            // gat in de metingen: niet doorgroeien of afnemen over onbekende tijd

const quantile = (a: number[], p: number) => {
  if (!a.length) return NaN
  const s = [...a].sort((x, y) => x - y)
  const i = p * (s.length - 1)
  const lo = Math.floor(i), hi = Math.ceil(i)
  return s[lo] + (s[hi] - s[lo]) * (i - lo)
}
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN)

/** ISO 13788-seizoenslijn: fractie van het wintervochtoverschot bij buitentemperatuur Te. */
const seasonFraction = (Te: number) => Math.min(1, Math.max(0, (20 - Te) / 20))

export function loadLevel(dv0: number): LoadLevel {
  // ISO 13788 rekent voor woningen met ~4 g/m³ (weinig bewoners) tot ~6 g/m³ (druk bewoond).
  if (dv0 < 3) return 'laag'
  if (dv0 < 5) return 'normaal'
  if (dv0 < 7) return 'hoog'
  return 'zeer hoog'
}

/** Schatting uit de vragenlijst als er nog geen koele dagen gemeten zijn. */
export function profileMoisturePrior(p?: Partial<HouseProfile> | null): number {
  let dv = 4
  const hh: Record<string, number> = { '1': -0.5, '2': 0, '3': 0.5, '4': 1, '5+': 1.5 }
  const laundry: Record<string, number> = { nooit: 0, soms: 0.5, vaak: 1.5 }
  const vent: Record<string, number> = { geen: 1.5, raam: 0.5, roosters: 0, mechanisch: -0.5, wtw: -1, onbekend: 0 }
  const seen: Record<string, number> = { geen: 0, condens: 0.5, schimmel: 1 }
  if (p) dv += (hh[p.household_size ?? ''] ?? 0) + (laundry[p.laundry_indoors ?? ''] ?? 0) + (vent[p.ventilation ?? ''] ?? 0) + (seen[p.moisture ?? ''] ?? 0)
  return Math.min(9, Math.max(2, dv))
}

/** Aanname binnentemperatuur in de winter per kamer, als er nog geen stookseizoen gemeten is. */
export function winterIndoorAssumption(p?: Partial<HouseProfile> | null): number {
  if (p?.heating === 'geen') return 15
  if (p?.room === 'slaapkamer' || p?.room === 'kinderkamer') return 17
  if (p?.room === 'woonkamer' || p?.room === 'keuken' || p?.room === 'badkamer') return 20
  return 18
}

function surfaceLevel(rh: number): Level {
  // ISO 13788: ontwerpcriterium 80% aan het oppervlak (maandgemiddeld).
  if (rh >= 80) return 'hoog'
  if (rh >= 70) return 'verhoogd'
  return 'laag'
}

const dayKey = (ts: number) => new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' })
const localHour = (ts: number) => +new Date(ts).toLocaleString('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hour12: false }) % 24

export function assessMould(inp: MouldInputs): MouldAssessment {
  const cls = inp.material ?? 'S'
  const { f, source: fSource } = coldSpotFactor(inp.profile, inp.insulation, inp.fMeasured)
  const indoor = inp.indoor.filter((s) => Number.isFinite(s.t) && Number.isFinite(s.rh) && s.rh > 0)
  const outdoor = inp.outdoor.filter((o) => Number.isFinite(o.t)).sort((a, b) => a.ts - b.ts)
  const now = inp.now ?? (indoor.length ? indoor[indoor.length - 1].ts : Date.now())
  const souterrain = inp.profile?.floor === 'souterrain'

  // Buitentemperatuur gedempt (EMA, τ = 12 u) voor het muuroppervlak; ruwe waarde voor Δv.
  const ema: number[] = []
  for (let i = 0; i < outdoor.length; i++) {
    if (i === 0) { ema.push(outdoor[0].t); continue }
    const dt = (outdoor[i].ts - outdoor[i - 1].ts) / 3_600_000
    const a = 1 - Math.exp(-Math.max(dt, 0) / OUTDOOR_TAU_H)
    ema.push(ema[i - 1] + a * (outdoor[i].t - ema[i - 1]))
  }
  let j = 0
  const nearestOutdoor = (ts: number): number | null => {
    if (!outdoor.length) return null
    while (j + 1 < outdoor.length && outdoor[j + 1].ts <= ts) j++
    const k = j + 1 < outdoor.length && Math.abs(outdoor[j + 1].ts - ts) < Math.abs(outdoor[j].ts - ts) ? j + 1 : j
    return Math.abs(outdoor[k].ts - ts) <= MAX_OUTDOOR_GAP_MS ? k : null
  }

  const ts: number[] = [], tIn: number[] = [], rhIn: number[] = [], tS: number[] = [], rhS: number[] = [], mi: number[] = []
  const pairs: { ts: number; ti: number; rhi: number; te: number; rhe: number }[] = []
  let normalUsed = 0
  let state: VttState = { m: 0, hoursUnfavourable: 0 }
  for (let i = 0; i < indoor.length; i++) {
    const s = indoor[i]
    const k = nearestOutdoor(s.ts)
    let teSurf: number
    if (k != null) {
      teSurf = ema[k]
      const o = outdoor[k]
      if (o.rh != null && Number.isFinite(o.rh)) pairs.push({ ts: s.ts, ti: s.t, rhi: s.rh, te: o.t, rhe: o.rh })
    } else {
      teSurf = MONTH_NORMAL_C[new Date(s.ts).getMonth()]
      normalUsed++
    }
    if (souterrain) teSurf = Math.min(teSurf, groundTemp(s.ts))
    const surf = surfaceConditions(s.t, s.rh, teSurf, f)
    const dtH = i === 0 ? 0 : Math.min(MAX_STEP_H, (s.ts - indoor[i - 1].ts) / 3_600_000)
    state = vttAdvance(state, surf.t, surf.rh, dtH, cls)
    ts.push(s.ts); tIn.push(s.t); rhIn.push(s.rh); tS.push(+surf.t.toFixed(2)); rhS.push(+surf.rh.toFixed(1)); mi.push(+state.m.toFixed(3))
  }

  // Nu: laatste 14 dagen, tijdgewogen.
  const since14 = now - 14 * 86_400_000
  let tot = 0, above = 0, condens = 0
  for (let i = 1; i < ts.length; i++) {
    if (ts[i] < since14) continue
    const dt = Math.min(MAX_STEP_H, (ts[i] - ts[i - 1]) / 3_600_000)
    tot += dt
    if (rhS[i] >= 80) above += dt
    if (rhS[i] >= 99.5) condens += dt
  }
  const miNow = mi.length ? mi[mi.length - 1] : 0
  const miMax = mi.length ? Math.max(...mi) : 0
  const pctAbove80 = tot > 0 ? (above / tot) * 100 : null
  const nowLevel: Level = miNow >= 1 || (pctAbove80 ?? 0) >= 50 ? 'hoog' : miNow >= 0.1 || (pctAbove80 ?? 0) >= 10 ? 'verhoogd' : 'laag'

  // Vochtbelasting per dag (dagen met buiten ≤ 15 °C en ≥ 16 u dekking), anders per koele nacht.
  const byDay = new Map<string, typeof pairs>()
  for (const p of pairs) { const k = dayKey(p.ts); (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(p) }
  const stepH = pairs.length > 1 ? Math.max(1, Math.round(quantile(pairs.slice(1).map((p, i) => (p.ts - pairs[i].ts) / 3_600_000), 0.5))) : 1
  const daily: { dv0: number; te: number; ti: number }[] = []
  const nightly: { dv0: number; te: number }[] = []
  for (const [, ps] of byDay) {
    const te = mean(ps.map((p) => p.te))
    const dv = mean(ps.map((p) => vAbs(p.ti, p.rhi) - vAbs(p.te, p.rhe)))
    if (ps.length * stepH >= 16 && te <= 15) daily.push({ dv0: Math.max(0, dv) / seasonFraction(te), te, ti: mean(ps.map((p) => p.ti)) })
    const night = ps.filter((p) => localHour(p.ts) < 7 && p.te <= 15)
    if (night.length * stepH >= 3) {
      const nte = mean(night.map((p) => p.te))
      const ndv = mean(night.map((p) => vAbs(p.ti, p.rhi) - vAbs(p.te, p.rhe)))
      nightly.push({ dv0: Math.max(0, ndv) / seasonFraction(nte), te: nte })
    }
  }
  const recent = pairs.filter((p) => p.ts >= now - 7 * 86_400_000)
  const recentDv = recent.length ? +mean(recent.map((p) => vAbs(p.ti, p.rhi) - vAbs(p.te, p.rhe))).toFixed(2) : null
  const use = daily.slice(-30)
  let load: MouldAssessment['load']
  if (use.length >= 3) {
    const vals = use.map((d) => d.dv0)
    const teMed = quantile(use.map((d) => d.te), 0.5)
    const rel: Reliability = use.length >= 7 && teMed <= 8 ? 'hoog' : teMed <= 12 ? 'matig' : 'laag'
    load = { dv0: quantile(vals, 0.5), range: [quantile(vals, 0.25), quantile(vals, 0.75)], n: use.length, basis: 'dagen', reliability: rel, level: 'normaal', recentDv }
  } else if (nightly.length >= 2) {
    // 's Nachts is de kamer dicht en bewoond: ligt hoger dan het daggemiddelde → voorzichtig.
    const vals = nightly.slice(-30).map((d) => d.dv0)
    load = { dv0: quantile(vals, 0.5), range: [quantile(vals, 0.25), quantile(vals, 0.75)], n: vals.length, basis: 'nachten', reliability: 'laag', level: 'normaal', recentDv }
  } else {
    const dv0 = profileMoisturePrior(inp.profile)
    load = { dv0, range: [Math.max(2, dv0 - 1.5), dv0 + 1.5], n: 0, basis: 'vragenlijst', reliability: 'laag', level: 'normaal', recentDv }
  }
  load.dv0 = +load.dv0.toFixed(1)
  load.range = [+load.range[0].toFixed(1), +load.range[1].toFixed(1)]
  load.level = loadLevel(load.dv0)

  // Winterverwachting.
  const heatingDays = daily.filter((d) => d.te <= 10)
  const tiMeasured = heatingDays.length >= 3
  const ti = tiMeasured ? mean(heatingDays.map((d) => d.ti)) : winterIndoorAssumption(inp.profile)
  const te = WINTER_TE
  const project = (dv0: number) => {
    const vi = vAbs(te, WINTER_RHE) + dv0 * seasonFraction(te)
    const pi = pFromV(vi, ti)
    const rhIndoor = Math.min(100, (pi / pSat(ti)) * 100)
    const surf = surfaceConditions(ti, rhIndoor, te, f)
    return { rhIndoor, tSurface: surf.t, rhSurface: surf.rh }
  }
  const mid = project(load.dv0)
  const lo = project(load.range[0])
  const hi = project(load.range[1])
  const winter: MouldAssessment['winter'] = {
    te, ti: +ti.toFixed(1), tiMeasured,
    rhIndoor: +mid.rhIndoor.toFixed(0), tSurface: +mid.tSurface.toFixed(1), rhSurface: +mid.rhSurface.toFixed(0),
    rhSurfaceRange: [+lo.rhSurface.toFixed(0), +hi.rhSurface.toFixed(0)],
    level: surfaceLevel(mid.rhSurface),
    levelRange: [surfaceLevel(lo.rhSurface), surfaceLevel(hi.rhSurface)],
    daysToStart: vttDaysTo(1, mid.tSurface, mid.rhSurface, cls),
    daysToVisible: vttDaysTo(3, mid.tSurface, mid.rhSurface, cls),
  }

  return {
    f, fSource, material: cls,
    series: { ts, tIndoor: tIn, rhIndoor: rhIn, tSurface: tS, rhSurface: rhS, mi },
    now: {
      level: nowLevel, mi: +miNow.toFixed(2), miMax: +miMax.toFixed(2),
      rhSurface: rhS.length ? rhS[rhS.length - 1] : null,
      pctAbove80: pctAbove80 == null ? null : +pctAbove80.toFixed(0),
      condensHours: +condens.toFixed(0),
      outdoorMeasured: indoor.length > 0 && normalUsed / indoor.length < 0.5,
    },
    load,
    winter,
  }
}

// ── Voorbeelddata (lege account) ────────────────────────────────────────────────

/** Deterministische voorbeeldreeks: Nederlandse slaapkamer in de herfst, elke 3 uur, 28 dagen. */
export function demoInputs(now = Date.now()): MouldInputs {
  let seed = 42
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const indoor: IndoorSample[] = []
  const outdoor: OutdoorSample[] = []
  const start = now - 28 * 86_400_000
  for (let ts = start; ts <= now; ts += 3_600_000) {
    const h = new Date(ts).getHours()
    const te = 9 + 3 * Math.sin(((h - 9) * Math.PI) / 12) + (rand() - 0.5)
    outdoor.push({ ts, t: +te.toFixed(1), rh: 85 })
    if (h % 3 === 0) indoor.push({ ts, t: +(18.5 + 1.2 * Math.sin(((h - 6) * Math.PI) / 12)).toFixed(1), rh: +(68 + 6 * Math.sin(((h - 3) * Math.PI) / 12) + (rand() - 0.5) * 3).toFixed(1) })
  }
  return { indoor, outdoor, profile: { build_period: '1945_1974', room: 'slaapkamer', glazing: 'dubbel' }, material: 'S', now }
}
