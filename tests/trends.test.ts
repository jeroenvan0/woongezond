import { describe, it, expect } from 'vitest'
import { wallDelta, mouldRiskWd, rollingMean, computeHealthTimeline } from '@/lib/trends'
import type { SensorRow } from '@/lib/types'

// Trends analytics behind /trends: the daily health timeline, its 7-day rolling
// average, and the diurnal wall-delta model underneath the mould estimate.

describe('wallDelta', () => {
  it('oscillates around 3.5 with a 2.5 amplitude', () => {
    for (let h = 0; h < 24; h += 0.5) {
      const d = wallDelta(h)
      expect(d).toBeGreaterThanOrEqual(1.0 - 1e-9)
      expect(d).toBeLessThanOrEqual(6.0 + 1e-9)
    }
  })

  it('peaks in the early morning and troughs in the evening', () => {
    // 3.5 - 2.5·sin((h-14)·π/12): the extremes land at 08:00 and 20:00, with the
    // mean at 14:00. Walls are furthest below room temperature at 08:00, after a
    // night of losing heat — which is when condensation risk is highest.
    expect(wallDelta(8)).toBeCloseTo(6.0, 6)
    expect(wallDelta(14)).toBeCloseTo(3.5, 6)
    expect(wallDelta(20)).toBeCloseTo(1.0, 6)
  })

  it('is periodic over 24 hours', () => {
    expect(wallDelta(3)).toBeCloseTo(wallDelta(27), 9)
  })
})

describe('mouldRiskWd', () => {
  it('is bounded to 0–100', () => {
    for (let t = 5; t <= 30; t += 5) {
      for (let rh = 20; rh <= 100; rh += 10) {
        const r = mouldRiskWd(t, rh, 3.5)
        expect(r).toBeGreaterThanOrEqual(0)
        expect(r).toBeLessThanOrEqual(100)
      }
    }
  })

  it('rises with a colder wall', () => {
    expect(mouldRiskWd(20, 70, 6)).toBeGreaterThan(mouldRiskWd(20, 70, 1))
  })
})

describe('rollingMean', () => {
  it('preserves length', () => {
    expect(rollingMean([1, 2, 3, 4, 5], 3)).toHaveLength(5)
  })

  it('leaves a constant series unchanged', () => {
    expect(rollingMean([5, 5, 5, 5, 5], 3)).toEqual([5, 5, 5, 5, 5])
  })

  it('shrinks the window rather than dropping points when the series is short', () => {
    // A new household with 3 days of data must still get a timeline, not an empty chart.
    const r = rollingMean([10, 20, 30], 7)
    expect(r).toHaveLength(3)
    expect(r.every((v) => Number.isFinite(v))).toBe(true)
    expect(r[1]).toBeCloseTo(20, 9)
  })

  it('smooths a single outlier without erasing the level', () => {
    const r = rollingMean([50, 50, 100, 50, 50], 3)
    expect(r[2]).toBeLessThan(100)
    expect(r[2]).toBeGreaterThan(50)
  })

  it('returns an empty array for empty input', () => {
    expect(rollingMean([], 7)).toEqual([])
  })
})

describe('computeHealthTimeline', () => {
  const row = (iso: string, co2: number, temp: number, humidity: number): SensorRow =>
    ({ created_at: iso, co2, temperature: temp, humidity }) as SensorRow

  it('emits one point per day that has enough readings', () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => row(`2026-03-0${i < 3 ? 1 : 2}T0${i}:00:00Z`, 700, 20, 50)),
    ]
    const tl = computeHealthTimeline(rows)
    expect(tl.length).toBeGreaterThan(0)
    expect(new Set(tl.map((p) => p.date)).size).toBe(tl.length)
  })

  it('skips days with fewer than three CO2 readings rather than inventing a score', () => {
    // A day where the sensor was offline must not produce a confident-looking point.
    const rows = [row('2026-03-01T01:00:00Z', 700, 20, 50), row('2026-03-01T02:00:00Z', 700, 20, 50)]
    expect(computeHealthTimeline(rows)).toEqual([])
  })

  it('scores a clean day above a stuffy, damp one', () => {
    const clean = Array.from({ length: 6 }, (_, i) => row(`2026-03-01T0${i}:00:00Z`, 600, 20, 50))
    const bad = Array.from({ length: 6 }, (_, i) => row(`2026-03-02T0${i}:00:00Z`, 1600, 19, 85))
    const tl = computeHealthTimeline([...clean, ...bad])
    expect(tl).toHaveLength(2)
    expect(tl[0].score).toBeGreaterThan(tl[1].score)
  })

  it('returns points in chronological order', () => {
    const rows = [
      ...Array.from({ length: 4 }, (_, i) => row(`2026-03-05T0${i}:00:00Z`, 700, 20, 50)),
      ...Array.from({ length: 4 }, (_, i) => row(`2026-03-01T0${i}:00:00Z`, 700, 20, 50)),
    ]
    const tl = computeHealthTimeline(rows)
    expect(tl.map((p) => p.t)).toEqual([...tl.map((p) => p.t)].sort((a, b) => a - b))
  })

  it('handles empty input', () => {
    expect(computeHealthTimeline([])).toEqual([])
  })
})
