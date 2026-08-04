// Static, print-friendly SVG charts for the court report. No chart library and
// no canvas — pure SVG so the output stays crisp as vector in the printed PDF.

interface Pt {
  t: number
  v: number
}
interface RefLine {
  value: number
  label: string
  color: string
  dash?: string
}

const PAD = { top: 20, right: 14, bottom: 26, left: 44 }

function downsample(pts: Pt[], n = 600): Pt[] {
  if (pts.length <= n) return pts
  const out: Pt[] = []
  for (let i = 0; i < n; i++) out.push(pts[Math.round((i * (pts.length - 1)) / (n - 1))])
  return out
}

/** Split a series wherever the sensor was offline (gap > factor × the typical
 *  sampling interval) so the line breaks instead of drawing across the gap. */
function splitGaps(pts: Pt[], factor = 2.5): Pt[][] {
  if (pts.length < 3) return [pts]
  const deltas: number[] = []
  for (let i = 1; i < pts.length; i++) deltas.push(pts[i].t - pts[i - 1].t)
  const med = [...deltas].sort((a, b) => a - b)[Math.floor(deltas.length / 2)] || 0
  if (med <= 0) return [pts]
  const segs: Pt[][] = []
  let cur: Pt[] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].t - pts[i - 1].t > factor * med) {
      segs.push(cur)
      cur = [pts[i]]
    } else cur.push(pts[i])
  }
  segs.push(cur)
  return segs
}

const segPath = (seg: Pt[], sx: (t: number) => number, sy: (v: number) => number) =>
  seg.map((p, i) => `${i ? 'L' : 'M'}${sx(p.t).toFixed(1)},${sy(p.v).toFixed(1)}`).join(' ')

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min]
  const span = max - min
  const step0 = span / count
  const mag = Math.pow(10, Math.floor(Math.log10(step0)))
  const norm = step0 / mag
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag
  const start = Math.ceil(min / step) * step
  const ticks: number[] = []
  for (let v = start; v <= max + 1e-9; v += step) ticks.push(+v.toFixed(6))
  return ticks
}

function xLabels(t0: number, t1: number): { t: number; label: string }[] {
  const spanH = (t1 - t0) / 3600000
  const fmt = (t: number) =>
    spanH <= 24
      ? new Date(t).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' })
      : new Date(t).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', timeZone: 'Europe/Amsterdam' })
  const out: { t: number; label: string }[] = []
  const n = 5
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n
    out.push({ t, label: fmt(t) })
  }
  return out
}

interface LineProps {
  title: string
  data: Pt[]
  color: string
  fill: string
  unit: string
  refLines?: RefLine[]
  yMin?: number
  yMax?: number
  width?: number
  height?: number
}

export function ReportLineChart({ title, data, color, fill, unit, refLines = [], yMin, yMax, width = 700, height = 180 }: LineProps) {
  const pts = downsample(data.filter((p) => Number.isFinite(p.v)))
  if (pts.length < 2) return <div style={{ fontSize: 11, color: '#94A3B8' }}>Onvoldoende data voor {title}.</div>

  const t0 = pts[0].t
  const t1 = pts[pts.length - 1].t
  const vals = pts.map((p) => p.v)
  const refVals = refLines.map((r) => r.value)
  const dataMin = Math.min(...vals, ...refVals)
  const dataMax = Math.max(...vals, ...refVals)
  const lo = yMin != null ? yMin : dataMin - (dataMax - dataMin || 1) * 0.08
  const hi = yMax != null ? yMax : dataMax + (dataMax - dataMin || 1) * 0.12
  const W = width,
    H = height
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const sx = (t: number) => PAD.left + (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * plotW)
  const sy = (v: number) => PAD.top + (hi === lo ? plotH / 2 : (1 - (v - lo) / (hi - lo)) * plotH)

  const segs = splitGaps(pts)
  const line = segs.map((seg) => segPath(seg, sx, sy)).join(' ')
  const area = segs
    .filter((seg) => seg.length >= 2)
    .map((seg) => `${segPath(seg, sx, sy)} L${sx(seg[seg.length - 1].t).toFixed(1)},${sy(lo).toFixed(1)} L${sx(seg[0].t).toFixed(1)},${sy(lo).toFixed(1)} Z`)
    .join(' ')
  const yTicks = niceTicks(lo, hi)
  const xt = xLabels(t0, t1)
  const gid = `g-${title.replace(/[^a-z0-9]/gi, '')}`

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#0F172A', marginBottom: 2 }}>{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.18} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} y1={sy(v)} x2={W - PAD.right} y2={sy(v)} stroke="#E2E8F0" strokeWidth={0.8} />
            <text x={PAD.left - 5} y={sy(v) + 3} textAnchor="end" fontSize={8.5} fill="#94A3B8">
              {Math.abs(v) >= 100 ? Math.round(v) : +v.toFixed(1)}
            </text>
          </g>
        ))}
        {xt.map((x, i) => (
          <text key={i} x={sx(x.t)} y={H - PAD.bottom + 14} textAnchor="middle" fontSize={8.5} fill="#94A3B8">
            {x.label}
          </text>
        ))}
        <path d={area} fill={`url(#${gid})`} stroke="none" />
        <path d={line} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
        {refLines.map((r) => (
          <g key={r.label}>
            <line x1={PAD.left} y1={sy(r.value)} x2={W - PAD.right} y2={sy(r.value)} stroke={r.color} strokeWidth={1} strokeDasharray={r.dash ?? '4 3'} opacity={0.8} />
            <text x={W - PAD.right} y={sy(r.value) - 3} textAnchor="end" fontSize={8} fill={r.color}>
              {r.label}
            </text>
          </g>
        ))}
        <text x={PAD.left} y={11} fontSize={8.5} fill="#475569">
          {unit}
        </text>
      </svg>
    </div>
  )
}

