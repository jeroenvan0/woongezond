// B5 — weekly household summary. A pure, unit-tested function that turns a week of
// readings into a friendly Dutch email. Kept side-effect-free so it can be tested without
// a database or mail provider; the route (app/api/digest/weekly) does the I/O.

export interface DigestRow {
  created_at: string | Date
  co2: number | null
  temperature: number | null
  humidity: number | null
}

export interface WeeklyDigest {
  hasData: boolean
  subject: string
  text: string
  stats: {
    readings: number
    avgCo2: number | null
    maxCo2: number | null
    pctCo2Over1000: number | null
    avgRh: number | null
    pctRhOver70: number | null
  }
}

const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null)
const pct = (a: number[], pred: (v: number) => boolean) => (a.length ? (100 * a.filter(pred).length) / a.length : null)
const round = (v: number | null, d = 0) => (v == null ? null : +v.toFixed(d))

/**
 * Build the weekly digest for one household. `deviceLabel` names the sensor/room in the
 * copy; `rows` is the last ~7 days of (optionally bucketed) readings.
 */
export function buildWeeklyDigest(rows: DigestRow[], deviceLabel = 'je woning'): WeeklyDigest {
  const co2 = rows.map((r) => r.co2).filter((v): v is number => v != null)
  const rh = rows.map((r) => r.humidity).filter((v): v is number => v != null)

  const stats = {
    readings: rows.length,
    avgCo2: round(avg(co2)),
    maxCo2: co2.length ? Math.round(Math.max(...co2)) : null,
    pctCo2Over1000: round(pct(co2, (v) => v > 1000)),
    avgRh: round(avg(rh)),
    pctRhOver70: round(pct(rh, (v) => v > 70)),
  }

  if (rows.length === 0) {
    return {
      hasData: false,
      subject: 'Je weekoverzicht van Woongezond',
      text: `Deze week zijn er geen metingen binnengekomen voor ${deviceLabel}. Staat de sensor aan en heeft hij wifi? Neem bij twijfel contact op met je corporatie.`,
      stats,
    }
  }

  // A small, honest verdict + one actionable tip, in plain Dutch.
  const lines: string[] = []
  lines.push(`Hier is je weekoverzicht voor ${deviceLabel}.`)
  lines.push('')

  if (stats.avgCo2 != null) {
    const co2Verdict = stats.avgCo2 < 800 ? 'goed geventileerd' : stats.avgCo2 < 1100 ? 'redelijk' : 'vaak te benauwd'
    lines.push(`• CO₂: gemiddeld ${stats.avgCo2} ppm (${co2Verdict}), piek ${stats.maxCo2} ppm.`)
    if (stats.pctCo2Over1000 != null && stats.pctCo2Over1000 >= 20) {
      lines.push(`  ${stats.pctCo2Over1000}% van de tijd boven 1000 ppm — vaker en korter luchten helpt.`)
    }
  }
  if (stats.avgRh != null) {
    const rhVerdict = stats.avgRh < 40 ? 'aan de droge kant' : stats.avgRh <= 60 ? 'prima' : 'aan de vochtige kant'
    lines.push(`• Luchtvochtigheid: gemiddeld ${stats.avgRh}% (${rhVerdict}).`)
    if (stats.pctRhOver70 != null && stats.pctRhOver70 >= 15) {
      lines.push(`  ${stats.pctRhOver70}% van de tijd boven 70% — let op vocht in badkamer/keuken en lucht na douchen/koken.`)
    }
  }

  lines.push('')
  lines.push('Bekijk de details in je dashboard. Fijne, gezonde week!')

  const headline = (stats.pctRhOver70 ?? 0) >= 15 || (stats.avgCo2 ?? 0) >= 1100
    ? 'Je weekoverzicht — een paar aandachtspunten'
    : 'Je weekoverzicht — het ziet er goed uit'

  return { hasData: true, subject: `${headline} · Woongezond`, text: lines.join('\n'), stats }
}
