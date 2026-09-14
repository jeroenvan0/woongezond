import { describe, it, expect } from 'vitest'
import {
  analyseVentilation, detectEvents, linearFit, tQuantile975, bucketReadings, occupantsFromProfile,
  type Reading, type OutdoorReading,
} from '@/lib/ventilationEvents'

const MIN = 60_000
// Een vaste winteravond (UTC 18:00 = 19:00 Amsterdam), zodat dag/nacht-labels deterministisch zijn.
const T0 = Date.UTC(2026, 0, 12, 18, 0, 0)

/** Minuutreeks uit een functie van minuten → {co2, t, rh}. */
function series(minutes: number, f: (m: number) => { co2: number; t?: number; rh?: number }, start = T0): Reading[] {
  const out: Reading[] = []
  for (let m = 0; m < minutes; m++) {
    const v = f(m)
    out.push({ ts: start + m * MIN, co2: v.co2, t: v.t ?? 20, rh: v.rh ?? 50 })
  }
  return out
}

/** Exponentiële daling van c0 naar de nullijn met tijdconstante tau (min) vanaf minuut m0. */
const decay = (c0: number, floor: number, tau: number, m0: number) => (m: number) =>
  m < m0 ? c0 : floor + (c0 - floor) * Math.exp(-(m - m0) / tau)

// Vaste pseudo-ruis zodat de test reproduceerbaar is.
function noise(seed: number, amp: number) {
  let s = seed
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return ((s / 0x7fffffff) - 0.5) * 2 * amp }
}

describe('statistiek', () => {
  it('t-kwantiel loopt af naar 1,96', () => {
    expect(tQuantile975(1)).toBeCloseTo(12.71, 1)
    expect(tQuantile975(10)).toBeCloseTo(2.23, 1)
    expect(tQuantile975(12)).toBeGreaterThan(2.13)
    expect(tQuantile975(12)).toBeLessThan(2.23)
    expect(tQuantile975(1e6)).toBe(1.96)
  })

  it('lineaire fit geeft helling, R² en standaardfout', () => {
    const f = linearFit([0, 1, 2, 3, 4], [1, 3, 5, 7, 9])!
    expect(f.slope).toBeCloseTo(2)
    expect(f.intercept).toBeCloseTo(1)
    expect(f.r2).toBeCloseTo(1)
    expect(f.se).toBeCloseTo(0)
    expect(linearFit([1, 1, 1], [1, 2, 3])).toBeNull()
  })

  it('bucketing middelt per 5 minuten en laat rijen zonder CO₂ weg', () => {
    const b = bucketReadings([
      { ts: T0, co2: 600, t: 20, rh: 50 }, { ts: T0 + MIN, co2: 620, t: 20, rh: 50 },
      { ts: T0 + 2 * MIN, co2: null, t: 20, rh: 50 }, { ts: T0 + 6 * MIN, co2: 700, t: 21, rh: 40 },
    ])
    expect(b).toHaveLength(2)
    expect(b[0].co2).toBe(610)
    expect(b[0].n).toBe(2)
    expect(b[1].v).toBeGreaterThan(0)
  })
})

