// Trends analytics — ported from calculations.py (compute_health_timeline,
// build_heatmap_matrix, compute_monthly_stats, compare_periods).
import { dewpoint, healthScore } from './calculations'
import { SensorRow } from './types'

// Amsterdam monthly average outdoor temperatures (°C) — seasonal correction.
const AMS_AVG_TEMP: Record<number, number> = {
  1: 3.5, 2: 4.2, 3: 7.0, 4: 10.5, 5: 14.8, 6: 17.8,
  7: 19.9, 8: 19.6, 9: 16.4, 10: 12.0, 11: 7.5, 12: 4.5,
}

export const MONTH_NL_SHORT = ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']

const clip = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Diurnal wall-delta used by the timeline/monthly mould-risk estimate. */
export function wallDelta(hours: number): number {
  return 3.5 - 2.5 * Math.sin(((hours - 14) * Math.PI) / 12)
}

/** Mould risk with explicit wall delta (Flask mould_risk(temp, rh, wd)). */
export function mouldRiskWd(temp: number, rh: number, wd: number): number {
  const dp = dewpoint(temp, rh)
  const margin = temp - wd - dp
  return clip(((5 - margin) / 8) * 100, 0, 100)
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0)

interface DayBucket {
  co2: number[]
  rh: number[]
  temp: number[]
}

function groupByDay(rows: SensorRow[]): Map<string, DayBucket> {
  const daily = new Map<string, DayBucket>()
  for (const r of rows) {
    const d = new Date(r.created_at)
    if (isNaN(d.getTime())) continue
    const key = d.toISOString().slice(0, 10)
    let b = daily.get(key)
    if (!b) {
      b = { co2: [], rh: [], temp: [] }
      daily.set(key, b)
    }
    if (r.co2 != null) b.co2.push(+r.co2)
    if (r.humidity != null) b.rh.push(+r.humidity)
    if (r.temperature != null) b.temp.push(+r.temperature)
  }
  return daily
}

export interface TimelinePoint {
  date: string // YYYY-MM-DD
  t: number // epoch ms (midnight)
  score: number
}

export function computeHealthTimeline(rows: SensorRow[]): TimelinePoint[] {
  const daily = groupByDay(rows)
  const out: TimelinePoint[] = []
  for (const key of [...daily.keys()].sort()) {
    const d = daily.get(key)!
    if (d.co2.length < 3 || !d.rh.length) continue
    const p95 = percentile([...d.co2].sort((a, b) => a - b), 95)
    const avgRh = mean(d.rh)
    const avgTemp = d.temp.length ? mean(d.temp) : 19.0
    const mr = clip(mouldRiskWd(avgTemp, avgRh, wallDelta(12.0)), 0, 100)
    out.push({ date: key, t: new Date(key).getTime(), score: healthScore(p95, avgRh, mr) })
  }
  return out
}

/** Centered rolling mean with edge-corrected windows (matches Flask convolve fix). */
export function rollingMean(scores: number[], window = 7): number[] {
  const n = scores.length
  const w = Math.min(window, n)
  const half = Math.floor(w / 2)
  return scores.map((_, i) => {
    const start = Math.max(0, i - half)
    const end = Math.min(n, i + half + 1)
    return mean(scores.slice(start, end))
  })
}

export interface MonthlyStat {
  year: number
  month: number
  label: string
  healthScore: number
  co2Avg: number
  rhAvg: number
  mrAvg: number
  estOutTemp: number
}

