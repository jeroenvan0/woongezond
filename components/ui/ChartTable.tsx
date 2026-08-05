'use client'
import { ReactNode } from 'react'

export interface Column {
  key: string
  label: string
}

interface Props {
  /** Accessible caption / summary label, e.g. "CO₂ (ppm)". */
  caption: string
  columns: Column[]
  rows: Record<string, ReactNode>[]
  /** Cap the rendered rows (most charts have hundreds of points). */
  max?: number
}

/**
 * "Toon als tabel" — a real text alternative for a chart (3.4, D6). Doubles as an
 * inspection tool for the evidentiary use case: the exact numbers behind the line.
 * Collapsed by default via <details> so it does not lengthen the page, keyboard- and
 * screen-reader-navigable, and never renders more than `max` rows.
 */
export default function ChartTable({ caption, columns, rows, max = 300 }: Props) {
  const shown = rows.length > max ? rows.slice(-max) : rows
  const th: React.CSSProperties = { textAlign: 'left', padding: '5px 10px', fontWeight: 600, color: 'var(--muted)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface)' }
  const td: React.CSSProperties = { padding: '4px 10px', color: 'var(--text)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }

  return (
    <details className="wz-chart-table">
      <summary>Toon als tabel</summary>
      <div style={{ maxHeight: 260, overflow: 'auto', marginTop: 8, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-xs)' }}>
          <caption className="wz-sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" style={th}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} style={td}>{r[c.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > max && (
        <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--subtle)', marginTop: 4 }}>
          Laatste {max} van {rows.length} meetpunten.
        </div>
      )}
    </details>
  )
}
