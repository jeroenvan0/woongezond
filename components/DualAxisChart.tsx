'use client'
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from 'recharts'
import { buildTimeAxis, makeTimeTick, tooltipLabel, insertGaps } from '@/components/chartAxis'
import { useChartColors } from '@/lib/useChartColors'

export interface DualPoint {
  t: number
  a: number
  b: number
}

interface Props {
  data: DualPoint[]
  aLabel: string
  bLabel: string
  aColor: string
  bColor: string
  aUnit: string
  bUnit: string
  height?: number
  bRefLine?: { value: number; label: string; color: string }
}

function Tip({ active, payload, aLabel, bLabel, aUnit, bUnit, aColor, bColor }: any) {
  if (!active || !payload?.length) return null
  const t: number = payload[0]?.payload?.t
  const label = tooltipLabel(t)
  const a = payload.find((p: any) => p.dataKey === 'a')?.value
  const b = payload.find((p: any) => p.dataKey === 'b')?.value
  return (
    <div className="custom-tooltip">
      <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 4 }}>{label}</div>
      {a != null && (
        <div style={{ fontWeight: 700, color: aColor }}>
          {aLabel}: {a.toFixed(1)} {aUnit}
        </div>
      )}
      {b != null && (
        <div style={{ fontWeight: 700, color: bColor }}>
          {bLabel}: {b.toFixed(1)} {bUnit}
        </div>
      )}
    </div>
  )
}

export default function DualAxisChart({
  data,
  aLabel,
  bLabel,
  aColor,
  bColor,
  aUnit,
  bUnit,
  height = 220,
  bRefLine,
}: Props) {
  const c = useChartColors()
  if (!data.length)
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 13 }}>
        Geen data
      </div>
    )
  const { ticks, step } = buildTimeAxis(data)
  const plotData = insertGaps(data, ['a', 'b'])

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={plotData} margin={{ top: 8, right: 8, left: 0, bottom: 12 }}>
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
        <YAxis yAxisId="a" tick={{ fontSize: 10, fill: aColor }} tickLine={false} axisLine={false} width={34} />
        <YAxis
          yAxisId="b"
          orientation="right"
          tick={{ fontSize: 10, fill: bColor }}
          tickLine={false}
          axisLine={false}
          width={34}
        />
        <Tooltip
          content={
            <Tip
              aLabel={aLabel}
              bLabel={bLabel}
              aUnit={aUnit}
              bUnit={bUnit}
              aColor={aColor}
              bColor={bColor}
            />
          }
        />
        <Legend
          wrapperStyle={{ fontSize: 11, color: 'var(--muted)' }}
          iconType="plainline"
          verticalAlign="top"
          height={24}
        />
        {bRefLine && (
          <ReferenceLine
            yAxisId="b"
            y={bRefLine.value}
            stroke={bRefLine.color}
            strokeDasharray="4 3"
            strokeWidth={1.2}
            label={{ value: bRefLine.label, position: 'insideTopLeft', fontSize: 10, fill: bRefLine.color }}
          />
        )}
        <Line
          yAxisId="a"
          type="monotone"
          dataKey="a"
          name={aLabel}
          stroke={aColor}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
          connectNulls={false}
        />
        <Line
          yAxisId="b"
          type="monotone"
          dataKey="b"
          name={bLabel}
          stroke={bColor}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
          connectNulls={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
