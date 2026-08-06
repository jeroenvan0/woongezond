import { describe, it, expect } from 'vitest'
import {
  rhCrit,
  vttStep,
  wufiStep,
  gpToSer,
  woonScore,
  runModels,
  MATERIAL_K2,
} from '@/lib/mouldModels'

// VTT Mould Index (Hukka & Viitanen 1999) + WUFI-Bio. These drive the
// /schimmelrisico page and the report's mould conclusions, so the properties that
// matter are the model's documented invariants: bounded output, no growth below the
// critical RH, decline when conditions improve, and material ordering.

describe('rhCrit', () => {
  it('never drops below the VTT floor of 80%', () => {
    for (let t = -10; t <= 50; t += 2) {
      expect(rhCrit(t)).toBeGreaterThanOrEqual(80)
    }
  })

  it('sits essentially at the 80% floor for normal room temperatures', () => {
    // The polynomial bottoms out just above the floor in the 18–27 °C band
    // (80.04 at 20 °C, 80.03 at 25 °C) rather than being clamped by the Math.max.
    expect(rhCrit(20)).toBeCloseTo(80, 1)
    expect(rhCrit(25)).toBeCloseTo(80, 1)
  })

  it('demands higher humidity for growth as it gets colder', () => {
    // Cold surfaces need to be wetter before mould starts — the curve above the floor.
    expect(rhCrit(2)).toBeGreaterThan(rhCrit(15))
  })
})

describe('vttStep', () => {
  it('does not grow below the critical RH', () => {
    expect(vttStep(20, 70, 0, 24)).toBe(0)
  })

  it('grows above the critical RH', () => {
    expect(vttStep(20, 95, 0, 24)).toBeGreaterThan(0)
  })

  it('never leaves the documented 0–6 index range', () => {
    let m = 0
    // A year of continuously saturated, warm conditions — the worst case there is.
    for (let i = 0; i < 365 * 24; i++) m = vttStep(22, 100, m, 1)
    expect(m).toBeGreaterThan(0)
    expect(m).toBeLessThanOrEqual(6)
  })

  it('declines when conditions improve, and never below zero', () => {
    let m = 3
    const after = vttStep(20, 50, m, 24)
    expect(after).toBeLessThan(m)

    m = 0.01
    for (let i = 0; i < 100; i++) m = vttStep(20, 50, m, 24)
    expect(m).toBeGreaterThanOrEqual(0)
  })

  it('grows faster on unprotected wood than on treated surfaces', () => {
    // The k2 material ordering is what the material-class selector on the page means.
    const wood = vttStep(22, 95, 0, 24, MATERIAL_K2.wood)
    const gypsum = vttStep(22, 95, 0, 24, MATERIAL_K2.gypsum)
    const treated = vttStep(22, 95, 0, 24, MATERIAL_K2.treated)
    expect(wood).toBeGreaterThan(gypsum)
    expect(gypsum).toBeGreaterThan(treated)
  })

  it('grows more in a longer timestep', () => {
    expect(vttStep(22, 95, 0, 24)).toBeGreaterThan(vttStep(22, 95, 0, 1))
  })

  it('treats temperatures outside 0–50 °C as non-growing', () => {
    expect(vttStep(-5, 100, 1, 24)).toBeLessThan(1)
    expect(vttStep(60, 100, 1, 24)).toBeLessThan(1)
  })
})

describe('wufiStep', () => {
  it('accumulates growth potential above the critical water activity', () => {
    expect(wufiStep(20, 95, 0, 24)).toBeGreaterThan(0)
  })

  it('decays below it, and never below zero', () => {
    expect(wufiStep(20, 40, 10, 24)).toBeLessThan(10)
    expect(wufiStep(20, 40, 0, 24)).toBe(0)
  })

  it('does not grow outside 0–40 °C', () => {
    expect(wufiStep(50, 100, 5, 24)).toBeLessThan(5)
  })
})

describe('gpToSer', () => {
  it('caps at 100', () => {
    expect(gpToSer(1000)).toBe(100)
    expect(gpToSer(50)).toBe(100)
  })

  it('is zero at zero and monotonic below the cap', () => {
    expect(gpToSer(0)).toBe(0)
    expect(gpToSer(25)).toBeGreaterThan(gpToSer(10))
  })
})

describe('woonScore', () => {
  it('spans 0–100 for in-range inputs', () => {
    expect(woonScore(0, 0)).toBeCloseTo(0, 9)
    expect(woonScore(6, 100)).toBeCloseTo(100, 9)
  })

  it('weights the mould index above the emission rate (0.6 / 0.4)', () => {
    expect(woonScore(6, 0)).toBeGreaterThan(woonScore(0, 100))
  })
})

describe('runModels', () => {
  const hours = (n: number) => Array.from({ length: n }, (_, i) => Date.UTC(2026, 0, 1) + i * 3600_000)

  it('returns one point per input sample', () => {
    const ts = hours(48)
    const r = runModels(ts, ts.map(() => 20), ts.map(() => 55))
    expect(r.mi).toHaveLength(48)
    expect(r.ser).toHaveLength(48)
    expect(r.woonScore).toHaveLength(48)
  })

  it('stays flat at zero through dry conditions', () => {
    const ts = hours(72)
    const r = runModels(ts, ts.map(() => 21), ts.map(() => 45))
    expect(Math.max(...r.mi)).toBe(0)
    expect(Math.max(...r.woonScore)).toBe(0)
  })

  it('produces a rising index through sustained damp conditions', () => {
    const ts = hours(240)
    const r = runModels(ts, ts.map(() => 22), ts.map(() => 92))
    expect(r.mi[r.mi.length - 1]).toBeGreaterThan(r.mi[0])
    expect(Math.max(...r.mi)).toBeLessThanOrEqual(6)
  })

  it('handles an empty series without throwing', () => {
    const r = runModels([], [], [])
    expect(r.mi).toEqual([])
  })
})
