'use client'
import { useState, useEffect, useCallback } from 'react'
import { withBase } from '@/lib/basePath'
import { DataError, describeError } from '@/components/DataBanner'

// One data path for /api/data (G1/G2). Every caller — the dashboard, the night/ML/
// continuity cards, trends, schimmel — went through its own fetch, so a single mount
// fired several overlapping requests and navigating between pages re-downloaded
// everything. This adds:
//   • a short-TTL response cache keyed by the requested window (minutes), so repeat
//     requests for the same window are served from memory (dedupe + cross-page reuse);
//   • in-flight de-duplication, so two components asking for the same window at the
//     same time share one network request;
//   • visibility-gated polling (5.2): a hidden tab makes no traffic, and a tab refetches
//     when it regains focus.

export interface SeriesData {
  rows: any[]
  bucketMinutes: number
}

const TTL_MS = 55_000 // just under the 60s poll, so a poll always gets fresh data
const cache = new Map<number, { data: SeriesData; ts: number }>()
const inflight = new Map<number, Promise<SeriesData>>()

async function fetchSeries(minutes: number): Promise<SeriesData> {
  const r = await fetch(withBase(`/api/data?minutes=${minutes}`))
  if (!r.ok) {
    const e = new Error(`HTTP ${r.status}`) as Error & { status?: number }
    e.status = r.status
    throw e
  }
  const d = await r.json()
  return { rows: d.rows ?? [], bucketMinutes: d.bucketMinutes > 0 ? d.bucketMinutes : 1 }
}

export function getSeries(minutes: number, force = false): Promise<SeriesData> {
  const now = Date.now()
  const cached = cache.get(minutes)
  if (!force && cached && now - cached.ts < TTL_MS) return Promise.resolve(cached.data)
  const existing = inflight.get(minutes)
  if (!force && existing) return existing
  const p = fetchSeries(minutes)
    .then((data) => {
      cache.set(minutes, { data, ts: Date.now() })
      inflight.delete(minutes)
      return data
    })
    .catch((e) => {
      inflight.delete(minutes)
      throw e
    })
  inflight.set(minutes, p)
  return p
}

interface Options {
  /** Poll every 60s while the tab is visible. */
  poll?: boolean
  /** Skip fetching entirely (e.g. before auth resolves). */
  enabled?: boolean
}

export function useSeries(minutes: number, opts: Options = {}) {
  const { poll = false, enabled = true } = opts
  const [data, setData] = useState<SeriesData>({ rows: [], bucketMinutes: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<DataError>(null)

  const run = useCallback(
    async (force = false) => {
      if (!enabled) return
      try {
        const d = await getSeries(minutes, force)
        setData(d)
        setError(null)
      } catch (e) {
        const status = (e as { status?: number })?.status
        setError(describeError(status, status == null))
      } finally {
        setLoading(false)
      }
    },
    [minutes, enabled],
  )

  useEffect(() => {
    if (!enabled) return
    setLoading(true)
    run()
    if (!poll) return
    let id: ReturnType<typeof setInterval> | null = null
    const start = () => {
      stop()
      id = setInterval(() => {
        if (document.visibilityState === 'visible') run(true)
      }, 60000)
    }
    const stop = () => {
      if (id) clearInterval(id)
      id = null
    }
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        run(true) // refetch on focus
        start()
      } else stop()
    }
    start()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [run, poll, enabled])

  return { rows: data.rows, bucketMinutes: data.bucketMinutes, loading, error, refetch: () => run(true) }
}
