'use client'
import { ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Colour of the leading bar. Defaults to brand chrome. */
  accent?: string
  right?: ReactNode
}

/**
 * The "3px bar + title" heading repeated across DiagnoseCard, the report and the
 * schimmel page. One element so the bar width, gap and type size stay identical.
 */
export default function SectionHeading({ children, accent = 'var(--brand)', right }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
      <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
        <span style={{ width: 3, height: 14, background: accent, borderRadius: 2, flexShrink: 0 }} />
        {children}
      </div>
      {right}
    </div>
  )
}
