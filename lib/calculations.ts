// Pure calculation functions — ported from calculations.py

export function dewpoint(temp: number, rh: number): number {
  const a = 17.625, b = 243.04
  const rh_clamped = Math.max(1, Math.min(100, rh))
  const gamma = (a * temp / (b + temp)) + Math.log(rh_clamped / 100)
  return (b * gamma) / (a - gamma)
}

export function wallTemp(indoorTemp: number, outdoorTemp: number): number {
  return indoorTemp - (indoorTemp - outdoorTemp) * 0.35
}

export function mouldRisk(temp: number, rh: number, wallDelta: number = 3.5): number {
  const dp = dewpoint(temp, rh)
  const wallT = temp - wallDelta
  const margin = wallT - dp
  return Math.max(0, Math.min(100, (5 - margin) / 8 * 100))
}

export function mouldRiskScenario(
  indoorTemp: number, indoorRh: number, outdoorTemp: number
): number {
  const dp = dewpoint(indoorTemp, indoorRh)
  const wallT = wallTemp(indoorTemp, outdoorTemp)
  if (wallT < dp + 3) {
    return Math.min(85, 60 + (dp + 3 - wallT) * 8)
  }
  return Math.max(5, (indoorRh - 42) * 1.2)
}

export function healthScore(nightCo2: number, indoorRh: number, moldRisk: number): number {
  let co2s: number
  if (nightCo2 < 800) co2s = 100
  else if (nightCo2 < 1000) co2s = 70
  else if (nightCo2 < 1200) co2s = 40
  else co2s = 10

  let rhs: number
  if (indoorRh >= 40 && indoorRh <= 60) rhs = 100
  else if (indoorRh >= 30 && indoorRh <= 70) rhs = 70
  else if (indoorRh >= 20 && indoorRh <= 75) rhs = 40
  else rhs = 10

  let molds: number
  if (moldRisk < 30) molds = 100
  else if (moldRisk < 60) molds = 60
  else if (moldRisk < 80) molds = 25
  else molds = 5

  return Math.round(0.4 * co2s + 0.3 * rhs + 0.3 * molds)
}

export function healthLabel(score: number): { label: string; color: string } {
  if (score >= 85) return { label: 'Uitstekend', color: '#16A34A' }
  if (score >= 65) return { label: 'Goed', color: '#16A34A' }
  if (score >= 40) return { label: 'Matig', color: '#D97706' }
  return { label: 'Slecht', color: '#DC2626' }
}

// ── Scenario calculations (ported 1:1 from scenarios.py::scenario_outputs) ───

/** Saturation vapour pressure (kPa) — Tetens equation. */
function satVaporPressure(tempC: number): number {
  return 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3))
}

/** Absolute humidity (g/kg dry air) from temperature + RH. */
export function absHumidityGkg(tempC: number, rhPct: number): number {
  const e = satVaporPressure(tempC) * (Math.max(0, Math.min(100, rhPct)) / 100)
  return (622 * e) / Math.max(101.3 - e, 0.1)
}

/** Relative humidity (%) at a temperature for a given absolute humidity. */
export function rhFromAbs(tempC: number, absHGkg: number): number {
  const eSat = satVaporPressure(tempC)
  const e = (absHGkg * 101.3) / (622 + absHGkg)
  return Math.max(0, Math.min(99, (e / eSat) * 100))
}

export type WindowHabit = 'never' | 'occasional' | 'daily'

export interface ScenarioParams {
  ach: number
  occupants: number
  outdoorTemp: number
  outdoorRh: number
  heating: boolean
  windowHabit: WindowHabit
}

export interface ScenarioOutputs {
  indoorTemp: number
  indoorRh: number
  wallTemp: number
  dewpoint: number
  co2Night: number
  co2Day: number
  mouldRisk: number
  effAch: number
}

const HABIT_BONUS: Record<WindowHabit, number> = { never: 0, occasional: 0.15, daily: 0.45 }

/**
 * Full scenario output. The window habit raises the *effective* air-change rate
 * (matching the Flask model) so the ventilation-gewoonte control actually moves
 * every result — previously it was ignored entirely.
 */
