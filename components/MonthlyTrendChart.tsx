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
  LabelList,
} from 'recharts'
import { MonthlyStat } from '@/lib/trends'
import { useChartColors, alpha, ChartColors } from '@/lib/useChartColors'

function barColor(s: number, c: ChartColors) {
  return alpha(s >= 65 ? c.ok : s >= 40 ? c.warn : c.crit, 0.78)
}

function Tip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const m: MonthlyStat = payload[0]?.payload
  if (!m) return null
  return (
    <div className="custom-tooltip">
      <div style={{ fontWeight: 700, color: 'var(--text)' }}>
        {m.healthScore}/100 · {m.label}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
        CO₂ gem: {m.co2Avg} ppm
        <br />
        RV: {m.rhAvg}% · Schimmel: {m.mrAvg.toFixed(0)}
        <br />
        Geschatte buitentemp: {m.estOutTemp}°C
      </div>
    </div>
  )
}

export default function MonthlyTrendChart({ data, height = 260 }: { data: MonthlyStat[]; height?: number }) {
  const c = useChartColors()
  if (!data.length)
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 13 }}>
        Minimaal één volledige maand data nodig
      </div>
    )

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 24, right: 38, left: 0, bottom: 0 }}>
        <ReferenceArea yAxisId="score" y1={0} y2={40} fill={alpha(c.crit, 0.05)} fillOpacity={1} />
        <ReferenceArea yAxisId="score" y1={40} y2={65} fill={alpha(c.warn, 0.05)} fillOpacity={1} />
        <ReferenceArea yAxisId="score" y1={65} y2={100} fill={alpha(c.ok, 0.05)} fillOpacity={1} />
        <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
        <YAxis yAxisId="score" domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={28} />
        <YAxis
          yAxisId="temp"
          orientation="right"
          domain={[-5, 30]}
          tick={{ fontSize: 10, fill: 'var(--subtle)' }}
          tickLine={false}
          axisLine={false}
          width={32}
        />
        <Tooltip content={<Tip />} />
        <Bar yAxisId="score" dataKey="healthScore" name="Maandscore" radius={[3, 3, 0, 0]} maxBarSize={56} isAnimationActive={false}>
          {data.map((m, i) => (
            <Cell key={i} fill={barColor(m.healthScore, c)} />
          ))}
          <LabelList dataKey="healthScore" position="top" style={{ fontSize: 10, fill: c.muted }} />
        </Bar>
        <Line
          yAxisId="temp"
          type="monotone"
          dataKey="estOutTemp"
          name="Gem. buitentemp"
          stroke={alpha(c.muted, 0.85)}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          dot={{ r: 3, fill: alpha(c.muted, 0.9) }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
