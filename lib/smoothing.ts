// Helpers for the dashboard's smoothing control.
//
// The subtlety this exists to contain: /api/data returns a series already bucketed by
// period (1 min for ≤2 days, up to 720 min beyond a year) and reports the bucket size
// as `bucketMinutes`. lib/calculations.ts::movingAverage takes a window in ARRAY
// ELEMENTS. So a control labelled in minutes has to divide by the bucket size, and a
// control valued in points has to multiply to describe itself.
//
// Getting this backwards is not a cosmetic bug: the slider used to pass its minute
// value straight through as a sample count, so "60 min" on the 1-year view actually
// smoothed over 15 days. See docs/known-issues.md KI-1.

/** Wall-clock minutes covered by a window of `points` samples. */
export function windowMinutes(points: number, bucketMinutes: number): number {
  return Math.max(0, points) * Math.max(1, bucketMinutes)
}

/** Samples needed to cover `minutes` of wall-clock time. Inverse of windowMinutes. */
export function windowPoints(minutes: number, bucketMinutes: number): number {
  return Math.round(Math.max(0, minutes) / Math.max(1, bucketMinutes))
}

/**
 * Largest smoothing window we allow, in samples.
 *
 * Capped at a quarter of the series so smoothing can never flatten the trend the user
 * opened the chart to see, and at 48 points so the label stays in a sane range.
 * Returns 0 when there is too little data for a window to mean anything.
 */
export function maxWindowPoints(seriesLength: number): number {
  const quarter = Math.floor(seriesLength / 4)
  return quarter < 2 ? 0 : Math.min(48, quarter)
}

/** A duration in minutes, in the largest unit that reads naturally (Dutch). */
export function formatWindow(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`
  if (minutes < 1440) {
    const h = minutes / 60
    return `${Number.isInteger(h) ? h : h.toFixed(1)} uur`
  }
  const d = minutes / 1440
  return `${Number.isInteger(d) ? d : d.toFixed(1)} ${d === 1 ? 'dag' : 'dagen'}`
}