export function computeMonthlyStats(rows: SensorRow[]): MonthlyStat[] {
  const daily = groupByDay(rows)
  const monthly = new Map<string, { scores: number[]; co2: number[]; rh: number[]; mr: number[]; y: number; m: number }>()
  for (const [key, d] of daily) {
    if (d.co2.length < 3 || !d.rh.length) continue
    const p95 = percentile([...d.co2].sort((a, b) => a - b), 95)
    const avgRh = mean(d.rh)
    const avgTemp = d.temp.length ? mean(d.temp) : 19.0
    const mr = clip(mouldRiskWd(avgTemp, avgRh, wallDelta(12.0)), 0, 100)
    const [y, m] = [+key.slice(0, 4), +key.slice(5, 7)]
    const mk = `${y}-${m}`
    let bucket = monthly.get(mk)
    if (!bucket) {
      bucket = { scores: [], co2: [], rh: [], mr: [], y, m }
      monthly.set(mk, bucket)
    }
    bucket.scores.push(healthScore(p95, avgRh, mr))
    bucket.co2.push(mean(d.co2))
    bucket.rh.push(avgRh)
    bucket.mr.push(mr)
  }
  return [...monthly.values()]
    .sort((a, b) => a.y - b.y || a.m - b.m)
    .filter((b) => b.scores.length)
    .map((b) => ({
      year: b.y,
      month: b.m,
      label: `${MONTH_NL_SHORT[b.m - 1]} '${String(b.y).slice(2)}`,
      healthScore: Math.round(mean(b.scores)),
      co2Avg: +mean(b.co2).toFixed(1),
      rhAvg: +mean(b.rh).toFixed(1),
      mrAvg: +mean(b.mr).toFixed(1),
      estOutTemp: AMS_AVG_TEMP[b.m] ?? 10.0,
    }))
}

export type HeatmapMetric = 'co2' | 'humidity' | 'temperature'

export interface HeatmapResult {
  months: number[] // 0-based month indices with data
  matrix: (number | null)[][] // [monthRow][hour]
}

export function buildHeatmapMatrix(rows: SensorRow[], metric: HeatmapMetric): HeatmapResult {
  const cells = new Map<string, number[]>()
  for (const r of rows) {
    const d = new Date(r.created_at)
    if (isNaN(d.getTime())) continue
    const val = r[metric] as number | null
    if (val == null) continue
    const key = `${d.getMonth()}-${d.getHours()}`
    const arr = cells.get(key) ?? []
    arr.push(+val)
    cells.set(key, arr)
  }
  const full: (number | null)[][] = Array.from({ length: 12 }, () => Array(24).fill(null))
  for (const [key, vals] of cells) {
    if (vals.length < 2) continue
    const [mo, hr] = key.split('-').map(Number)
    full[mo][hr] = mean(vals)
  }
  const months = full.map((row, i) => [i, row.some((v) => v != null)] as const).filter(([, has]) => has).map(([i]) => i)
  return { months, matrix: months.map((m) => full[m]) }
}

// ── Period comparison with seasonal correction ────────────────────────────

export interface PeriodStats {
  score: number
  co2Avg: number
  co2P95: number
  rhAvg: number
  mrAvg: number
  indoorTemp: number
  estOutTemp: number
  nReadings: number
}

export interface CompareResult {
  a: PeriodStats
  b: PeriodStats
  scoreACorr: number
  scoreBCorr: number
  mrACorr: number
  tempDiff: number
  fairness: 'fair' | 'caution' | 'poor'
  fairnessMsg: string
  rawDelta: number
  corrDelta: number
  seasonalShare: number
}

function periodStats(rows: SensorRow[], start: string, end: string): PeriodStats | null {
  const inRange = rows.filter((r) => {
    const day = r.created_at.slice(0, 10)
    return day >= start && day <= end
  })
  const co2 = inRange.filter((r) => r.co2 != null).map((r) => +r.co2!)
  const rh = inRange.filter((r) => r.humidity != null).map((r) => +r.humidity!)
  const temp = inRange.filter((r) => r.temperature != null).map((r) => +r.temperature!)
  if (!co2.length || !rh.length) return null
  const avgRh = mean(rh)
  const avgTemp = temp.length ? mean(temp) : 19.0
  const p95 = percentile([...co2].sort((a, b) => a - b), 95)
  const mr = clip(mouldRiskWd(avgTemp, avgRh, wallDelta(12.0)), 0, 100)
  const months = inRange
    .map((r) => new Date(r.created_at).getMonth() + 1)
    .filter((m) => !isNaN(m))
  const estOut = months.length ? mean(months.map((m) => AMS_AVG_TEMP[m] ?? 10.0)) : 10.0
  return {
    score: healthScore(p95, avgRh, mr),
    co2Avg: +mean(co2).toFixed(1),
    co2P95: +p95.toFixed(1),
    rhAvg: +avgRh.toFixed(1),
    mrAvg: +mr.toFixed(1),
    indoorTemp: +avgTemp.toFixed(1),
    estOutTemp: +estOut.toFixed(1),
    nReadings: co2.length,
  }
}

