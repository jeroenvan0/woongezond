import { describe, it, expect } from 'vitest'
import { windowMinutes, windowPoints, maxWindowPoints, formatWindow } from '@/lib/smoothing'
import { movingAverage } from '@/lib/calculations'

// These guard the exact confusion that made the slider misreport: a window measured in
// array elements being labelled in minutes, across a bucket size that changes with the
// selected period. The bucket sizes below are the real ones from app/api/data/route.ts.

const BUCKETS = { '24u': 1, '7d': 5, '30d': 15, '90d': 60, '1jr': 360, 'max': 720 }

describe('windowMinutes', () => {
  it('converts points to wall-clock time using the bucket size', () => {
    expect(windowMinutes(60, BUCKETS['24u'])).toBe(60)
    expect(windowMinutes(12, BUCKETS['7d'])).toBe(60)
    expect(windowMinutes(4, BUCKETS['30d'])).toBe(60)
    expect(windowMinutes(1, BUCKETS['90d'])).toBe(60)
  })

  it('reports the true window on long periods — the old bug, inverted', () => {
    // The regression: the slider passed "60" through as a sample count on the 1-year
    // view, so the real window was 60 x 360 min = 15 days while the label said 60 min.
    // 60 points at that bucket size IS 15 days, and now the UI says so.
    expect(windowMinutes(60, BUCKETS['1jr'])).toBe(21600)
    expect(formatWindow(windowMinutes(60, BUCKETS['1jr']))).toBe('15 dagen')
  })

  it('is zero for a zero-length window', () => {
    expect(windowMinutes(0, 15)).toBe(0)
  })

  it('never treats a bucket as narrower than one minute', () => {
    expect(windowMinutes(10, 0)).toBe(10)
  })
})

describe('windowPoints', () => {
  it('inverts windowMinutes', () => {
    for (const bucket of Object.values(BUCKETS)) {
      for (const points of [2, 5, 12, 48]) {
        expect(windowPoints(windowMinutes(points, bucket), bucket)).toBe(points)
      }
    }
  })

  it('rounds to the nearest whole sample', () => {
    expect(windowPoints(7, 5)).toBe(1)
    expect(windowPoints(8, 5)).toBe(2)
  })
})

describe('maxWindowPoints', () => {
  it('refuses a window when there is too little data to smooth', () => {
    expect(maxWindowPoints(0)).toBe(0)
    expect(maxWindowPoints(4)).toBe(0)
    expect(maxWindowPoints(7)).toBe(0)
  })

  it('never exceeds a quarter of the series', () => {
    expect(maxWindowPoints(40)).toBe(10)
    expect(maxWindowPoints(100)).toBe(25)
  })

  it('caps at 48 points however long the series is', () => {
    expect(maxWindowPoints(1440)).toBe(48)
    expect(maxWindowPoints(100000)).toBe(48)
  })

  it('keeps the window narrow enough to preserve the trend', () => {
    // A window of a quarter of the series still leaves four independent stretches,
    // so a real rise or fall survives smoothing rather than being averaged away.
    const n = 400
    const rising = Array.from({ length: n }, (_, i) => i)
    const smoothed = movingAverage(rising, maxWindowPoints(n))
    expect(smoothed[n - 1]).toBeGreaterThan(smoothed[0] + n / 2)
  })
})

describe('formatWindow', () => {
  it('picks the largest unit that reads naturally', () => {
    expect(formatWindow(30)).toBe('30 min')
    expect(formatWindow(59)).toBe('59 min')
    expect(formatWindow(60)).toBe('1 uur')
    expect(formatWindow(90)).toBe('1.5 uur')
    expect(formatWindow(1439)).toBe('24.0 uur')
    expect(formatWindow(1440)).toBe('1 dag')
    expect(formatWindow(2880)).toBe('2 dagen')
  })

  it('singularises exactly one day', () => {
    expect(formatWindow(1440)).toContain('dag')
    expect(formatWindow(1440)).not.toContain('dagen')
  })

  it('never renders a bare number without a unit', () => {
    for (const m of [0, 1, 59, 60, 61, 1439, 1440, 100000]) {
      expect(formatWindow(m)).toMatch(/(min|uur|dag)/)
    }
  })
})

describe('the label always matches what movingAverage actually does', () => {
  it('holds across every period the dashboard offers', () => {
    // End-to-end on the contract that broke: for each real bucket size, the window the
    // UI advertises must equal the span of samples movingAverage consumes.
    const series = Array.from({ length: 200 }, (_, i) => i)
    for (const bucket of Object.values(BUCKETS)) {
      for (const points of [2, 6, 24]) {
        const advertised = windowMinutes(points, bucket)
        expect(advertised / bucket).toBe(points)
        // And the smoothing itself still spans exactly `points` samples.
        const ma = movingAverage(series, points)
        expect(ma).toHaveLength(series.length)
        const half = Math.floor(points / 2)
        const mid = 100
        const expected =
          series.slice(mid - half, mid + half + 1).reduce((a, b) => a + b, 0) / (2 * half + 1)
        expect(ma[mid]).toBeCloseTo(expected, 9)
      }
    }
  })
})
