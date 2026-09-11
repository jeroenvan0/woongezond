'use client'
import { ComposedChart, Bar, Line, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, LabelList } from 'recharts'
import type { MonthOutlook } from '@/lib/mouldRisk'
import { useChartColors, alpha, ChartColors } from '@/lib/useChartColors'

// Jaarverwachting van het schimmelrisico (lib/mouldRisk.ts → year): per maand de verwachte
// vochtigheid op de koudste plek, gekleurd naar risico, met de 80%-grens en — waar de sensor
// al meet — de berekende waarde uit echte metingen als stippen.

const barColor = (m: MonthOutlook, c: ChartColors) =>
  alpha(m.level === 'hoog' ? c.crit : m.level === 'verhoogd' ? c.warn : c.ok, m.isPast ? 0.35 : m.isNow ? 0.95 : 0.7)

function Tip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const m: MonthOutlook = payload[0]?.payload
  if (!m) return null
  return (
    <div className="custom-tooltip">
      <div style={{ fontWeight: 700, color: 'var(--text)' }}>{m.label}{m.isNow ? ' (nu)' : ''}: hoek ~{m.rhSurface}% RV</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, lineHeight: 1.5 }}>
        Buiten gem. {m.te.toLocaleString('nl-NL')} °C · binnen {m.ti.toLocaleString('nl-NL')} °C / {m.rhIndoor}%
        {m.measured != null && <><br />Uit metingen: {m.measured}%</>}
        {m.mi != null && <><br />Schimmelindex eind van de maand: {m.mi.toLocaleString('nl-NL')}</>}
      </div>
    </div>
  )
}

export default function MouldYearChart({ data, height = 240 }: { data: MonthOutlook[]; height?: number }) {
  const c = useChartColors()
  // De huidige maand krijgt "nu" als tweede regel onder de as — op één regel loopt het op een telefoon in de buurmaanden.
  const tick = ({ x, y, payload }: any) => {
    const m = data[payload.index]
    return (
      <g transform={`translate(${x},${y})`}>
        <text dy={10} textAnchor="middle" fontSize={10} fill={m?.isNow ? c.text : c.muted} fontWeight={m?.isNow ? 700 : 400}>{payload.value}</text>
        {m?.isNow && <text dy={22} textAnchor="middle" fontSize={9} fill={c.text} fontWeight={700}>nu</text>}
      </g>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 22, right: 8, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
        <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} interval={0} height={28} />
        <YAxis domain={[40, 100]} ticks={[40, 60, 80, 100]} tick={{ fontSize: 10, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={40} unit="%" />
        <Tooltip content={<Tip />} cursor={{ fill: alpha(c.muted, 0.08) }} />
        <Bar dataKey="rhSurface" name="Verwacht" radius={[3, 3, 0, 0]} maxBarSize={40} isAnimationActive={false}>
          {data.map((m, i) => <Cell key={i} fill={barColor(m, c)} />)}
          <LabelList dataKey="rhSurface" position="top" style={{ fontSize: 9.5, fill: c.muted }} />
        </Bar>
        <ReferenceLine y={80} stroke={c.crit} strokeDasharray="4 3" label={{ value: '80% — schimmel kan groeien', position: 'insideTopRight', fontSize: 10, fill: c.crit }} />
        <Line dataKey="measured" name="Uit metingen" stroke="none" dot={{ r: 4, fill: c.text, stroke: c.surface, strokeWidth: 1.5 }} isAnimationActive={false} connectNulls={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