export function comparePeriods(
  rows: SensorRow[],
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): CompareResult | null {
  const a = periodStats(rows, startA, endA)
  const b = periodStats(rows, startB, endB)
  if (!a || !b) return null

  const CORR_PER_DEG = 2.0
  const tempDiff = a.estOutTemp - b.estOutTemp
  const mrACorr = clip(a.mrAvg + tempDiff * CORR_PER_DEG, 0, 100)
  const scoreACorr = healthScore(a.co2P95, a.rhAvg, mrACorr)
  const scoreBCorr = b.score

  const diffAbs = Math.abs(tempDiff)
  let fairness: 'fair' | 'caution' | 'poor'
  let fairnessMsg: string
  if (diffAbs < 2) {
    fairness = 'fair'
    fairnessMsg = 'Vergelijkbare buitentemperatuur — directe vergelijking is betrouwbaar.'
  } else if (diffAbs < 5) {
    fairness = 'caution'
    fairnessMsg = `Buitentemperatuur verschilt ~${diffAbs.toFixed(0)}°C — seizoenscorrectie aanbevolen.`
  } else {
    fairness = 'poor'
    fairnessMsg = `Groot temperatuurverschil (${diffAbs.toFixed(0)}°C) — de gecorrigeerde score is betrouwbaarder dan de ruwe score.`
  }

  const rawDelta = b.score - a.score
  const corrDelta = scoreBCorr - scoreACorr
  return {
    a,
    b,
    scoreACorr,
    scoreBCorr,
    mrACorr: +mrACorr.toFixed(1),
    tempDiff: +tempDiff.toFixed(1),
    fairness,
    fairnessMsg,
    rawDelta,
    corrDelta,
    seasonalShare: Math.round(rawDelta - corrDelta),
  }
}

/** Before/after window comparison around an intervention date. */
export interface BeforeAfter {
  co2Before: number
  co2After: number
  rhBefore: number
  rhAfter: number
  scoreBefore: number | null
  scoreAfter: number | null
}

export function beforeAfter(rows: SensorRow[], dateStr: string, windowDays = 14): BeforeAfter | null {
  if (!rows.length || !dateStr) return null
  const iv = new Date(dateStr)
  if (isNaN(iv.getTime())) return null
  const beforeStart = new Date(iv.getTime() - windowDays * 86400000)
  const afterEnd = new Date(iv.getTime() + windowDays * 86400000)
  const bCo2: number[] = [], bRh: number[] = [], aCo2: number[] = [], aRh: number[] = []
  for (const r of rows) {
    const d = new Date(r.created_at)
    if (isNaN(d.getTime()) || r.co2 == null || r.humidity == null) continue
    if (d >= beforeStart && d < iv) {
      bCo2.push(+r.co2)
      bRh.push(+r.humidity)
    } else if (d >= iv && d <= afterEnd) {
      aCo2.push(+r.co2)
      aRh.push(+r.humidity)
    }
  }
  if (!bCo2.length || !aCo2.length) return null
  const score = (co2: number[], rh: number[]): number | null => {
    if (!co2.length || !rh.length) return null
    const avgRh = mean(rh)
    const p95 = percentile([...co2].sort((x, y) => x - y), 95)
    const mr = clip(mouldRiskWd(19.0, avgRh, wallDelta(12.0)), 0, 100)
    return healthScore(p95, avgRh, mr)
  }
  return {
    co2Before: +mean(bCo2).toFixed(1),
    co2After: +mean(aCo2).toFixed(1),
    rhBefore: +mean(bRh).toFixed(1),
    rhAfter: +mean(aRh).toFixed(1),
    scoreBefore: score(bCo2, bRh),
    scoreAfter: score(aCo2, aRh),
  }
}
