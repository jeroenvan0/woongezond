import { describe, it, expect } from 'vitest'
import { pickBucketSeconds, windowBucketSeconds, aggregateRows, spanSeconds } from '@/lib/bucketing'

// De klacht die dit oploste: "1 jaar" met drie dagen data gaf twee punten. De data die er
// echt is moet de blokgrootte kiezen; een vol venster moet dezelfde ladder geven als vroeger.

describe('pickBucketSeconds', () => {
  it('geeft bij een vol venster precies de oude ladder', () => {
    for (const m of [30, 60, 360, 1440, 4320, 10080, 43200, 129600, 525600, 2 * 525600]) {
      expect(pickBucketSeconds(m, m * 60)).toBe(windowBucketSeconds(m))
    }
  })

  it('wordt fijner als er maar een beetje data in een lange periode zit', () => {
    expect(pickBucketSeconds(525600, 3 * 86400)).toBe(300)    // jaar gevraagd, 3 dagen data → 5 min
    expect(pickBucketSeconds(525600, 6 * 3600)).toBe(60)      // jaar gevraagd, 6 uur data → 1 min
    expect(pickBucketSeconds(43200, 2 * 86400)).toBe(300)     // 30 dagen gevraagd, 2 dagen data → 5 min
  })

  it('wordt nooit grover dan het plafond van de periode', () => {
    expect(pickBucketSeconds(1440, 365 * 86400)).toBe(120)
    expect(pickBucketSeconds(30, 30 * 60)).toBe(60)
  })

  it('valt terug op het fijnste blok bij geen of één meting', () => {
    expect(pickBucketSeconds(525600, null)).toBe(60)
    expect(pickBucketSeconds(525600, 0)).toBe(60)
  })
})

describe('aggregateRows', () => {
  const t0 = Date.UTC(2026, 8, 14, 10, 0, 0)
  const row = (offsetSec: number, co2: number, temperature = 20, humidity = 50) =>
    ({ created_at: new Date(t0 + offsetSec * 1000).toISOString(), co2, temperature, humidity })

  it('bewaart per blok gemiddelde, laagste en hoogste', () => {
    const out = aggregateRows([row(0, 400), row(60, 1200), row(120, 800), row(700, 500)], 600)
    expect(out).toHaveLength(2)
    expect(out[0].co2).toBe(800)
    expect(out[0].co2_min).toBe(400)
    expect(out[0].co2_max).toBe(1200)
    expect(out[0].n).toBe(3)
    expect(out[1].co2).toBe(500)
    expect(out[1].co2_min).toBe(500)
    expect(out[1].co2_max).toBe(500)
  })

  it('sorteert op tijd en zet de bloktijd op het begin van het blok', () => {
    const out = aggregateRows([row(700, 1), row(0, 2)], 600)
    expect(new Date(out[0].created_at).getTime()).toBe(t0)
    expect(new Date(out[1].created_at).getTime()).toBe(t0 + 600_000)
  })

  it('negeert null-waarden zonder een blok te verliezen', () => {
    const out = aggregateRows([{ created_at: new Date(t0).toISOString(), co2: null, temperature: 21, humidity: null }], 60)
    expect(out[0].co2).toBeNull()
    expect(out[0].temperature).toBe(21)
  })
})

describe('spanSeconds', () => {
  it('null bij minder dan twee rijen, anders eerste t/m laatste', () => {
    expect(spanSeconds([])).toBeNull()
    expect(spanSeconds([{ created_at: '2026-09-14T10:00:00Z' }])).toBeNull()
    expect(spanSeconds([{ created_at: '2026-09-14T10:00:00Z' }, { created_at: '2026-09-14T09:00:00Z' }])).toBe(3600)
  })
})
