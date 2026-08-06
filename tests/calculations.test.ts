import { describe, it, expect } from 'vitest'
import {
  dewpoint,
  wallTemp,
  mouldRisk,
  healthScore,
  healthLabel,
  absHumidityGkg,
  rhFromAbs,
  movingAverage,
  co2Status,
  rhStatus,
} from '@/lib/calculations'

// These are the functions the report engine draws its conclusions from, and
// CALCULATIONS.md frames those conclusions as carrying evidentiary weight. The tests
// therefore assert *physical* properties (invariants, known reference points,
// monotonicity) rather than re-stating the implementation — a test that just repeats
// the formula would pass even if the formula were wrong.

describe('dewpoint', () => {
  it('equals the air temperature at 100% RH', () => {
    // Definitional: saturated air is already at its dew point.
    for (const t of [-5, 0, 10, 20, 30]) {
      expect(dewpoint(t, 100)).toBeCloseTo(t, 6)
    }
  })

  it('matches published Magnus values', () => {
    // Reference points from standard psychrometric tables (±0.1 °C).
    expect(dewpoint(20, 50)).toBeCloseTo(9.3, 1)
    expect(dewpoint(25, 60)).toBeCloseTo(16.7, 1)
    expect(dewpoint(30, 80)).toBeCloseTo(26.2, 1)
  })

  it('is always at or below the air temperature', () => {
    for (const t of [0, 5, 15, 22, 35]) {
      for (const rh of [10, 35, 60, 90, 100]) {
        expect(dewpoint(t, rh)).toBeLessThanOrEqual(t + 1e-9)
      }
    }
  })

  it('rises monotonically with RH at fixed temperature', () => {
    let prev = -Infinity
    for (const rh of [10, 20, 40, 60, 80, 100]) {
      const dp = dewpoint(20, rh)
      expect(dp).toBeGreaterThan(prev)
      prev = dp
    }
  })

  it('clamps RH into 1–100 rather than returning NaN', () => {
    // log(0) would be -Infinity; the clamp is load-bearing for bad sensor data.
    expect(Number.isFinite(dewpoint(20, 0))).toBe(true)
    expect(Number.isFinite(dewpoint(20, -50))).toBe(true)
    expect(dewpoint(20, 150)).toBeCloseTo(dewpoint(20, 100), 9)
  })
})

describe('wallTemp', () => {
  it('sits between outdoor and indoor temperature', () => {
    const w = wallTemp(21, 5)
    expect(w).toBeGreaterThan(5)
    expect(w).toBeLessThan(21)
  })

  it('equals indoor temperature when outdoor matches it', () => {
    expect(wallTemp(20, 20)).toBeCloseTo(20, 9)
  })
})

describe('mouldRisk', () => {
  it('stays within 0–100 across the plausible indoor envelope', () => {
    for (let t = 5; t <= 30; t += 2.5) {
      for (let rh = 20; rh <= 100; rh += 5) {
        const r = mouldRisk(t, rh)
        expect(r).toBeGreaterThanOrEqual(0)
        expect(r).toBeLessThanOrEqual(100)
      }
    }
  })

  it('increases with humidity at a fixed temperature', () => {
    // The whole premise of the product: wetter air, more risk.
    let prev = -1
    for (const rh of [40, 50, 60, 70, 80, 90]) {
      const r = mouldRisk(20, rh)
      expect(r).toBeGreaterThanOrEqual(prev)
      prev = r
    }
  })

  it('increases as the wall gets colder relative to the room', () => {
    expect(mouldRisk(20, 65, 6)).toBeGreaterThan(mouldRisk(20, 65, 2))
  })

  it('is zero for dry air and maximal when the wall is below the dew point', () => {
    expect(mouldRisk(20, 30)).toBe(0)
    expect(mouldRisk(20, 100)).toBe(100)
  })
})