describe('luchtmoment', () => {
  it('vindt een steile daling en het interval bevat de echte luchtwisseling', () => {
    // 1400 → 450 ppm met τ = 12 min (ACH 5/h), 2 uur stabiel ervoor, wat ruis.
    const n = noise(7, 12)
    const rs = series(240, (m) => ({ co2: decay(1400, 450, 12, 120)(m) + n(), t: m < 120 ? 20 : m < 135 ? 20 - (m - 120) * 0.08 : Math.min(20, 18.8 + (m - 135) * 0.03) }))
    const { events, co2Floor } = detectEvents(rs, { outdoor: [{ ts: T0, t: 4, rh: 85 }, { ts: T0 + 240 * MIN, t: 4, rh: 85 }] })
    expect(co2Floor).toBeGreaterThan(430)
    expect(co2Floor).toBeLessThan(480)
    const lucht = events.filter((e) => e.kind === 'luchten')
    expect(lucht).toHaveLength(1)
    const e = lucht[0]
    expect(e.ach).toBeGreaterThan(3)
    expect(e.ach).toBeLessThan(7.5)
    expect(e.achCI!.lo).toBeLessThanOrEqual(5)
    expect(e.achCI!.hi).toBeGreaterThanOrEqual(5)
    expect(e.achCI!.lo).toBeGreaterThan(1)
    expect(e.tempDrop).toBeGreaterThan(0.5)
    expect(e.confidence).toBeGreaterThan(0.75)
    expect(e.evidence.join(' ')).toMatch(/koud buitenweer/)
    expect(e.evidence.join(' ')).toMatch(/buitenniveau/)
  })

  it('zonder temperatuurdip bij koud weer daalt de zekerheid', () => {
    const rs = series(240, (m) => ({ co2: decay(1400, 450, 12, 120)(m) }))
    const cold: OutdoorReading[] = [{ ts: T0, t: 2, rh: 85 }, { ts: T0 + 240 * MIN, t: 2, rh: 85 }]
    const withCold = detectEvents(rs, { outdoor: cold }).events.find((e) => e.kind === 'luchten')!
    const noWeather = detectEvents(rs).events.find((e) => e.kind === 'luchten')!
    expect(withCold.confidence).toBeLessThan(noWeather.confidence)
    expect(withCold.evidence.join(' ')).toMatch(/geen temperatuurdip/)
  })

  it('een kleine daling geeft minder zekerheid en een breder interval dan een grote', () => {
    const n = noise(3, 20)
    const small = detectEvents(series(200, (m) => ({ co2: decay(760, 450, 20, 100)(m) + n() }))).events.filter((e) => e.kind === 'luchten')
    const big = detectEvents(series(200, (m) => ({ co2: decay(1600, 450, 20, 100)(m) + n() }))).events.filter((e) => e.kind === 'luchten')
    expect(small).toHaveLength(1)
    expect(big).toHaveLength(1)
    expect(small[0].confidence).toBeLessThan(big[0].confidence)
    expect(small[0].evidence.join(' ')).toMatch(/kleine daling/)
    const width = (e: { achCI: { lo: number; hi: number } | null }) => e.achCI!.hi - e.achCI!.lo
    expect(width(small[0])).toBeGreaterThan(width(big[0]))
  })

  it('een daling die afvlakt boven het buitenniveau wijst op een deur, niet een raam', () => {
    // 1300 → 800 ppm (τ 10) en dan vlak: de lucht komt uit de rest van het huis.
    const rs = series(300, (m) => ({ co2: m < 120 ? 1300 : Math.max(800, 800 + 500 * Math.exp(-(m - 120) / 10)), }))
    // Nullijn komt uit een eerder stuk op 450.
    const withFloor = [...series(120, () => ({ co2: 450 }), T0 - 200 * MIN), ...rs]
    const e = detectEvents(withFloor).events.find((x) => x.kind === 'luchten')!
    expect(e).toBeTruthy()
    expect(e.evidence.join(' ')).toMatch(/deur/)
  })
})

