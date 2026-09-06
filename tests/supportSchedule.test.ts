import { describe, it, expect } from 'vitest'
import { scheduledSendAt } from '@/lib/support/schedule'

describe('scheduledSendAt', () => {
  it('adds the delay during the day', () => {
    expect(scheduledSendAt(new Date('2026-09-06T12:31:00Z'), 120).toISOString()).toBe('2026-09-06T14:31:00.000Z') // 16:31 CEST
  })
  it('pushes late-evening mail to 08:00 next morning', () => {
    expect(scheduledSendAt(new Date('2026-09-06T19:30:00Z'), 120).toISOString()).toBe('2026-09-07T06:00:00.000Z') // 21:30 CEST + 2h = 23:30 → 08:00
  })
  it('pushes night mail to 08:00 the same morning', () => {
    expect(scheduledSendAt(new Date('2026-09-07T01:00:00Z'), 120).toISOString()).toBe('2026-09-07T06:00:00.000Z') // 03:00 → 05:00 → 08:00
  })
  it('handles the month boundary', () => {
    expect(scheduledSendAt(new Date('2026-09-30T20:00:00Z'), 120).toISOString()).toBe('2026-10-01T06:00:00.000Z')
  })
})
