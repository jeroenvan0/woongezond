// Night CO₂ outlook — answers the actionable question "should I ventilate before
// bed tonight?" by learning the resident's OWN overnight pattern rather than
// extrapolating the short-horizon ridge model 8 hours out.
//
// For each recent night we measure the evening baseline (~21–23h) and the
// overnight peak (23–07h); the typical rise between them, applied to tonight's
// current level, projects how high CO₂ will climb while sleeping.

export interface NightReading {
  timestamp: number
  co2: number
}

export interface NightOutlook {
  nightsUsed: number
  typicalPeak: number // median overnight peak across recent nights (ppm)
  typicalRise: number // median (peak − evening baseline) (ppm)
  predictedPeak: number // projection for the coming night (ppm)
  basis: 'tonight' | 'typical' // whether projection started from a live evening reading
  level: 'ok' | 'warning' | 'critical'
  advice: string
}

const median = (a: number[]): number => {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

/**
 * @param readings sorted-or-unsorted CO₂ readings (local-time timestamps in ms)
 * @param nowMs    current time (ms) — drives whether we project from tonight's live level
 */
export function nightForecast(readings: NightReading[], nowMs: number): NightOutlook | null {
  if (readings.length < 24) return null
  const rs = [...readings].filter((r) => Number.isFinite(r.co2)).sort((a, b) => a.timestamp - b.timestamp)

  // Bucket evening (21–23h) and night (23h→07h) readings per night.
  const evening = new Map<string, number[]>()
  const night = new Map<string, number[]>()
  for (const r of rs) {
    const d = new Date(r.timestamp)
    const h = d.getHours()
    if (h >= 21 && h < 23) {
      const k = dayKey(d)
      ;(evening.get(k) ?? evening.set(k, []).get(k)!).push(r.co2)
    } else if (h >= 23) {
      const k = dayKey(d)
      ;(night.get(k) ?? night.set(k, []).get(k)!).push(r.co2)
    } else if (h < 7) {
      const prev = new Date(r.timestamp - 24 * 3600000)
      const k = dayKey(prev)
      ;(night.get(k) ?? night.set(k, []).get(k)!).push(r.co2)
    }
  }

  const peaks: number[] = []
  const rises: number[] = []
  for (const [k, vals] of night) {
    if (vals.length < 4) continue
    const peak = Math.max(...vals)
    peaks.push(peak)
    const ev = evening.get(k)
    const baseline = ev && ev.length ? ev.reduce((s, v) => s + v, 0) / ev.length : Math.min(...vals)
    rises.push(Math.max(0, peak - baseline))
  }
  if (peaks.length < 2) return null

  const typicalPeak = Math.round(median(peaks))
  const typicalRise = Math.round(median(rises))

  // Project tonight. If a fresh reading exists in the evening/early-night window,
  // start from it; otherwise fall back to the typical peak.
  const latest = rs[rs.length - 1]
  const latestAge = nowMs - latest.timestamp
  const latestHour = new Date(latest.timestamp).getHours()
  const isEvening = latestHour >= 19 || latestHour < 2
  let predictedPeak: number
  let basis: 'tonight' | 'typical'
  if (latestAge < 2 * 3600000 && isEvening) {
    predictedPeak = Math.round(Math.max(latest.co2, latest.co2 + typicalRise))
    basis = 'tonight'
  } else {
    predictedPeak = typicalPeak
    basis = 'typical'
  }
  predictedPeak = Math.min(3500, predictedPeak)

  let level: NightOutlook['level']
  let advice: string
  if (predictedPeak >= 1500) {
    level = 'critical'
    advice = 'Zet vanavond een raam op een kier of de ventilatie hoger — anders loopt de CO₂ vannacht ver boven de norm.'
  } else if (predictedPeak >= 1000) {
    level = 'warning'
    advice = 'Ventileer voor het slapen (raam op een kier of slaapkamerrooster open) om boven de 1000 ppm uit te blijven.'
  } else {
    level = 'ok'
    advice = 'De slaapkamer blijft naar verwachting onder de norm. Lichte ventilatie houdt het fris.'
  }

  return { nightsUsed: peaks.length, typicalPeak, typicalRise, predictedPeak, basis, level, advice }
}

// ── Night-by-night analysis (used by the AI chat to compare nights) ───────────

export interface NightStat {
  dateMs: number
  peak: number
  baseline: number
  rise: number
}

export interface NightsAnalysis {
  nights: NightStat[] // chronological
  last: NightStat
  medianPeak: number
  medianRise: number
  lastPeakVsMedian: number // last.peak − median (negative = better/lower)
}

export function analyzeNights(readings: NightReading[], nowMs: number): NightsAnalysis | null {
  if (readings.length < 24) return null
  const rs = [...readings].filter((r) => Number.isFinite(r.co2)).sort((a, b) => a.timestamp - b.timestamp)

  const evening = new Map<string, number[]>()
  const night = new Map<string, number[]>()
  const keyMs = new Map<string, number>()
  const noteDay = (k: string, d: Date) => keyMs.set(k, new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime())

  for (const r of rs) {
    const d = new Date(r.timestamp)
    const h = d.getHours()
    if (h >= 21 && h < 23) {
      const k = dayKey(d)
      ;(evening.get(k) ?? evening.set(k, []).get(k)!).push(r.co2)
      noteDay(k, d)
    } else if (h >= 23) {
      const k = dayKey(d)
      ;(night.get(k) ?? night.set(k, []).get(k)!).push(r.co2)
      noteDay(k, d)
    } else if (h < 7) {
      const prev = new Date(r.timestamp - 24 * 3600000)
      const k = dayKey(prev)
      ;(night.get(k) ?? night.set(k, []).get(k)!).push(r.co2)
      noteDay(k, prev)
    }
  }

  const nights: NightStat[] = []
  for (const [k, vals] of night) {
    if (vals.length < 4) continue
    const peak = Math.max(...vals)
    const ev = evening.get(k)
    const baseline = ev && ev.length ? ev.reduce((s, v) => s + v, 0) / ev.length : Math.min(...vals)
    nights.push({ dateMs: keyMs.get(k) ?? 0, peak, baseline, rise: Math.max(0, peak - baseline) })
  }
  if (nights.length < 2) return null
  nights.sort((a, b) => a.dateMs - b.dateMs)

  const medianPeak = median(nights.map((n) => n.peak))
  const medianRise = median(nights.map((n) => n.rise))
  const last = nights[nights.length - 1]
  return { nights, last, medianPeak: Math.round(medianPeak), medianRise: Math.round(medianRise), lastPeakVsMedian: Math.round(last.peak - medianPeak) }
}
