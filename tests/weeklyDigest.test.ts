import { describe, it, expect } from 'vitest'
import { buildWeeklyDigest, DigestRow } from '@/lib/weeklyDigest'

const mk = (co2: number | null, humidity: number | null, temperature = 20): DigestRow => ({
  created_at: new Date(),
  co2,
  humidity,
  temperature,
})

describe('buildWeeklyDigest', () => {
  it('reports no data honestly when there are no rows', () => {
    const d = buildWeeklyDigest([], 'Slaapkamer')
    expect(d.hasData).toBe(false)
    expect(d.stats.readings).toBe(0)
    expect(d.text).toContain('geen metingen')
    expect(d.text).toContain('Slaapkamer')
  })

  it('computes averages and percentages', () => {
    const rows = [mk(800, 50), mk(1200, 80), mk(1000, 60), mk(600, 40)]
    const d = buildWeeklyDigest(rows, 'je woning')
    expect(d.hasData).toBe(true)
    expect(d.stats.avgCo2).toBe(900) // (800+1200+1000+600)/4
    expect(d.stats.maxCo2).toBe(1200)
    expect(d.stats.pctCo2Over1000).toBe(25) // only 1200 > 1000
    expect(d.stats.avgRh).toBe(58) // (50+80+60+40)/4 = 57.5 -> 58
    expect(d.stats.pctRhOver70).toBe(25) // only 80 > 70
  })

  it('ignores null metrics without crashing', () => {
    const rows = [mk(null, null), mk(1000, 70)]
    const d = buildWeeklyDigest(rows)
    expect(d.stats.avgCo2).toBe(1000)
    expect(d.stats.avgRh).toBe(70)
    expect(d.stats.readings).toBe(2)
  })

  it('flags attention points in the headline when damp', () => {
    const rows = Array.from({ length: 10 }, () => mk(900, 75))
    const d = buildWeeklyDigest(rows)
    expect(d.subject.toLowerCase()).toContain('aandachtspunten')
  })

  it('is positive when the week looks good', () => {
    const rows = Array.from({ length: 10 }, () => mk(700, 50))
    const d = buildWeeklyDigest(rows)
    expect(d.subject.toLowerCase()).toContain('goed')
  })
})
