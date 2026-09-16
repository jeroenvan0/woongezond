import { describe, it, expect } from 'vitest'
import { dayNight, dayPart, tooltipLabel } from '@/components/chartAxis'

const H = 3_600_000
const ams = (t: number) => new Date(t).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', weekday: 'short', hour: '2-digit', minute: '2-digit' })

describe('dag en nacht in tijdgrafieken', () => {
  it('3 dagen: nachten van 23:00 tot 07:00 Amsterdamse tijd, middernacht met weekdag en datum', () => {
    const t0 = Date.parse('2026-09-13T10:00:00Z'), t1 = Date.parse('2026-09-16T10:00:00Z')
    const dn = dayNight(t0, t1)!
    expect(dn.nights).toHaveLength(3)
    for (const [s, e] of dn.nights) {
      expect(ams(s)).toMatch(/23:00/)
      expect(ams(e)).toMatch(/07:00/)
    }
    expect(dn.midnights.map((m) => m.label)).toEqual(['ma 14 sep', 'di 15 sep', 'wo 16 sep'])
    for (const m of dn.midnights) expect(ams(m.t)).toMatch(/00:00/)
  })

  it('knipt een nacht die al bezig is af op het venster', () => {
    const t0 = Date.parse('2026-09-16T01:00:00Z') // 03:00 in Amsterdam
    const dn = dayNight(t0, t0 + 12 * H)!
    expect(dn.nights[0][0]).toBe(t0)
    expect(ams(dn.nights[0][1])).toMatch(/07:00/)
  })

  it('klopt ook over de overgang naar wintertijd', () => {
    const dn = dayNight(Date.parse('2026-10-24T12:00:00Z'), Date.parse('2026-10-26T12:00:00Z'))!
    for (const [s, e] of dn.nights) { expect(ams(s)).toMatch(/23:00/); expect(ams(e)).toMatch(/07:00/) }
    for (const m of dn.midnights) expect(ams(m.t)).toMatch(/00:00/)
  })

  it('langer dan 8 dagen geen labels, langer dan 15 dagen niets', () => {
    const t0 = Date.parse('2026-09-01T00:00:00Z')
    expect(dayNight(t0, t0 + 10 * 24 * H)!.midnights.every((m) => m.label === null)).toBe(true)
    expect(dayNight(t0, t0 + 30 * 24 * H)).toBeNull()
  })

  it('dagdeel in de tooltip alleen op verzoek', () => {
    const t = Date.parse('2026-09-16T01:28:00Z') // 03:28
    expect(dayPart(t)).toBe('nacht')
    expect(dayPart(Date.parse('2026-09-16T11:40:00Z'))).toBe('middag')
    expect(tooltipLabel(t)).not.toMatch(/nacht/)
    expect(tooltipLabel(t, true)).toMatch(/· nacht$/)
  })
})
