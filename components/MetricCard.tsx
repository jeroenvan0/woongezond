'use client'
import { ReactNode } from 'react'

interface Props {
  title: string
  value: string | number
  unit: string
  label?: string
  labelColor?: string
  sub?: string
  subColor?: string
  accent?: string
  progress?: number
  icon?: ReactNode
  /** Reading is too old to be trusted as current — desaturate it (A1). */
  stale?: boolean
}

export default function MetricCard({ title, value, unit, label, labelColor, sub, subColor, accent = 'var(--accent)', progress, icon, stale }: Props) {
  // color-mix keeps the tint working whether `accent` is a token or a literal —
  // the old `${accent}1a` hex-concat breaks the moment accent is a var().
  const tint = `color-mix(in srgb, ${accent} 12%, transparent)`
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        padding: '14px 15px',
        boxShadow: 'var(--shadow-xs)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 104,
        // A stale reading is desaturated so it reads as "not current" at a glance,
        // while the number stays legible for reference.
        filter: stale ? 'saturate(0.25)' : undefined,
        opacity: stale ? 0.7 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
        {icon && (
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 7, color: accent, background: tint, flexShrink: 0 }}>
            {icon}
          </span>
        )}
        <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 'clamp(21px,4.4vw,26px)', fontWeight: 700, color: 'var(--text)', lineHeight: 1, letterSpacing: '-0.025em', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        {unit && <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', fontWeight: 500 }}>{unit}</span>}
      </div>

      {label && <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: labelColor, marginTop: 5 }}>{label}</div>}
      {sub && <div style={{ fontSize: 'var(--fs-xs)', color: subColor ?? 'var(--subtle)', fontWeight: subColor ? 500 : 400, marginTop: label ? 1 : 4 }}>{sub}</div>}

      {/* Progress track always reserved at the bottom → every card is the same height */}
      <div style={{ height: 4, background: 'var(--surface-tint)', borderRadius: 2, marginTop: 'auto' }}>
        {progress != null && (
          <div style={{ width: `${Math.min(100, Math.max(0, progress))}%`, height: '100%', background: accent, borderRadius: 2, transition: 'width 0.5s ease' }} />
        )}
      </div>
    </div>
  )
}
