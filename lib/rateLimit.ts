import { NextResponse } from 'next/server'
import { log } from '@/lib/logger'

// Fixed-window rate limiting, in process memory.
//
// Scope and honesty about it: the app runs as a single `next start` process under
// systemd on one VPS, so an in-memory counter is genuinely shared across all requests
// today. It is NOT durable — a deploy or restart resets every window — and it would
// NOT work if the app were ever scaled to multiple instances or containers (M5). At
// that point this needs to move to Postgres or Redis. Deliberately not doing that now:
// a dependency-free limiter that works for the 10-device pilot beats a correct
// distributed one that isn't needed yet.
//
// What it is actually protecting: /api/chat and /api/recommendations spend real money
// per call on OpenRouter, and /api/ml/retrain scans up to 200k rows. Left open, a
// signed-in user holding down a button is a billing incident.

interface Window {
  count: number
  resetAt: number
}

const buckets = new Map<string, Window>()

// Keep the map from growing without bound: sweep expired entries occasionally.
// Cheap because it only runs on a small fraction of calls.
let opsSinceSweep = 0
function maybeSweep(now: number) {
  if (++opsSinceSweep < 500) return
  opsSinceSweep = 0
  for (const [k, w] of buckets) if (w.resetAt <= now) buckets.delete(k)
}

export interface Limit {
  /** Max requests allowed inside the window. */
  max: number
  /** Window length in milliseconds. */
  windowMs: number
}

export const LIMITS = {
  // Conversational — needs to allow a real back-and-forth, not a scripted loop.
  chat: { max: 20, windowMs: 5 * 60 * 1000 },
  // One click on the scenarios page = one call. 10/5min is generous for a human.
  recommendations: { max: 10, windowMs: 5 * 60 * 1000 },
  // Expensive and rarely useful more than once an hour; the model barely moves.
  mlRetrain: { max: 3, windowMs: 60 * 60 * 1000 },
  // The bell polls every 120s = 2.5/5min. 10 leaves headroom for several open tabs.
  notifications: { max: 10, windowMs: 5 * 60 * 1000 },
  // Sensors write ~1/min. 4/min per device leaves headroom for a retry/burst without
  // letting a stuck device hammer the ingest endpoint.
  ingest: { max: 4, windowMs: 60 * 1000 },
} as const satisfies Record<string, Limit>

export interface RateResult {
  ok: boolean
  remaining: number
  retryAfterSec: number
}

/**
 * Consume one unit from `key`'s bucket. `key` should identify the *user*, not the IP —
 * every rate-limited route here is behind auth, and residents behind one household NAT
 * would otherwise share a budget.
 */
export function consume(key: string, limit: Limit): RateResult {
  const now = Date.now()
  maybeSweep(now)

  const existing = buckets.get(key)
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + limit.windowMs })
    return { ok: true, remaining: limit.max - 1, retryAfterSec: 0 }
  }

  if (existing.count >= limit.max) {
    return { ok: false, remaining: 0, retryAfterSec: Math.ceil((existing.resetAt - now) / 1000) }
  }

  existing.count++
  return { ok: true, remaining: limit.max - existing.count, retryAfterSec: 0 }
}

/**
 * Returns a 429 response when the caller is over budget, or null to continue.
 *
 *   const limited = enforce('chat', user.id, LIMITS.chat)
 *   if (limited) return limited
 */
export function enforce(scope: string, userId: string, limit: Limit): NextResponse | null {
  const r = consume(`${scope}:${userId}`, limit)
  if (r.ok) return null
  log.warn('ratelimit', 'request rejected', { scope, user_id: userId, retry_after_s: r.retryAfterSec })
  return NextResponse.json(
    { error: 'Te veel verzoeken. Probeer het over even opnieuw.', retryAfter: r.retryAfterSec },
    { status: 429, headers: { 'Retry-After': String(r.retryAfterSec) } },
  )
}

/** Test seam — resets all buckets. Not used by application code. */
export function __resetAll() {
  buckets.clear()
  opsSinceSweep = 0
}