export function scenarioOutputs(p: ScenarioParams): ScenarioOutputs {
  const indoorTemp = p.heating ? 20.5 : Math.max(p.outdoorTemp + 2.0, 14.0)
  const effAch = Math.max(p.ach + (HABIT_BONUS[p.windowHabit] ?? 0), 0.1)

  const co2Night = 420 + (18 / effAch) * p.occupants * 1.2
  const co2Day = 420 + (18 / effAch) * 0.5

  const absOut = absHumidityGkg(p.outdoorTemp, p.outdoorRh)
  const loadPct = effAch < 0.7 ? 8 : 3
  const indoorRh = Math.min(rhFromAbs(indoorTemp, absOut) + loadPct, 99)

  const wt = wallTemp(indoorTemp, p.outdoorTemp)
  const dp = dewpoint(indoorTemp, indoorRh)
  let mould: number
  if (wt < dp + 3) mould = Math.min(85, 60 + (dp + 3 - wt) * 8)
  else mould = Math.max(5, (indoorRh - 42) * 1.2)
  mould = Math.max(0, Math.min(100, mould))

  return { indoorTemp, indoorRh, wallTemp: wt, dewpoint: dp, co2Night, co2Day, mouldRisk: mould, effAch }
}

export function pctTimeCo2Above1000(co2Night: number): number {
  if (co2Night <= 700) return 0
  if (co2Night >= 1800) return 90
  return Math.max(0, Math.min(100, (co2Night - 700) / 11))
}

// Status thresholds
export function co2Status(val: number): { label: string; color: string } {
  if (val < 800) return { label: 'Goed', color: '#16A34A' }
  if (val < 1000) return { label: 'Verhoogd', color: '#D97706' }
  if (val < 1500) return { label: 'Hoog', color: '#EA580C' }
  return { label: 'Kritiek', color: '#DC2626' }
}

export function rhStatus(val: number): { label: string; color: string } {
  if (val < 40) return { label: 'Te droog', color: '#D97706' }
  if (val <= 60) return { label: 'Ideaal', color: '#16A34A' }
  if (val <= 70) return { label: 'Verhoogd', color: '#D97706' }
  return { label: 'Te hoog', color: '#DC2626' }
}

export function tempStatus(val: number): { label: string; color: string } {
  if (val < 16) return { label: 'Te koud', color: '#3B82F6' }
  if (val <= 22) return { label: 'Comfortabel', color: '#16A34A' }
  if (val <= 26) return { label: 'Warm', color: '#D97706' }
  return { label: 'Te warm', color: '#DC2626' }
}

export function mouldStatus(val: number): { label: string; color: string } {
  if (val < 30) return { label: 'Laag', color: '#16A34A' }
  if (val < 60) return { label: 'Matig', color: '#D97706' }
  return { label: 'Hoog', color: '#DC2626' }
}

// ── Wall-surface conditions (Fix 1) ──────────────────────────────────────────
// The VTT + WUFI-Bio mould models are calibrated for the *wall surface*, not
// indoor air. Feeding them indoor-air RH (40–75%) never crosses the VTT ~80%
// threshold, so risk reads 0 even in a problem dwelling. Convert indoor air +
// outdoor temperature into the colder, more humid wall-surface condition first.

// Wall thermal resistance R_totaal (m²K/W) per insulation class. Maps to Dutch
// building eras; kept in sync with the devices.insulation check constraint.
export type InsulationClass = 'poor' | 'moderate' | 'good' | 'excellent'

export const INSULATION_R: Record<InsulationClass, number> = {
  poor: 0.35, // pre-1975, no insulation
  moderate: 0.9, // 1975–2000, cavity wall
  good: 2.5, // post-2000
  excellent: 4.0, // post-2015, near-energy-neutral
}

/** R_totaal for an insulation class; falls back to the conservative 'poor' value. */
export function rTotaalForInsulation(insulation?: string | null): number {
  return INSULATION_R[(insulation as InsulationClass)] ?? INSULATION_R.poor
}

