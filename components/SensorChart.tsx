'use client'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { ProcessedRow } from '@/lib/types'
import { buildTimeAxis, makeTimeTick, tooltipLabel, insertGaps } from '@/components/chartAxis'
import { useChartColors } from '@/lib/useChartColors'

interface Props {
  data: ProcessedRow[]
  dataKey: 'co2' | 'temp' | 'rh' | 'mr' | 'dp'
  color: string
  fillColor: string
  unit: string
  height?: number
  refLines?: { value: number; label: string; color: string }[]
  maWindow?: number
}

function CustomTooltip({ active, payload, unit, color }: any) {
  if (!active || !payload?.length) return null
  const val = payload[0]?.value
  const t: number = payload[0]?.payload?.t
  const label = tooltipLabel(t)
  return (
    <div className="custom-tooltip">
      <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 700, color }}>{typeof val === 'number' ? val.toFixed(1) : val} {unit}</div>
    </div>
  )
}

export default function SensorChart({ data, dataKey, color, fillColor, unit, height = 200, refLines }: Props) {
  const c = useChartColors()
  if (!data.length) return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 13 }}>Geen data</div>

  const chartData = data.map(r => ({
    t: r.ts.getTime(),          // numeric epoch ms → Recharts time scale
    v: +r[dataKey].toFixed(1),
  }))
  const { ticks, step } = buildTimeAxis(chartData)
  const plotData = insertGaps(chartData, ['v'])

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={plotData} margin={{ top: 4, right: 16, left: 0, bottom: 12 }}>
        <defs>
          <linearGradient id={`fill-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.18} />
            <stop offset="95%" stopColor={color} stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          ticks={ticks}
          tick={makeTimeTick(step, ticks)}
          tickLine={false}
          axisLine={false}
          height={34}
          interval={0}
        />
        <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={36} />
        <Tooltip content={<CustomTooltip unit={unit} color={color} />} />
        {refLines?.map(l => (
          <ReferenceLine key={l.value} y={l.value} stroke={l.color} strokeDasharray="4 3" strokeWidth={1.2}
            label={{ value: l.label, position: 'insideTopLeft', fontSize: 10, fill: l.color }} />
        ))}
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#fill-${dataKey})`} dot={false} activeDot={{ r: 4, fill: color }} connectNulls={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