describe('achtergrond, bezetting en vochtpiek', () => {
  it('een trage daling van uren is achtergrondwisseling, geen luchten', () => {
    // Bron weg om 19:00: 1100 → 450 met τ = 150 min (ACH 0,4/h).
    const n = noise(11, 8)
    const rs = series(6 * 60, (m) => ({ co2: decay(1100, 450, 150, 30)(m) + n() }))
    const { events } = detectEvents(rs)
    expect(events.filter((e) => e.kind === 'luchten')).toHaveLength(0)
    const bg = events.filter((e) => e.kind === 'achtergrond')
    expect(bg.length).toBeGreaterThanOrEqual(1)
    const e = bg[0]
    expect(e.ach).toBeGreaterThan(0.3)
    expect(e.ach).toBeLessThan(0.5)
    // Het interval dekt de nullijn-onzekerheid (±30 ppm), dus de echte 0,4 valt erin.
    expect(e.achCI!.lo).toBeLessThanOrEqual(0.4)
    expect(e.achCI!.hi).toBeGreaterThanOrEqual(0.4)
    expect(e.minutes).toBeGreaterThanOrEqual(45)
  })

  it('een gestage stijging is bezetting', () => {
    const rs = series(180, (m) => ({ co2: m < 60 ? 500 : 500 + (m - 60) * 8 }))
    const { events } = detectEvents(rs)
    const bez = events.filter((e) => e.kind === 'bezetting')
    expect(bez).toHaveLength(1)
    expect(bez[0].co2Drop).toBeLessThan(-200)
    expect(bez[0].confidence).toBeGreaterThan(0.6)
  })

  it('vocht omhoog zonder CO₂-verandering is een vochtpiek', () => {
    // RV 45 → 75 % bij 20 °C in 20 minuten (≈ +5 g/m³), CO₂ vlak.
    const rs = series(120, (m) => ({ co2: 600, rh: m < 40 ? 45 : Math.min(75, 45 + (m - 40) * 1.5) }))
    const { events } = detectEvents(rs)
    const vp = events.filter((e) => e.kind === 'vochtpiek')
    expect(vp).toHaveLength(1)
    expect(vp[0].vRise).toBeGreaterThan(3)
    expect(events.filter((e) => e.kind === 'luchten')).toHaveLength(0)
  })

  it('een vlakke, ruizige reeks geeft geen momenten', () => {
    const n = noise(5, 25)
    const rs = series(300, () => ({ co2: 650 + n() }))
    expect(detectEvents(rs).events).toHaveLength(0)
  })
})

describe('dagsamenvatting', () => {
  it('telt luchtmomenten per dag en schat de nachtwisseling uit het plateau', () => {
    // 24 uur vanaf 19:00: bezetting 23:00, plateau ~1050 ppm, luchten 07:00 (τ 10), overdag laag.
    const f = (m: number) => {
      if (m < 240) return 500                                   // 19–23
      if (m < 300) return 500 + (m - 240) * 9                    // stijging naar ~1040
      if (m < 720) return 1050                                   // 00–07 plateau
      if (m < 800) return 450 + 600 * Math.exp(-(m - 720) / 10)  // 07:00 luchten
      return 450
    }
    const rs = series(24 * 60, (m) => ({ co2: f(m) }))
    const a = analyseVentilation(rs, { occupantsNight: 2, room: 'slaapkamer' })
    expect(a.assumptions).toEqual({ room: 'slaapkamer', volumeM3: 30, occupantsNight: 2 })
    const day2 = a.days.find((d) => d.date === '2026-01-13')!
    expect(day2.luchtmomenten).toBe(1)
    expect(day2.minutenGelucht).toBeGreaterThan(10)
    expect(day2.nachtCo2).toBe(1050)
    // 2 slapers × 10 L/h in 30 m³ bij ΔC ≈ 600 ppm → n ≈ 1,1/h, ±50 %.
    expect(day2.nachtAch!.ach).toBeGreaterThan(0.9)
    expect(day2.nachtAch!.ach).toBeLessThan(1.3)
    expect(day2.nachtAch!.lo).toBeLessThan(day2.nachtAch!.ach)
    expect(day2.nachtAch!.hi).toBeGreaterThan(day2.nachtAch!.ach)
    // Zonder slapers geen nachtschatting.
    const b = analyseVentilation(rs, { occupantsNight: null })
    expect(b.days.find((d) => d.date === '2026-01-13')!.nachtAch).toBeNull()
  })

  it('onbekende kamer valt terug op de slaapkamer (alle pilotsensoren hangen daar)', () => {
    const a = analyseVentilation(series(60, () => ({ co2: 500 })), { room: 'zolder' })
    expect(a.assumptions.room).toBe('slaapkamer')
    expect(occupantsFromProfile('4+')).toBe(4)
    expect(occupantsFromProfile(undefined)).toBeNull()
  })
})
