import { describe, it, expect } from 'vitest'
import { freshness, timeAgoNl, OFFLINE_AFTER_MIN, AGING_AFTER_MIN } from '@/lib/freshness'

const NOW = new Date('2026-08-05T14:00:00Z').getTime()
const minsAgo = (m: number) => NOW - m * 60000

describe('freshness', () => {
  it('a recent reading is fresh and may carry a status label', () => {
    const f = freshness(minsAgo(2), NOW)
    expect(f.state).toBe('fresh')
    expect(f.offline).toBe(false)
    expect(f.showStatus).toBe(true)
  })

  it('past the aging threshold it is still on but flagged aging', () => {
    const f = freshness(minsAgo(AGING_AFTER_MIN + 1), NOW)
    expect(f.state).toBe('aging')
    expect(f.showStatus).toBe(true)
  })

  it('the boundary at OFFLINE_AFTER_MIN turns the status off', () => {
    expect(freshness(minsAgo(OFFLINE_AFTER_MIN - 1), NOW).showStatus).toBe(true)
    const off = freshness(minsAgo(OFFLINE_AFTER_MIN), NOW)
    expect(off.state).toBe('offline')
    expect(off.offline).toBe(true)
    // The core guarantee: a stale reading never renders a status label.
    expect(off.showStatus).toBe(false)
  })

  it('the 56h-outage reading is offline, not green', () => {
    const f = freshness(minsAgo(56 * 60), NOW)
    expect(f.offline).toBe(true)
    expect(f.showStatus).toBe(false)
    expect(f.offlineMessage).toMatch(/offline sinds/i)
  })

  it('a missing reading is unknown/offline', () => {
    const f = freshness(null, NOW)
    expect(f.state).toBe('unknown')
    expect(f.showStatus).toBe(false)
  })

  it('timeAgoNl reads naturally', () => {
    expect(timeAgoNl(0)).toBe('zojuist')
    expect(timeAgoNl(5)).toBe('5 min geleden')
    expect(timeAgoNl(90)).toBe('1 uur geleden')
    expect(timeAgoNl(60 * 25)).toBe('1 dag geleden')
  })
})
