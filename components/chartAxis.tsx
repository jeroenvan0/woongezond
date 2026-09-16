'use client'
// Shared X-axis time formatting for the time-series charts.
//
// Ticks are snapped to natural boundaries (round hours / midnights) in
// Amsterdam local time — never arbitrary "18:31"-style positions. The label
// switches with the chosen step:
//   step < 1 day  → round time (06:00) + the date under midnight ticks
//   step ≥ 1 day  → just the date (3 jun) so multi-day periods read as days
//   step ≥ ~1 mo  → month + year

import { ReferenceArea, ReferenceLine } from 'recharts'
import { alpha, type ChartColors } from '@/lib/useChartColors'

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

// ── Dag en nacht ──────────────────────────────────────────────────────────────
// Een lijn met alleen tijden eronder zegt niet waar de nacht zit of waar een dag ophoudt.
// Tot 15 dagen krijgt elke tijdgrafiek daarom een grijze band voor de nacht en een lijn op
// middernacht, tot 8 dagen met weekdag en datum erbij (daarboven lopen de labels door elkaar).
// De nacht is 23:00–07:00, dezelfde uren als het nachtadvies (lib/reportAnalytics.ts,
// nachtCo2). Langer dan 15 dagen wordt het streepjescode: dan niet.

export const NIGHT_FROM_H = 23
export const NIGHT_TO_H = 7
const DAYNIGHT_MAX_SPAN = 15 * D
const DAY_LABEL_MAX_SPAN = 8 * D

const localHourOf = (t: number) => +new Date(t).toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: TZ }) % 24

/** Dagdeel in Amsterdamse tijd, zoals de nachtbanden het tekenen. */
export function dayPart(t: number): 'nacht' | 'ochtend' | 'middag' | 'avond' {
  const h = localHourOf(t)
  if (h >= NIGHT_FROM_H || h < NIGHT_TO_H) return 'nacht'
  if (h < 12) return 'ochtend'
  if (h < 18) return 'middag'
  return 'avond'
}

export interface DayNight {
  nights: [number, number][] // 23:00–07:00, afgekapt op het venster
  midnights: { t: number; label: string | null }[]
}

/** Nachtbanden en middernachten (UTC ms) binnen [t0, t1]; null als het venster te lang is. */
export function dayNight(t0: number, t1: number): DayNight | null {
  const span = t1 - t0
  if (!(span > 0) || span > DAYNIGHT_MAX_SPAN) return null
  // Lokale kloktijd (als "UTC" gerekend) → echte UTC. De offset wisselt alleen bij zomertijd.
  const toUtc = (local: number) => local - amsOffsetMs(local - amsOffsetMs(local))
  const short = span > 3 * D
  const firstDay = Math.floor((t0 + amsOffsetMs(t0)) / D) * D - D // ook de nacht die vóór t0 begon
  const nights: [number, number][] = []
  const midnights: { t: number; label: string | null }[] = []
  for (let day = firstDay; toUtc(day) <= t1; day += D) {
    const mid = toUtc(day)
    if (mid > t0 && mid < t1) {
      const label = span > DAY_LABEL_MAX_SPAN ? null : new Date(mid).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', ...(short ? {} : { month: 'short' }), timeZone: TZ })
      midnights.push({ t: mid, label })
    }
    const s = Math.max(t0, toUtc(day + NIGHT_FROM_H * H))
    const e = Math.min(t1, toUtc(day + D + NIGHT_TO_H * H))
    if (e > s) nights.push([s, e])
  }
  return { nights, midnights }
}

/**
 * Nachtbanden + middernachtlijnen als Recharts-kinderen. Plaats ze vóór de lijnen, zodat de
 * lijn erboven ligt. `yAxisId` alleen bij grafieken met meerdere y-assen.
 */
export function dayNightMarks(dn: DayNight | null, c: ChartColors, yAxisId?: string) {
  if (!dn) return null
  const y = yAxisId ? { yAxisId } : {}
  return [
    ...dn.nights.map(([x1, x2]) => (
      <ReferenceArea key={`n${x1}`} {...y} x1={x1} x2={x2} fill={alpha(c.muted, 0.09)} fillOpacity={1} stroke="none" ifOverflow="hidden" />
    )),
    ...dn.midnights.map((m) => (
      <ReferenceLine key={`m${m.t}`} {...y} x={m.t} stroke={alpha(c.muted, 0.55)} strokeWidth={1}
        label={m.label ? { value: m.label, position: 'insideTopLeft', fontSize: 9.5, fontWeight: 600, fill: c.muted, offset: 4 } : undefined} />
    )),
  ]
}

/** Datum + tijd voor tooltips (Amsterdam), e.g. "wo 3 jun 14:30"; met `withPart` ook het dagdeel
 *  ("· middag") — alleen zinvol als de grafiek dag en nacht tekent (korte vensters, kleine blokken). */
export function tooltipLabel(t: number, withPart = false): string {
  const when = new Date(t).toLocaleString('nl-NL', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  })
  return withPart ? `${when} · ${dayPart(t)}` : when
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
