'use client'
import {
  ComposedChart,
  Bar,
  Line,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
} from 'recharts'
import { useChartColors, alpha, ChartColors } from '@/lib/useChartColors'

export interface TimelineDatum {
  t: number
  score: number
  rolling: number
}

export interface InterventionMarker {
  t: number
  label: string
}

function barColor(s: number, c: ChartColors) {
  return alpha(s >= 65 ? c.ok : s >= 40 ? c.warn : c.crit, 0.72)
}

function Tip({ active, payload, rollingColor }: any) {
  if (!active || !payload?.length) return null
  const p = payload[0]?.payload
  if (!p) return null
  const d = new Date(p.t)
  return (
    <div className="custom-tooltip">
      <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 2 }}>
        {d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })}
      </div>
      <div style={{ fontWeight: 700, color: 'var(--text)' }}>{p.score} / 100</div>
      <div style={{ fontSize: 11, color: rollingColor }}>7-daags gem: {p.rolling.toFixed(0)}</div>
    </div>
  )
}

export default function HealthTimelineChart({
  data,
  interventions,
  height = 240,
}: {
  data: TimelineDatum[]
  interventions: InterventionMarker[]
  height?: number
}) {
  const c = useChartColors()
  if (data.length < 2)
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 13 }}>
        Minimaal 2 dagen data nodig voor de tijdlijn
      </div>
    )
  const spanMs = data[data.length - 1].t - data[0].t

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 22, right: 16, left: 0, bottom: 0 }}>
        <ReferenceArea y1={0} y2={40} fill={alpha(c.crit, 0.05)} fillOpacity={1} />
        <ReferenceArea y1={40} y2={65} fill={alpha(c.warn, 0.05)} fillOpacity={1} />
        <ReferenceArea y1={65} y2={100} fill={alpha(c.ok, 0.05)} fillOpacity={1} />
        <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          tickFormatter={(t) =>
            new Date(t).toLocaleDateString('nl-NL', {
              day: 'numeric',
              month: spanMs > 60 * 86400000 ? 'short' : undefined,
            })
          }
          tick={{ fontSize: 10, fill: 'var(--muted)' }}
          tickLine={false}
          axisLine={false}
          tickCount={6}
        />
        <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={28} />
        <Tooltip content={<Tip rollingColor={c.accent} />} />
        <ReferenceLine y={65} stroke={c.ok} strokeDasharray="3 3" strokeWidth={0.8} />
        <ReferenceLine y={40} stroke={c.crit} strokeDasharray="3 3" strokeWidth={0.8} />
        {interventions.map((iv) => (
          <ReferenceLine
            key={iv.t}
            x={iv.t}
            stroke={c.warn}
            strokeDasharray="3 3"
            strokeWidth={1.3}
            label={{
              value: iv.label.length > 18 ? iv.label.slice(0, 18) + '…' : iv.label,
              position: 'top',
              fontSize: 8.5,
              fill: c.warn,
              angle: 0,
            }}
          />
        ))}
        <Bar dataKey="score" name="Dagscore" radius={[2, 2, 0, 0]} maxBarSize={20} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={i} fill={barColor(d.score, c)} />
          ))}
        </Bar>
        <Line
          type="monotone"
          dataKey="rolling"
          name="7-daags gem."
          stroke={c.accent}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
