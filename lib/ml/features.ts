// Feature engineering — ported from ml/features.py.
import { FeatureVector, SensorReading } from './types'

/** Encode a cyclic value (hour, dow, month) as [sin, cos]. */
export function sinCos(value: number, period: number): [number, number] {
  const angle = (2 * Math.PI * value) / period
  return [Math.sin(angle), Math.cos(angle)]
}

type NumAttr = 'co2' | 'temperature' | 'humidity'

/** Reading attribute closest to (now − hoursBack). */
function lagValue(readings: SensorReading[], hoursBack: number, attr: NumAttr): number {
  if (!readings.length) return 0
  const now = readings[readings.length - 1].timestamp
  const target = now - hoursBack * 3_600_000
  let best = readings[0]
  let bestDt = Math.abs(best.timestamp - target)
  for (const r of readings) {
    const dt = Math.abs(r.timestamp - target)
    if (dt < bestDt) {
      best = r
      bestDt = dt
    }
  }
  return best[attr]
}

function windowOf(readings: SensorReading[], hours: number): SensorReading[] {
  if (!readings.length) return []
  const now = readings[readings.length - 1].timestamp
  const cutoff = now - hours * 3_600_000
  return readings.filter((r) => r.timestamp >= cutoff)
}

function rollingMean(readings: SensorReading[], hours: number, attr: NumAttr): number {
  const w = windowOf(readings, hours)
  if (!w.length) return 0
  return w.reduce((s, r) => s + r[attr], 0) / w.length
}

function rollingStd(readings: SensorReading[], hours: number, attr: NumAttr): number {
  const w = windowOf(readings, hours)
  if (w.length < 2) return 0
  const m = w.reduce((s, r) => s + r[attr], 0) / w.length
  return Math.sqrt(w.reduce((s, r) => s + (r[attr] - m) ** 2, 0) / w.length)
}

export function buildFeatureVector(readings: SensorReading[]): FeatureVector {
  if (!readings.length) throw new Error('buildFeatureVector needs at least one reading')
  const latest = readings[readings.length - 1]
  const d = new Date(latest.timestamp)
  const [hourSin, hourCos] = sinCos(d.getHours() + d.getMinutes() / 60, 24)
  const dow = (d.getDay() + 6) % 7 // Mon=0 like Python weekday()
  const [dowSin, dowCos] = sinCos(dow, 7)
  const [monthSin, monthCos] = sinCos(d.getMonth(), 12)

  return [
    lagValue(readings, 1, 'co2'),
    lagValue(readings, 3, 'co2'),
    lagValue(readings, 6, 'co2'),
    lagValue(readings, 1, 'humidity'),
    rollingMean(readings, 24, 'co2'),
    rollingStd(readings, 24, 'co2'),
    hourSin,
    hourCos,
    dowSin,
    dowCos,
    monthSin,
    monthCos,
    latest.outdoorTemp ?? 0,
    latest.outdoorHumidity ?? 0,
    latest.windSpeed ?? 0,
    latest.windowOpen ? 1 : 0,
    latest.occupants ?? 0,
  ]
}

export interface TrainingSet {
  X: number[][]
  yCo2: number[]
  yRh: number[]
}

/** Slide a window through readings producing (X, y_co2, y_rh) at +horizonHours. */
export function buildTrainingSet(readings: SensorReading[], horizonHours = 1.0): TrainingSet {
  if (readings.length < 12) return { X: [], yCo2: [], yRh: [] }
  const X: number[][] = []
  const yCo2: number[] = []
  const yRh: number[] = []
  const start = readings[0].timestamp

  for (let i = 0; i < readings.length - 1; i++) {
    const anchor = readings[i]
    if (anchor.timestamp - start < 6 * 3_600_000) continue
    const targetTime = anchor.timestamp + horizonHours * 3_600_000
    let target: SensorReading | null = null
    for (let j = i + 1; j < readings.length; j++) {
      if (readings[j].timestamp >= targetTime) {
        target = readings[j]
        break
      }
    }
    if (!target) break
    X.push(buildFeatureVector(readings.slice(0, i + 1)))
    yCo2.push(target.co2)
    yRh.push(target.humidity)
  }
  return { X, yCo2, yRh }
}
