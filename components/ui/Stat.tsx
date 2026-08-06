'use client'
import { ReactNode } from 'react'

interface Props {
  label: string
  value: ReactNode
  color?: string
  /** Optional short hint, e.g. a direction ("hoger = beter"). */
  hint?: ReactNode
}

/**
 * The small "uppercase label + bold value" tile used in DiagnoseCard, the report
 * stat grid and the scenario outputs. Was duplicated 3–4× inline.
 */
export default function Stat({ label, value, color, hint }: Props) {
  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border-soft)', borderRadius: 'var(--r-md)', padding: '8px 11px' }}>
      <div style={{ fontSize: 'var(--fs-2xs)', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 5 }}>
        {label}
        {hint}
      </div>
      <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: color ?? 'var(--text)', marginTop: 2, lineHeight: 1.1 }}>{value}</div>
    </div>
  )
}
