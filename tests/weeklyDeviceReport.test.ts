import { describe, it, expect } from 'vitest'
import { buildWeeklyDeviceReport } from '@/lib/report/weeklyDeviceReport'
import { SensorRow } from '@/lib/types'

const period = { start: new Date('2026-08-31T00:00:00+02:00'), end: new Date('2026-09-07T00:00:00+02:00') }
const device = { number: 1, room: 'slaapkamer', profile: { room: 'slaapkamer', occupants: '2', ventilation: 'raam', laundry_indoors: 'soms', moisture: 'condens' } }

/** n minutes of readings, one per minute, from `from`. */
function minutes(from: string, n: number, co2: (i: number) => number, rh = 55, temp = 21): SensorRow[] {
  const t0 = new Date(from).getTime()
  return Array.from({ length: n }, (_, i) => ({ created_at: new Date(t0 + i * 60000).toISOString(), co2: co2(i), humidity: rh, temperature: temp }))
}

describe('buildWeeklyDeviceReport', () => {
  it('says honestly that there is no report without data', () => {
    const r = buildWeeklyDeviceReport([], device, { name: 'Jeroen v Oostendorp' }, period)
    expect(r.hasData).toBe(false)
    expect(r.verdict).toBe('nodata')
    expect(r.subject).toContain('geen metingen')
    expect(r.text).toContain('Hoi Jeroen,')
    expect(r.text).toContain('sensor 01')
    expect(r.html).toContain('geen weekrapport')
  })

  it('reports a well-ventilated week as ok, with the keep-it-up tip', () => {
    const rows = minutes('2026-09-01T00:00:00+02:00', 3 * 1440, () => 600, 50)
    const r = buildWeeklyDeviceReport(rows, device, { name: null }, period)
    expect(r.hasData).toBe(true)
    expect(r.verdict).toBe('ok')
    expect(r.stats.avgCo2).toBe(600)
    expect(r.text).toContain('Hallo,')
    expect(r.tips[0].severity).toBe('ok')
    expect(r.tips).toHaveLength(1)
  })

  it('flags high night-time CO₂ and adds the two-sleepers profile tip', () => {
    // 23:00–07:00 at 1300 ppm, daytime 700 ppm, three full days.
    const rows = minutes('2026-09-01T00:00:00+02:00', 3 * 1440, (i) => { const h = Math.floor((i % 1440) / 60); return h >= 23 || h < 7 ? 1700 : 700 }, 62)
    const r = buildWeeklyDeviceReport(rows, device, { name: 'Fam. Jansen' }, period)
    expect(r.verdict).toBe('critical')
    expect(r.text).toContain('Hallo,')                 // "Fam. Jansen" is not a first name
    expect(r.stats.nightCo2).toBeGreaterThan(1000)
    expect(r.tips.some((t) => t.title.includes("’s nachts") || t.title.includes("'s nachts"))).toBe(true)
    expect(r.tips.some((t) => t.title.includes('personen in de slaapkamer'))).toBe(true)
    expect(r.tips.length).toBeLessThanOrEqual(4)
  })

  it('discloses gaps and low coverage instead of hiding them', () => {
    const rows = [...minutes('2026-09-01T20:00:00+02:00', 600, () => 900), ...minutes('2026-09-06T10:00:00+02:00', 60, () => 950)]
    const r = buildWeeklyDeviceReport(rows, device, { name: null }, period)
    expect(r.stats.gaps).toBe(1)
    expect(r.text).toContain('Geen metingen van')
    expect(r.text).toContain('Minder dan de helft van de week gemeten')
    expect(r.stats.hoursCovered).toBeLessThan(84)
  })
})
