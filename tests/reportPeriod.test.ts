import { describe, it, expect } from 'vitest'
import { lastFullWeek, rollingWeek, zonedMidnight } from '@/lib/report/period'
import { issueReportToken, verifyReportToken } from '@/lib/report/token'

describe('lastFullWeek (Europe/Amsterdam)', () => {
  it('on a Monday morning returns the previous Mon 00:00 → this Mon 00:00', () => {
    const now = new Date('2026-09-07T06:00:00Z') // maandag 08:00 CEST
    const p = lastFullWeek(now)
    expect(p.startKey).toBe('2026-08-31')
    expect(p.endKey).toBe('2026-09-06')
    expect(p.start.toISOString()).toBe('2026-08-30T22:00:00.000Z') // ma 31 aug 00:00 CEST
    expect(p.end.toISOString()).toBe('2026-09-06T22:00:00.000Z')
  })
  it('on a Sunday still reports the week before (not the running one)', () => {
    const p = lastFullWeek(new Date('2026-09-06T12:00:00Z'))
    expect(p.startKey).toBe('2026-08-24')
    expect(p.endKey).toBe('2026-08-30')
  })
  it('handles the switch to winter time: the week has 169 hours', () => {
    const p = lastFullWeek(new Date('2026-10-26T08:00:00Z')) // maandag na de wissel (25 okt)
    expect(p.startKey).toBe('2026-10-19')
    expect(p.start.toISOString()).toBe('2026-10-18T22:00:00.000Z') // CEST
    expect(p.end.toISOString()).toBe('2026-10-25T23:00:00.000Z')   // CET
    expect((p.end.getTime() - p.start.getTime()) / 3600000).toBe(169)
  })
  it('handles the switch to summer time: 167 hours', () => {
    const p = lastFullWeek(new Date('2026-03-30T08:00:00Z'))
    expect((p.end.getTime() - p.start.getTime()) / 3600000).toBe(167)
  })
  it('zonedMidnight is local midnight, also in January', () => {
    expect(zonedMidnight({ y: 2026, m: 1, d: 15 }).toISOString()).toBe('2026-01-14T23:00:00.000Z')
  })
  it('rollingWeek spans the last 7 days up to now', () => {
    const now = new Date('2026-09-06T12:00:00Z')
    const p = rollingWeek(now)
    expect(p.startKey).toBe('2026-08-30')
    expect(p.end).toBe(now)
  })
})

describe('report token', () => {
  process.env.PILOT_SESSION_SECRET = 'test-secret'   // pilotKey() reads it lazily
  const id = '3f1380c9-1bba-4738-9d78-416910819a92'
  it('round-trips and is bound to the device', () => {
    const { token } = issueReportToken(id)
    expect(token.startsWith('wgr_')).toBe(true)
    expect(verifyReportToken(token)?.deviceId).toBe(id)
  })
  it('expires and rejects tampering and wizard tokens', () => {
    const { token } = issueReportToken(id, Date.now(), 60)
    expect(verifyReportToken(token, Date.now() + 61_000)).toBeNull()
    expect(verifyReportToken(token.slice(0, -2) + 'xx')).toBeNull()
    expect(verifyReportToken('wgs_' + token.slice(4))).toBeNull()
    expect(verifyReportToken(undefined)).toBeNull()
  })
})

import { lastFullDay, lastFullMonth, periodFor, rollingFor, isDue } from '@/lib/report/period'

describe('frequency periods', () => {
  const tue = new Date('2026-09-08T06:00:00Z')   // dinsdag 8 sep 08:00 CEST
  const mon = new Date('2026-09-07T06:00:00Z')   // maandag
  const first = new Date('2026-10-01T06:00:00Z') // 1 oktober
  it('daily = yesterday, due every day', () => {
    const p = lastFullDay(tue)
    expect(p.startKey).toBe('2026-09-07'); expect(p.endKey).toBe('2026-09-07')
    expect(p.start.toISOString()).toBe('2026-09-06T22:00:00.000Z')
    expect(isDue('daily', tue)).toBe(true)
  })
  it('weekly is due on Monday only', () => {
    expect(isDue('weekly', mon)).toBe(true)
    expect(isDue('weekly', tue)).toBe(false)
    expect(periodFor('weekly', mon).startKey).toBe('2026-08-31')
  })
  it('monthly = previous calendar month, due on the 1st', () => {
    const p = lastFullMonth(first)
    expect(p.startKey).toBe('2026-09-01'); expect(p.endKey).toBe('2026-09-30')
    expect(isDue('monthly', first)).toBe(true)
    expect(isDue('monthly', tue)).toBe(false)
    expect(lastFullMonth(new Date('2026-01-05T12:00:00Z')).startKey).toBe('2025-12-01')
  })
  it('rolling windows are 1 / 7 / 30 days', () => {
    expect(rollingFor('daily', tue).startKey).toBe('2026-09-07')
    expect(rollingFor('weekly', tue).startKey).toBe('2026-09-01')
    expect(rollingFor('monthly', tue).startKey).toBe('2026-08-09')
  })
})
