'use client'
import { CSSProperties } from 'react'

/** A single shimmering placeholder block (5.3). */
export function Skeleton({ w = '100%', h = 12, r = 'var(--r-sm)', style }: { w?: number | string; h?: number | string; r?: number | string; style?: CSSProperties }) {
  return <span className="wz-skeleton" style={{ display: 'block', width: w, height: h, borderRadius: r, ...style }} aria-hidden />
}

/**
 * A KPI card placeholder shaped like the real MetricCard, so nothing shifts when the
 * value lands (values used to snap from "—" to a number while the charts disagreed).
 */
export function MetricCardSkeleton() {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '14px 15px', boxShadow: 'var(--shadow-xs)', display: 'flex', flexDirection: 'column', minHeight: 104, gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Skeleton w={22} h={22} r={7} />
        <Skeleton w={56} h={9} />
      </div>
      <Skeleton w={70} h={24} />
      <Skeleton w={44} h={10} />
      <Skeleton w="100%" h={4} r={2} style={{ marginTop: 'auto' }} />
    </div>
  )
}

/** A chart-height placeholder. */
export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '14px 16px', boxShadow: 'var(--shadow-xs)', marginBottom: 12 }}>
      <Skeleton w={120} h={10} style={{ marginBottom: 12 }} />
      <Skeleton w="100%" h={height} r="var(--r-md)" />
    </div>
  )
}