interface DualProps {
  title: string
  a: Pt[]
  b: Pt[]
  aColor: string
  bColor: string
  aLabel: string
  bLabel: string
  unit: string
  width?: number
  height?: number
}

export function ReportDualChart({ title, a, b, aColor, bColor, aLabel, bLabel, unit, width = 700, height = 180 }: DualProps) {
  const pa = downsample(a.filter((p) => Number.isFinite(p.v)))
  const pb = downsample(b.filter((p) => Number.isFinite(p.v)))
  if (pa.length < 2) return <div style={{ fontSize: 11, color: '#94A3B8' }}>Onvoldoende data voor {title}.</div>

  const t0 = pa[0].t
  const t1 = pa[pa.length - 1].t
  const all = [...pa, ...pb].map((p) => p.v)
  const dataMin = Math.min(...all)
  const dataMax = Math.max(...all)
  const lo = dataMin - (dataMax - dataMin || 1) * 0.08
  const hi = dataMax + (dataMax - dataMin || 1) * 0.12
  const W = width,
    H = height
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const sx = (t: number) => PAD.left + (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * plotW)
  const sy = (v: number) => PAD.top + (hi === lo ? plotH / 2 : (1 - (v - lo) / (hi - lo)) * plotH)
  const path = (pts: Pt[]) => splitGaps(pts).map((seg) => segPath(seg, sx, sy)).join(' ')
  const yTicks = niceTicks(lo, hi)
  const xt = xLabels(t0, t1)

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#0F172A', marginBottom: 2 }}>{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} preserveAspectRatio="xMidYMid meet">
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} y1={sy(v)} x2={W - PAD.right} y2={sy(v)} stroke="#E2E8F0" strokeWidth={0.8} />
            <text x={PAD.left - 5} y={sy(v) + 3} textAnchor="end" fontSize={8.5} fill="#94A3B8">
              {+v.toFixed(1)}
            </text>
          </g>
        ))}
        {xt.map((x, i) => (
          <text key={i} x={sx(x.t)} y={H - PAD.bottom + 14} textAnchor="middle" fontSize={8.5} fill="#94A3B8">
            {x.label}
          </text>
        ))}
        <path d={path(pa)} fill="none" stroke={aColor} strokeWidth={1.4} strokeLinejoin="round" />
        <path d={path(pb)} fill="none" stroke={bColor} strokeWidth={1.2} strokeDasharray="5 3" strokeLinejoin="round" />
        <g>
          <rect x={PAD.left + 4} y={4} width={9} height={9} fill={aColor} />
          <text x={PAD.left + 16} y={12} fontSize={8.5} fill="#475569">
            {aLabel}
          </text>
          <rect x={PAD.left + 70} y={4} width={9} height={9} fill={bColor} />
          <text x={PAD.left + 82} y={12} fontSize={8.5} fill="#475569">
            {bLabel}
          </text>
        </g>
        <text x={W - PAD.right} y={11} textAnchor="end" fontSize={8.5} fill="#475569">
          {unit}
        </text>
      </svg>
    </div>
  )
}
