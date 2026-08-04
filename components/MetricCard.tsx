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
}

export default function MetricCard({ title, value, unit, label, labelColor, sub, subColor, accent = '#3B82F6', progress, icon }: Props) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: '14px 15px',
        boxShadow: 'var(--shadow-xs)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 104,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
        {icon && (
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 7, color: accent, background: `${accent}1a`, flexShrink: 0 }}>
            {icon}
          </span>
        )}
        <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 'clamp(21px,4.4vw,26px)', fontWeight: 700, color: 'var(--text)', lineHeight: 1, letterSpacing: '-0.025em', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        {unit && <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{unit}</span>}
      </div>

      {label && <div style={{ fontSize: 11.5, fontWeight: 600, color: labelColor, marginTop: 5 }}>{label}</div>}
      {sub && <div style={{ fontSize: 11, color: subColor ?? 'var(--subtle)', fontWeight: subColor ? 500 : 400, marginTop: label ? 1 : 4 }}>{sub}</div>}

      {/* Progress track always reserved at the bottom → every card is the same height */}
      <div style={{ height: 4, background: 'var(--surface-tint)', borderRadius: 2, marginTop: 'auto' }}>
        {progress != null && (
          <div style={{ width: `${Math.min(100, Math.max(0, progress))}%`, height: '100%', background: accent, borderRadius: 2, transition: 'width 0.5s ease' }} />
        )}
      </div>
    </div>
  )
}
