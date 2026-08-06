'use client'
import { withBase } from '@/lib/basePath'

// Single notification-check owner per browser (5.5 — the client half of KI-4).
//
// Before this, every open tab POSTed /api/notifications/check every 120s, so three
// tabs meant three sweeps racing to insert the same alert and three times the load on
// the new rate limiter. Now exactly one tab holds a Web Lock and runs the sweep; after
// each sweep it broadcasts on a BroadcastChannel so every tab reloads its list. When
// the leader tab closes, its lock releases and another tab takes over automatically.
//
// Falls back to per-tab polling only where the Web Locks API is unavailable.

const SWEEP_MS = 120_000

export function startNotificationSweeps(onChanged: () => void): () => void {
  let stopped = false
  const chan = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('wz-notif') : null
  if (chan) chan.onmessage = () => onChanged()

  const stopFns: Array<() => void> = []

  const sweep = async () => {
    try {
      await fetch(withBase('/api/notifications/check'), { method: 'POST' })
    } catch {
      /* a failed sweep is not user-facing here */
    }
    onChanged()
    chan?.postMessage('changed')
  }

  const runAsLeader = () =>
    new Promise<void>((resolve) => {
      if (stopped) return resolve()
      sweep()
      const id = setInterval(() => {
        if (document.visibilityState === 'visible') sweep()
      }, SWEEP_MS)
      // Holding this promise open holds the lock; resolving it releases leadership.
      stopFns.push(() => {
        clearInterval(id)
        resolve()
      })
    })

  const locks = (navigator as Navigator & { locks?: LockManager }).locks
  if (locks?.request) {
    const ac = new AbortController()
    stopFns.push(() => ac.abort())
    locks.request('wz-notif-sweep', { signal: ac.signal }, runAsLeader).catch(() => {})
  } else {
    sweep()
    const id = setInterval(sweep, SWEEP_MS)
    stopFns.push(() => clearInterval(id))
  }

  return () => {
    stopped = true
    stopFns.forEach((f) => f())
    chan?.close()
  }
}
