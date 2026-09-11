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

export type FSource = 'gemeten' | 'bouwperiode' | 'renovatie' | 'isolatie' | 'standaard'

/**
 * Temperatuurfactor voor de koudste plek, met een spreiding (sd) voor de kansberekening.
 * Volgorde: gemeten → bouwperiode uit de vragenlijst → isolatieklasse van het apparaat (alleen
 * zonder vragenlijst; die klasse leunt op het glas) → 0,5. Daarna renovatie: een oud huis met
 * na-geïsoleerde spouw of gevel heeft veel warmere hoeken (f ≥ 0,70); "deels" +0,05. Is het
 * onbekend of een oud huis gerenoveerd is, dan iets hoger en vooral onzekerder.
 */
export function coldSpotFactor(
  profile?: Partial<HouseProfile> | null,
  insulation?: string | null,
  measured?: number | null,
): { f: number; source: FSource; sd: number } {
  if (measured != null && measured >= 0.2 && measured <= 0.98) return { f: measured, source: 'gemeten', sd: 0.03 }
  let f: number | undefined
  let source: FSource = 'standaard'
  let sd = 0.08
  if (profile?.build_period && F_BY_PERIOD[profile.build_period] != null) { f = F_BY_PERIOD[profile.build_period]; source = 'bouwperiode'; sd = 0.05 }
  else if (!profile && insulation && F_BY_INSULATION[insulation] != null) { f = F_BY_INSULATION[insulation]; source = 'isolatie'; sd = 0.07 }
  f ??= F_DEFAULT
  if (f < 0.7) {
    const reno = profile?.renovation
    if (reno === 'gevel') { f = 0.7; source = 'renovatie'; sd = 0.06 }
    else if (reno === 'deels') { f = Math.min(0.75, f + 0.05); source = 'renovatie'; sd = 0.06 }
    else if (reno !== 'nee') { f += 0.03; sd = Math.max(sd, 0.09) } // kan gerenoveerd zijn
  }
  // Enkel glas: het kozijn en de dagkant zijn de koudste plek, ongeacht het bouwjaar.
  if (profile?.glazing === 'enkel') f = Math.min(f, 0.5)
  return { f: +f.toFixed(2), source, sd }
}

// Maandnormaal buitentemperatuur Amsterdam/De Bilt (°C), gelijk aan lib/trends.ts.
// Terugval zonder weermeting (nooit een vaste 5 °C in de zomer) en basis van de jaarverwachting.
export const MONTH_NORMAL_C = [3.5, 4.2, 7.0, 10.5, 14.8, 17.8, 19.9, 19.6, 16.4, 12.0, 7.5, 4.5]
// Maandnormaal relatieve vochtigheid buiten (%), De Bilt, afgerond.
export const MONTH_NORMAL_RH = [88, 85, 80, 75, 74, 75, 77, 78, 82, 85, 88, 89]
const MONTH_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']
const MONTH_LONG = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']

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
  f: number                      // open hoek
  fFurniture: number             // achter een kast/bed tegen de buitenmuur (f − 0,1)
  furniture: 'ja' | 'nee' | 'onbekend'
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
    level: Level                 // uit de kans, zie probabilityLevel
    pVisible: number             // kans op zichtbare schimmel (index ≥ 3) in het komende seizoen, 0–1
    pGrowth: number              // kans op groei (index ≥ 1), 0–1
    pOpen: number                // kans op zichtbaar in een open hoek
    pFurniture: number           // kans op zichtbaar achter een kast/bed tegen de buitenmuur
    rhSurfaceFurniture: number   // januari, achter de kast
    provisional: boolean         // voorlopig: < 14 dagen data of een onbetrouwbare vochtschatting (zomer, geen koele dagen)
    daysToVisible: number | null // dagen tot M ≥ 3 in de koudste hoek, constante wintercondities
    daysToStart: number | null   // dagen tot M ≥ 1
  }
  profile: HouseMouldProfile
  year: MonthOutlook[]           // 2 maanden terug t/m 9 vooruit (ISO 13788-maandmethode)
  yearGrowth: { start: string | null; visible: string | null } // maand waarin M ≥ 1 / ≥ 3, als er niets verandert
  whatIf: WhatIf[]               // januari-omstandigheden met één maatregel
}

