'use client'
import { useState } from 'react'
import { HeatmapResult, HeatmapMetric, MONTH_NL_SHORT } from '@/lib/trends'
import ChartTable from '@/components/ui/ChartTable'

const METRIC_NL: Record<HeatmapMetric, string> = { co2: 'CO₂', humidity: 'luchtvochtigheid', temperature: 'temperatuur' }

interface Stop {
  at: number
  color: [number, number, number]
}

const META: Record<HeatmapMetric, { unit: string; zmin: number; zmax: number; stops: Stop[] }> = {
  co2: {
    unit: 'ppm',
    zmin: 400,
    zmax: 1400,
    stops: [
      { at: 0.0, color: [22, 163, 74] },
      { at: 0.35, color: [134, 239, 172] },
      { at: 0.55, color: [252, 211, 77] },
      { at: 0.75, color: [249, 115, 22] },
      { at: 1.0, color: [220, 38, 38] },
    ],
  },
  humidity: {
    unit: '%',
    zmin: 30,
    zmax: 85,
    stops: [
      { at: 0.0, color: [219, 234, 254] },
      { at: 0.3, color: [59, 130, 246] },
      { at: 0.6, color: [252, 211, 77] },
      { at: 0.85, color: [249, 115, 22] },
      { at: 1.0, color: [220, 38, 38] },
    ],
  },
  temperature: {
    unit: '°C',
    zmin: 14,
    zmax: 28,
    stops: [
      { at: 0.0, color: [191, 219, 254] },
      { at: 0.5, color: [59, 130, 246] },
      { at: 1.0, color: [220, 38, 38] },
    ],
  },
}

function colorFor(value: number | null, meta: (typeof META)[HeatmapMetric]): string {
  if (value == null) return 'var(--surface-tint)'
  const norm = Math.max(0, Math.min(1, (value - meta.zmin) / (meta.zmax - meta.zmin)))
  const stops = meta.stops
  let lo = stops[0]
  let hi = stops[stops.length - 1]
  for (let i = 0; i < stops.length - 1; i++) {
    if (norm >= stops[i].at && norm <= stops[i + 1].at) {
      lo = stops[i]
      hi = stops[i + 1]
      break
    }
  }
  const span = hi.at - lo.at || 1
  const f = (norm - lo.at) / span
  const c = lo.color.map((v, i) => Math.round(v + (hi.color[i] - v) * f))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

const HOURS = Array.from({ length: 24 }, (_, h) => h)

export default function HourHeatmap({ metric, result }: { metric: HeatmapMetric; result: HeatmapResult }) {
  const meta = META[metric]
  const [hover, setHover] = useState<{ m: number; h: number; v: number | null } | null>(null)

  if (!result.months.length)
    return (
      <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 13 }}>
        Nog geen data beschikbaar voor heatmap
      </div>
    )

  // Screen readers get the numbers via the table below; the coloured grid is decorative
  // for them (role="img" with a summary), which avoids 24×N unlabelled focus stops (D3).
  const tableRows = result.months.flatMap((mo, ri) =>
    HOURS.filter((h) => result.matrix[ri][h] != null).map((h) => ({
      m: MONTH_NL_SHORT[mo],
      h: `${String(h).padStart(2, '0')}:00`,
      v: `${result.matrix[ri][h]!.toFixed(1)} ${meta.unit}`,
    })),
  )

  return (
    <div style={{ overflowX: 'auto' }}>
      <div
        style={{ minWidth: 520 }}
        role="img"
        aria-label={`Warmtekaart van gemiddelde ${METRIC_NL[metric]} per maand en uur van de dag over ${result.months.length} maanden. Gebruik "Toon als tabel" voor de exacte waarden.`}
      >
        {result.months.map((mo, ri) => (
          <div key={mo} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
            <div style={{ width: 32, fontSize: 11, color: 'var(--muted)', flexShrink: 0, textAlign: 'right', paddingRight: 4 }}>
              {MONTH_NL_SHORT[mo]}
            </div>
            <div style={{ display: 'flex', gap: 2, flex: 1 }}>
              {HOURS.map((h) => {
                const v = result.matrix[ri][h]
                return (
                  <div
                    key={h}
                    onMouseEnter={() => setHover({ m: mo, h, v })}
                    onMouseLeave={() => setHover(null)}
                    title={`${MONTH_NL_SHORT[mo]} ${String(h).padStart(2, '0')}:00 — ${v == null ? '—' : v.toFixed(1) + ' ' + meta.unit}`}
                    style={{
                      flex: 1,
                      height: 22,
                      borderRadius: 3,
                      background: colorFor(v, meta),
                      cursor: v == null ? 'default' : 'pointer',
                      transition: 'transform 0.1s',
                      transform: hover && hover.m === mo && hover.h === h ? 'scale(1.18)' : 'none',
                    }}
                  />
                )
              })}
            </div>
          </div>
        ))}
        {/* Hour axis */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
          <div style={{ width: 32, flexShrink: 0 }} />
          <div style={{ display: 'flex', flex: 1, justifyContent: 'space-between', fontSize: 9, color: 'var(--subtle)' }}>
            {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
              <span key={h}>{String(h).padStart(2, '0')}:00</span>
            ))}
          </div>
        </div>
        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 11, color: 'var(--muted)' }}>
          <span>{meta.zmin}</span>
          <div
            style={{
              flex: 1,
              maxWidth: 200,
              height: 8,
              borderRadius: 4,
              background: `linear-gradient(to right, ${meta.stops
                .map((s) => `rgb(${s.color.join(',')}) ${s.at * 100}%`)
                .join(', ')})`,
            }}
          />
          <span>
            {meta.zmax} {meta.unit}
          </span>
          {hover && hover.v != null && (
            <span style={{ marginLeft: 'auto', fontWeight: 600, color: 'var(--text)' }}>
              {MONTH_NL_SHORT[hover.m]} {String(hover.h).padStart(2, '0')}:00 — {hover.v.toFixed(1)} {meta.unit}
            </span>
          )}
        </div>
      </div>
      <ChartTable
        caption={`Gemiddelde ${METRIC_NL[metric]} per maand en uur`}
        columns={[{ key: 'm', label: 'Maand' }, { key: 'h', label: 'Uur' }, { key: 'v', label: 'Gemiddelde' }]}
        rows={tableRows}
        max={500}
      />
    </div>
  )
}
