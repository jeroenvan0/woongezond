// Measurement-continuity + gap analysis. An unbroken record strengthens the
// evidential value of the data, and openly disclosing gaps (rather than drawing
// a line straight through them) makes the report harder to dispute.
import { SensorRow } from './types'

export interface Coverage {
  days: number // distinct calendar days with data
  spanDays: number // calendar span first→last
  longestStreak: number // longest run of consecutive days
  currentStreak: number // consecutive days ending at the most recent day
  coveragePct: number // actual readings vs expected (from the median interval)
}

export interface Gap {
  startMs: number
  endMs: number
  hours: number
}

const dayStr = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const dayToMs = (s: string) => new Date(s + 'T00:00:00').getTime()

function sortedTimestamps(rows: SensorRow[]): number[] {
  return rows
    .map((r) => new Date(r.created_at).getTime())
    .filter((t) => !isNaN(t))
    .sort((a, b) => a - b)
}

export function measurementCoverage(rows: SensorRow[]): Coverage | null {
  const ts = sortedTimestamps(rows)
  if (ts.length < 2) return null

  const days = [...new Set(ts.map(dayStr))].sort()
  let longest = 1,
    run = 1
  for (let i = 1; i < days.length; i++) {
    const gap = Math.round((dayToMs(days[i]) - dayToMs(days[i - 1])) / 86400000)
    run = gap === 1 ? run + 1 : 1
    longest = Math.max(longest, run)
  }
  let current = 1
  for (let i = days.length - 1; i > 0; i--) {
    const gap = Math.round((dayToMs(days[i]) - dayToMs(days[i - 1])) / 86400000)
    if (gap === 1) current++
    else break
  }

  const spanMs = ts[ts.length - 1] - ts[0]
  const spanDays = Math.max(1, Math.round(spanMs / 86400000))
  const deltas: number[] = []
  for (let i = 1; i < ts.length; i++) deltas.push(ts[i] - ts[i - 1])
  const med = [...deltas].sort((a, b) => a - b)[Math.floor(deltas.length / 2)] || 60000
  const expected = med > 0 ? spanMs / med : ts.length
  const coveragePct = Math.max(0, Math.min(100, Math.round((ts.length / expected) * 100)))

  return { days: days.length, spanDays, longestStreak: longest, currentStreak: current, coveragePct }
}

/** Periods where the sensor was offline (gap > factor × the typical interval and > 1h). */
export function detectGaps(rows: SensorRow[], factor = 4): Gap[] {
  const ts = sortedTimestamps(rows)
  if (ts.length < 3) return []
  const deltas: number[] = []
  for (let i = 1; i < ts.length; i++) deltas.push(ts[i] - ts[i - 1])
  const med = [...deltas].sort((a, b) => a - b)[Math.floor(deltas.length / 2)] || 0
  if (med <= 0) return []
  const gaps: Gap[] = []
  for (let i = 1; i < ts.length; i++) {
    const d = ts[i] - ts[i - 1]
    if (d > factor * med && d > 3600000) gaps.push({ startMs: ts[i - 1], endMs: ts[i], hours: +(d / 3600000).toFixed(1) })
  }
  return gaps
}