export type ProfileType = 'koud-vochtig' | 'koud' | 'vochtig' | 'balans'
export interface HouseMouldProfile { type: ProfileType; title: string; text: string; cold: boolean; humid: boolean }
export interface MonthOutlook {
  key: string          // 'YYYY-MM'
  label: string        // 'sep'
  te: number; ti: number; rhIndoor: number; rhSurface: number
  level: Level
  measured: number | null // gemiddelde berekende RV op de koudste plek uit echte metingen
  mi: number | null        // verwachte schimmelindex aan het eind van de maand (alleen vooruit)
  isNow: boolean; isPast: boolean
}
export interface WhatIf { key: string; label: string; rhSurface: number; pVisible: number; level: Level; better: boolean }

// Typering: waar zit het risico — in het gebouw (koude plekken) of in de bewoning (vocht)?
const PROFILE_TEXT: Record<ProfileType, { title: string; text: string }> = {
  'koud-vochtig': {
    title: 'Koude plekken én veel vocht',
    text: 'De hoeken worden in de winter koud en er komt veel vocht in de lucht. Dat is het klassieke schimmelhuis: het vocht slaat neer op de koude plekken. Minder vocht helpt, maar de koude plekken blijven het zwakke punt.',
  },
  koud: {
    title: 'Koude plekken',
    text: 'Het vochtniveau is normaal, maar de hoeken worden in de winter zo koud dat zelfs gewoon vocht er neerslaat. Het risico zit vooral in het gebouw: isolatie en koudebruggen.',
  },
  vochtig: {
    title: 'Veel vocht',
    text: 'Het gebouw houdt de hoeken redelijk warm, maar er komt veel vocht in de lucht. Het risico zit vooral in vocht en ventilatie: koken, douchen, was drogen en luchten.',
  },
  balans: {
    title: 'In balans',
    text: 'Geen opvallend koude plekken en een normaal vochtniveau. Schimmel is hier niet te verwachten, tenzij er iets verandert, zoals een lekkage of veel was binnen drogen.',
  },
}
export function houseProfileType(f: number, dv0: number): HouseMouldProfile {
  const cold = f < 0.6
  const humid = dv0 >= 5
  const type: ProfileType = cold && humid ? 'koud-vochtig' : cold ? 'koud' : humid ? 'vochtig' : 'balans'
  return { type, ...PROFILE_TEXT[type], cold, humid }
}

/** RV binnen en op een plek met factor f, voor maandgemiddelde buitencondities en vochtbelasting Δv0. */
function projectAt(te: number, rhe: number, teSurface: number, ti: number, dv0: number, f: number) {
  const vi = vAbs(te, rhe) + dv0 * seasonFraction(te)
  const pi = pFromV(vi, ti)
  const rhIndoor = Math.min(100, (pi / pSat(ti)) * 100)
  const surf = surfaceConditions(ti, rhIndoor, teSurface, f)
  return { rhIndoor, tSurface: surf.t, rhSurface: surf.rh }
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

/**
 * Winterlabel uit de verwachte groei over het komende seizoen: zichtbare schimmel (index ≥ 3,
 * ook de grens in ASHRAE 160) = hoog, microscopische groei (1–3) = verhoogd, anders laag.
 * Niet de 80%-ontwerpgrens alleen: die heeft veiligheidsmarge en gaf bijna elk oud huis "hoog".
 */
export function probabilityLevel(pVisible: number, pGrowth: number): Level {
  if (pVisible >= 0.5) return 'hoog'
  if (pVisible >= 0.15 || pGrowth >= 0.3) return 'verhoogd'
  return 'laag'
}

// Vaste standaardnormale trekkingen (Box–Muller, vaste seed): elk huis en elke maatregel
// gebruikt dezelfde reeks, dus dezelfde invoer geeft altijd dezelfde kans en verschillen
// tussen maatregelen zijn geen toeval.
const MC_N = 200
const MC_Z: [number, number, number, number][] = (() => {
  let seed = 20260911
  const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const z = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand())
  return Array.from({ length: MC_N }, () => [z(), z(), z(), rand()] as [number, number, number, number])
})()