describe('healthScore', () => {
  it('returns 100 only when all three inputs are in their best band', () => {
    expect(healthScore(600, 50, 10)).toBe(100)
  })

  it('returns the weighted floor when everything is bad', () => {
    // 0.4*10 + 0.3*10 + 0.3*5 = 8.5 → 9 after rounding.
    expect(healthScore(2000, 90, 95)).toBe(9)
  })

  it('never leaves 0–100', () => {
    for (const co2 of [300, 900, 1100, 5000]) {
      for (const rh of [5, 35, 50, 68, 99]) {
        for (const mr of [0, 45, 70, 100]) {
          const s = healthScore(co2, rh, mr)
          expect(s).toBeGreaterThanOrEqual(0)
          expect(s).toBeLessThanOrEqual(100)
        }
      }
    }
  })

  it('does not improve when CO2 gets worse, all else equal', () => {
    let prev = Infinity
    for (const co2 of [700, 900, 1100, 1500]) {
      const s = healthScore(co2, 50, 10)
      expect(s).toBeLessThanOrEqual(prev)
      prev = s
    }
  })

  it('weights CO2 most heavily, per the documented 0.4/0.3/0.3 split', () => {
    const base = healthScore(600, 50, 10)
    const co2Degraded = base - healthScore(1300, 50, 10)
    const rhDegraded = base - healthScore(600, 15, 10)
    expect(co2Degraded).toBeGreaterThan(rhDegraded)
  })
})

describe('healthLabel', () => {
  it('changes label exactly at the documented boundaries', () => {
    expect(healthLabel(85).label).toBe('Uitstekend')
    expect(healthLabel(84).label).toBe('Goed')
    expect(healthLabel(65).label).toBe('Goed')
    expect(healthLabel(64).label).toBe('Matig')
    expect(healthLabel(40).label).toBe('Matig')
    expect(healthLabel(39).label).toBe('Slecht')
  })
})

describe('absHumidityGkg / rhFromAbs', () => {
  it('round-trips at constant temperature', () => {
    // The scenario engine converts RH → absolute → RH when mixing air at different
    // temperatures. If this pair does not invert, every scenario result is off.
    for (const t of [5, 15, 20, 25]) {
      for (const rh of [20, 40, 60, 80]) {
        expect(rhFromAbs(t, absHumidityGkg(t, rh))).toBeCloseTo(rh, 4)
      }
    }
  })

  it('gives colder air a lower moisture capacity at equal RH', () => {
    // Why ventilating in winter dries a room out — the core mechanism the app explains.
    expect(absHumidityGkg(5, 80)).toBeLessThan(absHumidityGkg(20, 80))
  })

  it('caps RH at 99 rather than reporting supersaturation', () => {
    expect(rhFromAbs(5, absHumidityGkg(25, 95))).toBeLessThanOrEqual(99)
  })
})

describe('movingAverage', () => {
  // Behaviour pinned deliberately: docs/known-issues.md KI-1 is about the *caller*
  // treating this window as minutes. The window is in SAMPLES. These tests exist so
  // that when KI-1 is fixed, any change of meaning here fails loudly.
  const series = [10, 20, 30, 40, 50]

  it('returns the input unchanged for a window of 1 or less', () => {
    expect(movingAverage(series, 1)).toEqual(series)
    expect(movingAverage(series, 0)).toEqual(series)
  })

  it('preserves array length', () => {
    expect(movingAverage(series, 3)).toHaveLength(series.length)
  })

  it('is a CENTRED window, not trailing', () => {
    // Index 2 of a 3-wide centred window averages indices 1..3 → 30, not 10..30 → 20.
    expect(movingAverage(series, 3)[2]).toBeCloseTo(30, 9)
  })

  it('truncates the window at the edges, so the last point is a partial average', () => {
    // This is precisely why KI-1b matters: the "current" value the KPI cards read is
    // an average of the trailing half-window, not of a full one.
    const ma = movingAverage(series, 5)
    expect(ma[4]).toBeCloseTo((30 + 40 + 50) / 3, 9)
    expect(ma[0]).toBeCloseTo((10 + 20 + 30) / 3, 9)
  })

  it('leaves a constant series untouched', () => {
    expect(movingAverage([7, 7, 7, 7], 3)).toEqual([7, 7, 7, 7])
  })

  it('flattens spikes — the property that makes it misleading for headline values', () => {
    const spiky = [100, 100, 900, 100, 100]
    expect(movingAverage(spiky, 3)[2]).toBeLessThan(900)
  })
})

describe('status bands', () => {
  it('classifies CO2 at the thresholds the UI draws reference lines at', () => {
    expect(co2Status(999).label).not.toBe(co2Status(1600).label)
    expect(co2Status(400).label).toBeTruthy()
  })

  it('returns a label and a colour for every plausible RH', () => {
    for (const rh of [10, 45, 62, 72, 95]) {
      const s = rhStatus(rh)
      expect(s.label).toBeTruthy()
      // Colours are theme tokens now (var(--ok/--warn/--crit)), not literals.
      expect(s.color).toMatch(/^var\(--[a-z]+\)$/)
    }
  })
})
