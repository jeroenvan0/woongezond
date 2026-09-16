'use client'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts'
import { ProcessedRow } from '@/lib/types'
import { buildTimeAxis, makeTimeTick, tooltipLabel, insertGaps, dayNight, dayNightMarks } from '@/components/chartAxis'
import { useChartColors, alpha } from '@/lib/useChartColors'

interface Props {
  data: ProcessedRow[]
  dataKey: 'co2' | 'temp' | 'rh' | 'mr' | 'dp'
  color: string
  fillColor: string
  unit: string
  height?: number
  refLines?: { value: number; label: string; color: string }[]
  /** Kleurvlakken achter de lijn (bv. CO₂ goed/verhoogd/hoog), zodat je zonder getallen ziet of het goed zit. */
  zones?: { from: number; to: number; color: string }[]
  maWindow?: number
  /** Recharts syncId — charts sharing one move their cursor/tooltip together (4.3). */
  syncId?: string
}

function CustomTooltip({ active, payload, unit, color, withPart }: any) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload
  const val = row?.v
  const band: [number, number] | undefined = row?.band
  const t: number = row?.t
  const label = tooltipLabel(t, withPart)
  return (
    <div className="custom-tooltip">
      <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 700, color }}>{typeof val === 'number' ? val.toFixed(1) : val} {unit}</div>
      {band && band[1] > band[0] && (
        <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>
          laagste {band[0].toFixed(1)} · hoogste {band[1].toFixed(1)} {unit}
        </div>
      )}
    </div>
  )
}

// Reeksen waarvoor de server een laagste/hoogste per blok meestuurt. Dauwpunt en
// schimmelrisico zijn afgeleid en hebben geen eigen min/max — daar blijft het bij de lijn.
const BANDED = new Set(['co2', 'temp', 'rh'])

export default function SensorChart({ data, dataKey, color, fillColor, unit, height = 200, refLines, zones, syncId }: Props) {
  const c = useChartColors()
  // Een lege grafiek reserveerde de volle hoogte (200px). Op een telefoon leverde dat
  // schermen vol "Geen data" op — precies waar je juist wilt kunnen doorscrollen naar wat
  // er wél staat. Een lege reeks krijgt daarom één regel.
  if (!data.length)
    return (
      <div style={{ padding: '14px 0', color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>
        Geen metingen in deze periode
      </div>
    )

  // Band = laagste–hoogste meting in een samengevoegd blok (lib/bucketing.ts). Een gemiddelde
  // per 12 uur vlakt een CO₂-piek van een avond weg; de band laat zien hoe hoog het echt kwam.
  const bandKey = BANDED.has(dataKey) ? (dataKey as 'co2' | 'temp' | 'rh') : null
  const hasBand = !!bandKey && data.some(r => r.band && r.band[bandKey][1] > r.band[bandKey][0])
  const chartData = data.map(r => ({
    t: r.ts.getTime(),          // numeric epoch ms → Recharts time scale
    v: +r[dataKey].toFixed(1),
    band: hasBand && bandKey && r.band ? [+r.band[bandKey][0].toFixed(1), +r.band[bandKey][1].toFixed(1)] : null,
  }))
  const { ticks, step } = buildTimeAxis(chartData)
  const plotData = insertGaps(chartData, ['v', 'band'])
  const dn = dayNight(chartData[0].t, chartData[chartData.length - 1].t)

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={plotData} syncId={syncId} margin={{ top: 4, right: 16, left: 0, bottom: 12 }}>
        <defs>
          <linearGradient id={`fill-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.18} />
            <stop offset="95%" stopColor={color} stopOpacity={0.01} />
          </linearGradient>
        </defs>
        {zones?.map((z) => (
          <ReferenceArea key={`z${z.from}`} y1={z.from} y2={z.to} fill={alpha(z.color, 0.07)} fillOpacity={1} stroke="none" ifOverflow="hidden" />
        ))}
        {dayNightMarks(dn, c)}
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
        <Tooltip content={<CustomTooltip unit={unit} color={color} withPart={!!dn} />} />
        {refLines?.map(l => (
          <ReferenceLine key={l.value} y={l.value} stroke={l.color} strokeDasharray="4 3" strokeWidth={1.2}
            label={{ value: l.label, position: 'insideTopLeft', fontSize: 10, fill: l.color }} />
        ))}
        {hasBand && (
          <Area type="monotone" dataKey="band" stroke="none" fill={color} fillOpacity={0.14} dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} legendType="none" />
        )}
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={hasBand ? 'none' : `url(#fill-${dataKey})`} dot={false} activeDot={{ r: 4, fill: color }} connectNulls={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
