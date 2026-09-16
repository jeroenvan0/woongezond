'use client'
import { useMemo } from 'react'
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea, ReferenceLine } from 'recharts'
import { buildTimeAxis, makeTimeTick, tooltipLabel, insertGaps, dayNight, dayNightMarks } from '@/components/chartAxis'
import { useChartColors } from '@/lib/useChartColors'

// Alle sensoren van een vloot in één grafiek (cockpit › Analyse). Elke sensor is een lijn;
// de reeksen liggen op dezelfde tijdvakken (server bucket), dus één rij per tijdstip.
// Met een gekozen sensor worden de gelabelde momenten van die sensor als vlakken getekend.

export interface FleetSeries {
  id: string
  label: string
  color: string
  points: { t: number; v: number | null }[]
}
export interface FleetBand { start: number; end: number; color: string; label: string }

interface Props {
  series: FleetSeries[]
  unit: string
  decimals?: number
  height?: number
  /** Uitgelichte sensoren; leeg of null = alle even sterk. */
  highlight?: Set<string> | null
  bands?: FleetBand[]
  refLine?: { value: number; label: string }
  outdoor?: { t: number; v: number | null }[]
  outdoorLabel?: string
}

function Tip({ active, payload, unit, decimals, names, withPart }: any) {
  if (!active || !payload?.length) return null
  const t: number = payload[0]?.payload?.t
  const rows = payload.filter((p: any) => p.value != null).sort((a: any, b: any) => b.value - a.value)
  return (
    <div className="custom-tooltip">
      <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 4 }}>{tooltipLabel(t, withPart)}</div>
      {rows.map((p: any) => (
        <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: p.stroke, fontWeight: 600, fontSize: 12 }}>
          <span>{names[p.dataKey] ?? p.dataKey}</span>
          <span>{typeof p.value === 'number' ? p.value.toFixed(decimals) : p.value} {unit}</span>
        </div>
      ))}
    </div>
  )
}

export default function FleetChart({ series, unit, decimals = 0, height = 300, highlight, bands, refLine, outdoor, outdoorLabel = 'buiten' }: Props) {
  const c = useChartColors()
  const { data, keys, names } = useMemo(() => {
    const rows = new Map<number, Record<string, number | null>>()
    const keys: string[] = []
    const names: Record<string, string> = {}
    for (const s of series) {
      const k = `d_${s.id}`
      keys.push(k); names[k] = s.label
      for (const p of s.points) {
        const r = rows.get(p.t) ?? { t: p.t }
        r[k] = p.v
        rows.set(p.t, r)
      }
    }
    if (outdoor?.length) {
      keys.push('outdoor'); names.outdoor = outdoorLabel
      for (const p of outdoor) {
        const r = rows.get(p.t) ?? { t: p.t }
        r.outdoor = p.v
        rows.set(p.t, r)
      }
    }
    const data = [...rows.values()].sort((a, b) => (a.t as number) - (b.t as number)) as ({ t: number } & Record<string, number | null>)[]
    // De buitenlijn heeft één punt per uur tussen 5-minuutpunten van de sensoren; die krijgt
    // geen gat-markering en wordt over de nulls heen verbonden (anders blijven het losse punten).
    return { data: insertGaps(data, keys.filter((k) => k !== 'outdoor')), keys, names }
  }, [series, outdoor, outdoorLabel])

  if (!data.length) {
    return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 13 }}>Geen data</div>
  }
  const { ticks, step } = buildTimeAxis(data)
  const dn = dayNight(data[0].t, data[data.length - 1].t)

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 12 }}>
        {dayNightMarks(dn, c)}
        <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
        <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} ticks={ticks} tick={makeTimeTick(step, ticks)} tickLine={false} axisLine={false} height={34} interval={0} />
        <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={40} domain={['auto', 'auto']} />
        <Tooltip content={<Tip unit={unit} decimals={decimals} names={names} withPart={!!dn} />} />
        {bands?.map((b, i) => (
          <ReferenceArea key={i} x1={b.start} x2={b.end} fill={b.color} fillOpacity={0.14} stroke={b.color} strokeOpacity={0.5} label={{ value: b.label, position: 'insideTop', fontSize: 9, fill: b.color }} />
        ))}
        {refLine && <ReferenceLine y={refLine.value} stroke={c.warn} strokeDasharray="4 3" strokeWidth={1.2} label={{ value: refLine.label, position: 'insideTopLeft', fontSize: 10, fill: c.warn }} />}
        {series.map((s) => {
          const k = `d_${s.id}`
          const on = !!highlight?.size && highlight.has(s.id)
          const dim = !!highlight?.size && !on
          return (
            <Line key={k} type="monotone" dataKey={k} name={s.label} stroke={s.color} strokeWidth={on ? 2.4 : 1.6} strokeOpacity={dim ? 0.18 : 1} dot={false} activeDot={dim ? false : { r: 3, fill: s.color }} isAnimationActive={false} connectNulls={false} />
          )
        })}
        {outdoor?.length ? <Line type="monotone" dataKey="outdoor" name={outdoorLabel} stroke={c.muted} strokeWidth={1.6} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls /> : null}
      </ComposedChart>
    </ResponsiveContainer>
  )
}
