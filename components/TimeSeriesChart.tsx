'use client'
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { buildTimeAxis, makeTimeTick, tooltipLabel, insertGaps } from '@/components/chartAxis'
import { useChartColors } from '@/lib/useChartColors'

export interface Point {
  t: number // epoch ms
  v: number
}

export interface RefLine {
  value: number
  label: string
  color: string
}

interface Props {
  data: Point[]
  color: string
  unit: string
  height?: number
  refLines?: RefLine[]
  decimals?: number
  area?: boolean
  id?: string
}

function Tip({ active, payload, unit, color, decimals }: any) {
  if (!active || !payload?.length) return null
  const val = payload[0]?.value
  const t: number = payload[0]?.payload?.t
  const label = tooltipLabel(t)
  return (
    <div className="custom-tooltip">
      <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 700, color }}>
        {typeof val === 'number' ? val.toFixed(decimals) : val} {unit}
      </div>
    </div>
  )
}

export default function TimeSeriesChart({
  data,
  color,
  unit,
  height = 200,
  refLines,
  decimals = 1,
  area = true,
  id = 'ts',
}: Props) {
  const c = useChartColors()
  if (!data.length)
    return (
      <div
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--muted)',
          fontSize: 13,
        }}
      >
        Geen data
      </div>
    )

  const { ticks, step } = buildTimeAxis(data)
  const plotData = insertGaps(data, ['v'])
  const Chart: any = area ? AreaChart : LineChart

  return (
    <ResponsiveContainer width="100%" height={height}>
      <Chart data={plotData} margin={{ top: 6, right: 16, left: 0, bottom: 12 }}>
        <defs>
          <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.18} />
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
        <Tooltip content={<Tip unit={unit} color={color} decimals={decimals} />} />
        {refLines?.map((l) => (
          <ReferenceLine
            key={`${l.value}-${l.label}`}
            y={l.value}
            stroke={l.color}
            strokeDasharray="4 3"
            strokeWidth={1.2}
            label={{ value: l.label, position: 'insideTopLeft', fontSize: 10, fill: l.color }}
          />
        ))}
        {area ? (
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={2}
            fill={`url(#fill-${id})`}
            dot={false}
            activeDot={{ r: 4, fill: color }}
            isAnimationActive={false}
            connectNulls={false}
          />
        ) : (
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: color }}
            isAnimationActive={false}
            connectNulls={false}
          />
        )}
      </Chart>
    </ResponsiveContainer>
  )
}