export function growthLevel(maxM: number): Level {
  if (maxM >= 3) return 'hoog'
  if (maxM >= 1) return 'verhoogd'
  return 'laag'
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
  const { f, source: fSource, sd: fSd } = coldSpotFactor(inp.profile, inp.insulation, inp.fMeasured)
  const indoor = inp.indoor.filter((s) => Number.isFinite(s.t) && Number.isFinite(s.rh) && s.rh > 0)
  const outdoor = inp.outdoor.filter((o) => Number.isFinite(o.t)).sort((a, b) => a.ts - b.ts)
  const now = inp.now ?? (indoor.length ? indoor[indoor.length - 1].ts : Date.now())
  // Achter een kast of bed tegen de buitenmuur komt minder warmte bij de muur: daar is het
  // ~0,1 kouder in f dan in een open hoek (ISO 13788 rekent daar met een hogere Rsi). Staat er
  // zeker een kast, dan is dat de koudste plek; weten we het niet, dan telt die plek voor de
  // helft van de varianten mee in de kans.
  const furniture: 'ja' | 'nee' | 'onbekend' = inp.profile?.furniture_outer_wall === 'ja' ? 'ja' : inp.profile?.furniture_outer_wall === 'nee' ? 'nee' : 'onbekend'
  const fFurniture = Math.max(0.3, +(f - 0.1).toFixed(2))
  const furnitureShare = furniture === 'ja' ? 1 : furniture === 'nee' ? 0 : 0.5
  const fSpot = furniture === 'ja' ? fFurniture : f
  const souterrain = inp.profile?.floor === 'souterrain'
  const dataDays = indoor.length > 1 ? (indoor[indoor.length - 1].ts - indoor[0].ts) / 86_400_000 : 0

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
    const surf = surfaceConditions(s.t, s.rh, teSurf, fSpot)
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
  const project = (dv0: number, tiX = ti, fX = f) => projectAt(te, WINTER_RHE, te, tiX, dv0, fX)
  const nowD = new Date(now)

  // Groei over het komende seizoen (maandmethode): elke maand bij zijn maandnormaal, de
  // vochtbelasting volgens de seizoenslijn, binnen in het stookseizoen de wintertemperatuur en
  // daarbuiten ~4 °C boven buiten. De VTT-index loopt vanaf de huidige stand door.
  const monthConditions = (mo: number, midMonth: number, dv0: number, tiX: number, fX: number) => {
    const teM = MONTH_NORMAL_C[mo]
    const teSurf = souterrain ? Math.min(teM, groundTemp(midMonth)) : teM
    const tiM = teM <= 15 ? tiX : Math.max(tiX, teM + 4)
    return { teM, tiM, ...projectAt(teM, MONTH_NORMAL_RH[mo], teSurf, tiM, dv0, fX) }
  }
  const season = (dv0: number, tiX: number, fX: number) => {
    let g: VttState = { m: miNow, hoursUnfavourable: 0 }
    let st: string | null = miNow >= 1 ? 'nu' : null
    let vis: string | null = miNow >= 3 ? 'nu' : null
    let maxM = miNow
    const monthEnd: number[] = []
    for (let k = 0; k < 10; k++) {
      const d = new Date(nowD.getFullYear(), nowD.getMonth() + k, 15)
      const mo = d.getMonth()
      const c = monthConditions(mo, d.getTime(), dv0, tiX, fX)
      const end = new Date(d.getFullYear(), mo + 1, 1).getTime()
      const hours = (end - (k === 0 ? now : new Date(d.getFullYear(), mo, 1).getTime())) / 3_600_000
      for (let h = 0; h < hours; h += 12) g = vttAdvance(g, c.tSurface, c.rhSurface, Math.min(12, hours - h), cls)
      monthEnd.push(+g.m.toFixed(2))
      maxM = Math.max(maxM, g.m)
      if (!st && g.m >= 1) st = MONTH_LONG[mo]
      if (!vis && g.m >= 3) vis = MONTH_LONG[mo]
    }
    return { start: st, visible: vis, maxM, monthEnd, level: growthLevel(maxM) }
  }

  // Kans: dezelfde seizoensberekening voor MC_N varianten van vochtbelasting, binnentemperatuur
  // en f, elk rond de schatting met een spreiding die past bij hoe zeker die schatting is.
  const dvSd = load.basis === 'dagen' ? (load.reliability === 'hoog' ? 0.5 : load.reliability === 'matig' ? 0.8 : 1.0)
    : load.basis === 'nachten' ? Math.max(1.0, (load.range[1] - load.range[0]) / 1.35) : 1.5
  const tiSd = tiMeasured ? 0.7 : 1.5
  const chance = (dv0: number, tiX: number, fX: number, n = MC_N, share = furnitureShare) => {
    let vis = 0, grow = 0
    for (let i = 0; i < n; i++) {
      const [a, b, c, u] = MC_Z[i]
      const fS = (u < share ? fX - 0.1 : fX) + fSd * c
      const m = season(Math.max(0, dv0 + dvSd * a), tiX + tiSd * b, Math.min(0.9, Math.max(0.3, fS))).maxM
      if (m >= 3) vis++
      if (m >= 1) grow++
    }
    return { pVisible: vis / n, pGrowth: grow / n }
  }

  const mid = project(load.dv0)
  const lo = project(load.range[0])
  const hi = project(load.range[1])
  const sMid = season(load.dv0, ti, fSpot)
  const p = chance(load.dv0, ti, f)
  const pOpen = chance(load.dv0, ti, f, 100, 0).pVisible
  const pFurn = chance(load.dv0, ti, f, 100, 1).pVisible
  const winter: MouldAssessment['winter'] = {
    te, ti: +ti.toFixed(1), tiMeasured,
    rhIndoor: +mid.rhIndoor.toFixed(0), tSurface: +mid.tSurface.toFixed(1), rhSurface: +mid.rhSurface.toFixed(0),
    rhSurfaceRange: [+lo.rhSurface.toFixed(0), +hi.rhSurface.toFixed(0)],
    level: probabilityLevel(p.pVisible, p.pGrowth),
    pVisible: +p.pVisible.toFixed(2),
    pGrowth: +p.pGrowth.toFixed(2),
    pOpen: +pOpen.toFixed(2),
    pFurniture: +pFurn.toFixed(2),
    // Een winterkans uit twee weken zomer of uit alleen de vragenlijst is een eerste schatting.
    // In de zomer geldt dat voor iedereen; vanaf oktober (koele dagen) wordt het vaster.
    provisional: dataDays < 14 || load.reliability === 'laag',
    rhSurfaceFurniture: +project(load.dv0, ti, fFurniture).rhSurface.toFixed(0),
    daysToStart: vttDaysTo(1, mid.tSurface, mid.rhSurface, cls),
    daysToVisible: vttDaysTo(3, mid.tSurface, mid.rhSurface, cls),
  }

  // Jaarverwachting: 2 maanden terug t/m 9 vooruit, met de gemeten maanden erbij.
  const measured = new Map<string, number[]>()
  for (let i = 0; i < ts.length; i++) { const d = new Date(ts[i]); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; (measured.get(k) ?? measured.set(k, []).get(k)!).push(rhS[i]) }
  const year: MonthOutlook[] = []
  for (let k = -2; k < 10; k++) {
    const d = new Date(nowD.getFullYear(), nowD.getMonth() + k, 15)
    const mo = d.getMonth()
    const key = `${d.getFullYear()}-${String(mo + 1).padStart(2, '0')}`
    const c = monthConditions(mo, d.getTime(), load.dv0, ti, fSpot)
    const ms = measured.get(key)
    year.push({
      key, label: MONTH_SHORT[mo], te: c.teM, ti: +c.tiM.toFixed(1), rhIndoor: +c.rhIndoor.toFixed(0), rhSurface: +c.rhSurface.toFixed(0),
      // Balkkleur: rood pas als het groeimodel zichtbare schimmel verwacht, oranje als de hoek
      // boven 80% komt (groei mogelijk), anders groen.
      level: k >= 0 && sMid.monthEnd[k] >= 3 ? 'hoog' : c.rhSurface >= 80 ? 'verhoogd' : 'laag',
      measured: ms?.length ? +mean(ms).toFixed(0) : null, mi: k >= 0 ? sMid.monthEnd[k] : null, isNow: k === 0, isPast: k < 0,
    })
  }
  const start = sMid.start
  const visible = sMid.visible

  // Wat helpt: dezelfde seizoensberekening met één maatregel tegelijk; het getal is de hoek in januari.
  const rank: Record<Level, number> = { laag: 0, verhoogd: 1, hoog: 2 }
  const variant = (key: string, label: string, dv0: number, tiX: number, fX: number): WhatIf => {
    const pr = project(Math.max(0, dv0), tiX, fX)
    const pv = chance(Math.max(0, dv0), tiX, fX, 100)
    const level = probabilityLevel(pv.pVisible, pv.pGrowth)
    return { key, label, rhSurface: +pr.rhSurface.toFixed(0), pVisible: +pv.pVisible.toFixed(2), level, better: rank[level] < rank[winter.level] || pv.pVisible < winter.pVisible - 0.05 }
  }
  const whatIf: WhatIf[] = [variant('ventileren', 'Beter ventileren: roosters open, afzuigen bij koken en douchen', load.dv0 - 1.5, ti, f)]
  const laundry = inp.profile?.laundry_indoors
  if (laundry === 'vaak' || laundry === 'soms') whatIf.push(variant('was', 'Was niet meer binnen drogen', load.dv0 - (laundry === 'vaak' ? 1 : 0.5), ti, f))
  if (furnitureShare > 0) {
    const pv = chance(load.dv0, ti, f, 100, 0)
    const level = probabilityLevel(pv.pVisible, pv.pGrowth)
    whatIf.push({ key: 'kast', label: 'Kast en bed 5–10 cm van de buitenmuur', rhSurface: +mid.rhSurface.toFixed(0), pVisible: +pv.pVisible.toFixed(2), level, better: rank[level] < rank[winter.level] || pv.pVisible < winter.pVisible - 0.05 })
  }
  whatIf.push(variant('warmer', 'Deze kamer 2 °C warmer stoken', load.dv0, ti + 2, f))
  whatIf.push(variant('combi', 'Ventileren én 2 °C warmer', load.dv0 - 1.5, ti + 2, f))
  if (f < 0.75) {
    whatIf.push(variant('isoleren', 'Koude plekken aanpakken (na-isolatie, f 0,75)', load.dv0, ti, 0.75))
    whatIf.push(variant('alles', 'Alles samen: ventileren, warmer én na-isolatie', load.dv0 - 1.5, ti + 2, 0.75))
  }

  return {
    f, fFurniture, furniture, fSource, material: cls,
    profile: houseProfileType(f, load.dv0),
    year,
    yearGrowth: { start, visible },
    whatIf,
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

/** Groeizin voor de jaarverwachting. */
export function growthSentence(g: MouldAssessment['yearGrowth']): string {
  if (g.start === 'nu') return g.visible === 'nu' ? 'Het groeimodel ziet al zichtbare schimmel op de koudste plek.' : `De groei is op de koudste plek al begonnen${g.visible ? ` en wordt naar verwachting in ${g.visible} zichtbaar` : ''}.`
  if (!g.start) return 'Het model verwacht het komende jaar geen schimmelgroei op de koudste plek.'
  return `Als er niets verandert, begint schimmelgroei in ${g.start}${g.visible ? ` en is het in ${g.visible} zichtbaar` : '; zichtbaar wordt het het komende jaar niet'}.`
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
