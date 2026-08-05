import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { consume, LIMITS, __resetAll } from '@/lib/rateLimit'

// The limiter guards routes that spend money per call (OpenRouter) and one that scans
// 200k rows. Its failure modes are asymmetric: too loose is a billing incident, too
// tight locks a resident out of their own dashboard. Both directions are asserted.

describe('consume', () => {
  beforeEach(() => __resetAll())
  afterEach(() => vi.useRealTimers())

  const limit = { max: 3, windowMs: 60_000 }

  it('allows exactly `max` requests, then refuses', () => {
    expect(consume('u1', limit).ok).toBe(true)
    expect(consume('u1', limit).ok).toBe(true)
    expect(consume('u1', limit).ok).toBe(true)
    expect(consume('u1', limit).ok).toBe(false)
  })

  it('counts down `remaining` accurately', () => {
    expect(consume('u1', limit).remaining).toBe(2)
    expect(consume('u1', limit).remaining).toBe(1)
    expect(consume('u1', limit).remaining).toBe(0)
  })

  it('keys are independent — one user cannot exhaust another"s budget', () => {
    for (let i = 0; i < 3; i++) consume('u1', limit)
    expect(consume('u1', limit).ok).toBe(false)
    expect(consume('u2', limit).ok).toBe(true)
  })

  it('reports a positive Retry-After when it refuses', () => {
    for (let i = 0; i < 3; i++) consume('u1', limit)
    const r = consume('u1', limit)
    expect(r.ok).toBe(false)
    expect(r.retryAfterSec).toBeGreaterThan(0)
    expect(r.retryAfterSec).toBeLessThanOrEqual(60)
  })

  it('lets the caller back in once the window rolls over', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-05T12:00:00Z'))
    for (let i = 0; i < 3; i++) consume('u1', limit)
    expect(consume('u1', limit).ok).toBe(false)

    vi.setSystemTime(new Date('2026-08-05T12:01:01Z'))
    expect(consume('u1', limit).ok).toBe(true)
  })
})

describe('configured limits', () => {
  beforeEach(() => __resetAll())

  it('leaves room for NotificationBell"s 120s poll across several open tabs', () => {
    // The bell fires ~2.5 times per 5 min per tab. Three tabs must not self-limit.
    const perWindow = Math.ceil(LIMITS.notifications.windowMs / 120_000) * 3
    expect(LIMITS.notifications.max).toBeGreaterThanOrEqual(perWindow)
  })

  it('keeps the paid endpoints meaningfully bounded', () => {
    expect(LIMITS.chat.max).toBeLessThanOrEqual(30)
    expect(LIMITS.recommendations.max).toBeLessThanOrEqual(20)
    // Retrain is the 200k-row scan; it should be the tightest of the lot.
    expect(LIMITS.mlRetrain.max).toBeLessThan(LIMITS.chat.max)
  })

  it('allows a genuine chat conversation without tripping', () => {
    for (let i = 0; i < 15; i++) {
      expect(consume('chat:u1', LIMITS.chat).ok).toBe(true)
    }
  })
})
