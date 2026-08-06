'use client'
import { CSSProperties, ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Left accent bar colour (any CSS colour / token). */
  accent?: string
  pad?: number | string
  radius?: number | string
  style?: CSSProperties
  className?: string
}

/**
 * The single card surface. Consolidates the surface+border+radius+shadow block
 * that was inline-duplicated across every screen (MetricCard 16px, ChartCard 14px,
 * report 12px, login 20px) onto one --r-lg default so radii stop drifting.
 */
export default function Card({ children, accent, pad = 'var(--sp-4)', radius = 'var(--r-lg)', style, className }: Props) {
  return (
    <div
      className={className}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: accent ? `3px solid ${accent}` : '1px solid var(--border)',
        borderRadius: radius,
        padding: pad,
        boxShadow: 'var(--shadow-xs)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}
