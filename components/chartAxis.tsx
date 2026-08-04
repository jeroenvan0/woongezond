'use client'
// Shared X-axis time formatting for the time-series charts.
//
// Ticks are snapped to natural boundaries (round hours / midnights) in
// Amsterdam local time — never arbitrary "18:31"-style positions. The label
// switches with the chosen step:
//   step < 1 day  → round time (06:00) + the date under midnight ticks
//   step ≥ 1 day  → just the date (3 jun) so multi-day periods read as days
//   step ≥ ~1 mo  → month + year

const TZ = 'Europe/Amsterdam'
const H = 3_600_000
const D = 24 * H

interface Datum {
  t: number
}

/** Offset (ms) of the Amsterdam wall clock relative to UTC at time `t`. */
function amsOffsetMs(t: number): number {
  const d = new Date(t)
  const asUTC = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
  const asTZ = new Date(d.toLocaleString('en-US', { timeZone: TZ })).getTime()
  return asTZ - asUTC
}

const STEPS = [H, 2 * H, 3 * H, 6 * H, 12 * H, D, 2 * D, 7 * D, 14 * D, 28 * D, 91 * D, 182 * D, 365 * D]

export interface TimeAxis {
  ticks: number[]
  step: number
}

/** Build evenly-stepped ticks aligned to Amsterdam clock/day boundaries. */
export function buildTimeAxis(data: Datum[], maxTicks = 7): TimeAxis {
  if (!data.length) return { ticks: [], step: H }
  const t0 = data[0].t
  const t1 = data[data.length - 1].t
  if (t1 <= t0) return { ticks: [t0], step: H }

  const span = t1 - t0
  let step = STEPS[STEPS.length - 1]
  for (const s of STEPS) {
    if (span / s <= maxTicks) {
      step = s
      break
    }
  }

  const off = amsOffsetMs(t0)
  const first = Math.ceil((t0 + off) / step) * step // first boundary at/after t0 (local)
  const ticks: number[] = []
  for (let lt = first; lt <= t1 + off + 1; lt += step) ticks.push(lt - off)
  if (ticks.length < 2) return { ticks: [t0, t1], step }
  return { ticks, step }
}

/**
 * Insert null-valued breakpoints where consecutive points are more than
 * `factor`× the typical sampling interval apart — so the chart breaks the line
 * during offline gaps instead of drawing a straight line across them.
 */
export function insertGaps<T extends { t: number }>(data: T[], nullKeys: string[], factor = 2.5): T[] {
  if (data.length < 3) return data
  const deltas: number[] = []
  for (let i = 1; i < data.length; i++) deltas.push(data[i].t - data[i - 1].t)
  const sorted = [...deltas].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] || 0
  if (median <= 0) return data

  const out: T[] = []
  for (let i = 0; i < data.length; i++) {
    out.push(data[i])
    if (i < data.length - 1 && data[i + 1].t - data[i].t > factor * median) {
      const breakPoint: any = { t: data[i].t + median }
      for (const k of nullKeys) breakPoint[k] = null
      out.push(breakPoint as T)
    }
  }
  return out
}

/** Full date + time label for tooltips (Amsterdam), e.g. "wo 3 jun 14:30". */
export function tooltipLabel(t: number): string {
  return new Date(t).toLocaleString('nl-NL', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  })
}

const timeStr = (d: Date) => d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
const dayStr = (d: Date) => d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', timeZone: TZ })
const monthStr = (d: Date) => d.toLocaleDateString('nl-NL', { month: 'short', year: '2-digit', timeZone: TZ })
const ymd = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ }) // YYYY-MM-DD in Amsterdam

/** Returns a Recharts `tick` renderer for the given step + tick set. */
export function makeTimeTick(step: number, ticks: number[]) {
  function TimeTick({ x, y, payload }: any) {
    const d = new Date(payload.value)

    let line1: string
    let line2 = ''
    if (step < D) {
      // Sub-day view: round time, with the date shown under midnight / first tick.
      line1 = timeStr(d)
      const idx = ticks.indexOf(payload.value)
      const prev = idx > 0 ? new Date(ticks[idx - 1]) : null
      if (!prev || ymd(d) !== ymd(prev)) line2 = dayStr(d)
    } else if (step < 28 * D) {
      line1 = dayStr(d)
    } else {
      line1 = monthStr(d)
    }

    return (
      <g transform={`translate(${x},${y})`}>
        <text x={0} y={0} dy={12} textAnchor="middle" fontSize={10} fill="var(--muted)">
          {line1}
        </text>
        {line2 && (
          <text x={0} y={0} dy={24} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="var(--muted)">
            {line2}
          </text>
        )}
      </g>
    )
  }
  return TimeTick
}