// Tetens saturation vapour pressure (hPa) at temperature T (°C).
function pSat(T: number): number {
  return 6.1078 * Math.pow(10, (7.5 * T) / (237.3 + T))
}

/**
 * Wall-surface temperature and RH from indoor air + outdoor temperature.
 *
 * @param T_binnen  - Indoor air temperature (°C)
 * @param RH_binnen - Indoor air relative humidity (%)
 * @param T_buiten  - Outdoor temperature (°C)
 * @param R_totaal  - Wall thermal resistance (m²K/W).
 *                    Default 0.35 (pre-1975, uninsulated — safest assumption).
 *                    TODO: load per dwelling/location from the backend.
 *                    Guide values:
 *                      0.35 = poor       (pre-1975, no insulation)
 *                      0.90 = moderate   (1975–2000, cavity wall)
 *                      2.50 = good       (post-2000)
 *                      4.00 = excellent  (post-2015, near-energy-neutral)
 */
export function calcWallConditions(
  T_binnen: number,
  RH_binnen: number,
  T_buiten: number,
  R_totaal: number = 0.35, // TODO: load per location from backend
): { T_wand: number; RH_wand: number } {
  const Rsi = 0.13 // ISO 6946: interior surface air-layer resistance (m²K/W)
  const T_wand = T_binnen - (T_binnen - T_buiten) * (Rsi / R_totaal)
  const RH_wand = Math.min(100, RH_binnen * (pSat(T_binnen) / pSat(T_wand)))
  return { T_wand, RH_wand }
}

// Moving average
export function movingAverage(values: number[], windowSize: number): number[] {
  if (windowSize <= 1) return values
  return values.map((_, i) => {
    const half = Math.floor(windowSize / 2)
    const start = Math.max(0, i - half)
    const end = Math.min(values.length, i + half + 1)
    const slice = values.slice(start, end)
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })
}

// Generate dashboard insight
export function generateInsight(
  co2: number[], rh: number[], mr: number[]
): { icon: string; severity: 'warn' | 'good' | 'info'; headline: string; body: string } | null {
  if (co2.length < 24) return null
  const pctCo2High = co2.filter(v => v > 1000).length / co2.length * 100
  const pctMould60 = mr.filter(v => v > 60).length / mr.length * 100
  const pctRhHigh = rh.filter(v => v > 70).length / rh.length * 100
  const gemRh = rh.reduce((a, b) => a + b, 0) / rh.length

  if (pctMould60 > 30) return {
    icon: '⚠', severity: 'warn',
    headline: 'Schimmelrisico structureel verhoogd',
    body: `Schimmelrisico stond op meer dan 60/100 gedurende ${pctMould60.toFixed(0)}% van de meetperiode.`,
  }
  if (pctCo2High > 25) return {
    icon: '💨', severity: 'warn',
    headline: 'Vaak boven de CO₂-norm',
    body: `CO₂ overschreed ${pctCo2High.toFixed(0)}% van de tijd de 1000 ppm-grens.`,
  }
  if (pctRhHigh > 15) return {
    icon: '💧', severity: 'warn',
    headline: 'Luchtvochtigheid regelmatig boven 70%',
    body: `Op ${pctRhHigh.toFixed(0)}% van de meetperiode lag de luchtvochtigheid boven 70%.`,
  }
  if (pctMould60 < 2 && pctCo2High < 5 && gemRh >= 40 && gemRh <= 60) return {
    icon: '✓', severity: 'good',
    headline: 'Alles binnen de gezonde marge',
    body: `Gemiddelde luchtvochtigheid ${gemRh.toFixed(0)}%, CO₂ ruim onder de norm, geen schimmelrisico.`,
  }
  return {
    icon: '📊', severity: 'info',
    headline: 'Stabiele meetperiode',
    body: `CO₂ overschreed de norm op ${pctCo2High.toFixed(0)}% van de tijd, gemiddelde luchtvochtigheid ${gemRh.toFixed(0)}%.`,
  }
}
