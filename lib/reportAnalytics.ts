// Diagnostic analytics for the court report — ported from the Flask calculations.py
// (bereken_cv_rh, detecteer_nacht_co2, bereken_langetermijntrend, bereken_tau_ach)
// plus the findings/recommendations/tips builders from report.py.
//
// All functions are pure and operate on aligned time/value arrays. Statistics
// (linear-regression p-values) use a Student-t two-sided test computed via the
// regularised incomplete beta function, matching scipy.stats.linregress closely
// enough for the significance thresholds the report uses.

import { dewpoint, mouldRisk } from './calculations'
import { wallDelta, mouldRiskWd } from './trends'
import { SensorRow } from './types'

const RED = '#DC2626'
const AMBER = '#D97706'
const GREEN = '#16A34A'

export const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0)
const std = (a: number[]) => {
  if (a.length < 2) return 0
  const m = mean(a)
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length) // population std (ddof=0), matches numpy
}
const pct = (a: number[], pred: (v: number) => boolean) => (a.length ? (a.filter(pred).length / a.length) * 100 : 0)

// ── Student-t two-sided p-value via regularised incomplete beta ───────────────

function betacf(a: number, b: number, x: number): number {
  const FPMIN = 1e-30
  let qab = a + b,
    qap = a + 1,
    qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 3e-9) break
  }
  return h
}

function gammaln(x: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2,
    -0.5395239384953e-5,
  ]
  let y = x
  let tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (let j = 0; j < 6; j++) ser += cof[j] / ++y
  return -tmp + Math.log((2.5066282746310005 * ser) / x)
}

/** Regularised incomplete beta I_x(a,b). */
function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x))
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a
  return 1 - (bt * betacf(b, a, 1 - x)) / b
}

interface LinReg {
  slope: number
  intercept: number
  r2: number
  p: number
}

/** Ordinary least-squares fit with a two-sided p-value on the slope. */
function linregress(x: number[], y: number[]): LinReg | null {
  const n = x.length
  if (n < 3) return null
  const mx = mean(x),
    my = mean(y)
  let sxx = 0,
    sxy = 0,
    syy = 0
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) ** 2
    sxy += (x[i] - mx) * (y[i] - my)
    syy += (y[i] - my) ** 2
  }
  if (sxx === 0) return null
  const slope = sxy / sxx
  const intercept = my - slope * mx
  const r = syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy)
  const r2 = r * r
  const df = n - 2
  let p = 1
  if (r2 < 1 && df > 0) {
    const t = r * Math.sqrt(df / (1 - r2))
    p = betai(df / 2, 0.5, df / (df + t * t)) // two-sided
  } else if (r2 >= 1) {
    p = 0
  }
  return { slope, intercept, r2, p }
}

// ── Source-data shaping ───────────────────────────────────────────────────────

export interface Series {
  times: Date[]
  co2: number[]
  temp: number[]
  rh: number[]
  mr: number[]
  dp: number[]
}

/** Build aligned arrays + derived mould risk / dewpoint from raw sensor rows. */
export function toSeries(rows: SensorRow[]): Series {
  const valid = rows
    .filter((r) => r.co2 != null && r.temperature != null && r.humidity != null)
    .map((r) => ({ t: new Date(r.created_at), co2: +r.co2!, temp: +r.temperature!, rh: +r.humidity! }))
    .filter((r) => !isNaN(r.t.getTime()))
    .sort((a, b) => a.t.getTime() - b.t.getTime())
  const times = valid.map((r) => r.t)
  const co2 = valid.map((r) => r.co2)
  const temp = valid.map((r) => r.temp)
  const rh = valid.map((r) => r.rh)
  const mr = valid.map((r, i) => mouldRiskWd(temp[i], rh[i], wallDelta(times[i].getHours() + times[i].getMinutes() / 60)))
  const dp = valid.map((r, i) => dewpoint(temp[i], rh[i]))
  return { times, co2, temp, rh, mr, dp }
}

// ── Humidity coefficient-of-variation interpretation ──────────────────────────

export interface CvRh {
  cv: number
  gemRh: number
  pctBoven70: number
  interpretatie: string
  kleur: string
}

export function cvRh(rh: number[]): CvRh | null {
  if (rh.length < 2) return null
  const gemRh = mean(rh)
  const cv = gemRh === 0 ? 0 : std(rh) / gemRh
  const pct70 = pct(rh, (v) => v > 70)
  let interpretatie: string, kleur: string
  if (cv < 0.05 && gemRh > 70) {
    interpretatie = 'LEKKAGE — constante vochtbron'
    kleur = RED
  } else if (cv > 0.08 && gemRh < 65) {
    interpretatie = 'GEDRAG — activiteitspieken'
    kleur = AMBER
  } else if (gemRh > 65) {
    interpretatie = 'BOUWKUNDIG — chronisch hoog'
    kleur = RED
  } else {
    interpretatie = 'NORMAAL'
    kleur = GREEN
  }
  return { cv: +cv.toFixed(4), gemRh: +gemRh.toFixed(1), pctBoven70: +pct70.toFixed(1), interpretatie, kleur }
}

// ── Night-vs-day CO₂ ──────────────────────────────────────────────────────────

export interface NachtCo2 {
  gemNacht: number
  gemDag: number
  ratio: number
  probleem: boolean
  advies: string
}

export function nachtCo2(times: Date[], co2: number[]): NachtCo2 | null {
  if (co2.length < 60) return null
  const nacht: number[] = []
  const dag: number[] = []
  for (let i = 0; i < co2.length; i++) {
    const h = times[i].getHours()
    if (h >= 23 || h < 7) nacht.push(co2[i])
    else if (h >= 9 && h < 17) dag.push(co2[i])
  }
  const gemNacht = nacht.length ? mean(nacht) : 0
  const gemDag = dag.length ? mean(dag) : 0
  const ratio = gemDag > 0 ? +(gemNacht / gemDag).toFixed(2) : 1.0
  const probleem = gemNacht > 1500 && ratio > 1.3
  return { gemNacht: Math.round(gemNacht), gemDag: Math.round(gemDag), ratio, probleem, advies: probleem ? 'Raam op kier bij slapen' : 'OK' }
}

// ── Long-term trend ───────────────────────────────────────────────────────────

export interface Trend {
  perDag: number
  deltaTotaal: number
  r2: number
  p: number
}

export function langetermijntrend(times: Date[], values: number[]): Trend | null {
  if (values.length < 12) return null
  const t0 = times[0].getTime()
  const xDays = times.map((t) => (t.getTime() - t0) / 86400000)
  if (xDays[xDays.length - 1] <= 0) return null
  const reg = linregress(xDays, values)
  if (!reg || isNaN(reg.slope)) return null
  return { perDag: reg.slope, deltaTotaal: reg.slope * xDays[xDays.length - 1], r2: reg.r2, p: reg.p }
}

// ── Ventilation (ACH) via CO₂ decay ───────────────────────────────────────────
// Pragmatic port of bereken_tau_ach: detect decay events after CO₂ peaks and fit
// an exponential to ambient via log-linear least squares (instead of scipy
// curve_fit), falling back to a concentration-based estimate when none are found.

export interface AchResult {
  nEvents: number
  tauGem: number
  achGem: number
  achMin: number | null
  voldoet: boolean
  methode: string
}

export function berekenAch(times: Date[], co2: number[]): AchResult | null {
  if (co2.length < 30) return null
  // Bucket to 5-minute means
  const buckets = new Map<number, number[]>()
  for (let i = 0; i < co2.length; i++) {
    const key = Math.floor(times[i].getTime() / 300000)
    const arr = buckets.get(key) ?? []
    arr.push(co2[i])
    buckets.set(key, arr)
  }
  const keys = [...buckets.keys()].sort((a, b) => a - b)
  const c5 = keys.map((k) => mean(buckets.get(k)!))

  const AMBIENT = 450
  const tauVals: number[] = []
  const achVals: number[] = []
  for (let i = 1; i < c5.length - 1; i++) {
    // local peak above 1200 ppm
    if (!(c5[i] >= 1200 && c5[i] >= c5[i - 1] && c5[i] >= c5[i + 1])) continue
    const end = Math.min(i + 24, c5.length - 1)
    const seg = c5.slice(i, end)
    if (seg.length < 8 || seg[seg.length - 1] >= seg[0] - 300) continue
    // log-linear fit: ln(C - ambient) = ln(C0 - ambient) - t/tau
    const tMin: number[] = []
    const lnY: number[] = []
    for (let j = 0; j < seg.length; j++) {
      const above = seg[j] - AMBIENT
      if (above <= 1) break // decayed into ambient noise
      tMin.push(j * 5)
      lnY.push(Math.log(above))
    }
    if (lnY.length < 6) continue
    const reg = linregress(tMin, lnY)
    if (!reg || reg.slope >= 0) continue
    const tau = -1 / reg.slope // minutes
    if (tau < 5 || tau > 300) continue
    tauVals.push(tau)
    achVals.push(60 / tau)
  }

  if (tauVals.length) {
    const achGem = mean(achVals)
    return {
      nEvents: tauVals.length,
      tauGem: +mean(tauVals).toFixed(1),
      achGem: +achGem.toFixed(2),
      achMin: +Math.min(...achVals).toFixed(2),
      voldoet: achGem >= 0.9,
      methode: 'decay-fit',
    }
  }
  const co2Gem = mean(co2)
  const tauS = Math.max(20, Math.min(200, 60 * (co2Gem / 800)))
  const achS = +(60 / tauS).toFixed(2)
  return { nEvents: 0, tauGem: +tauS.toFixed(1), achGem: achS, achMin: null, voldoet: achS >= 0.9, methode: 'schatting (geen decay-events gevonden)' }
}

// ── Findings, recommendations, conclusion ─────────────────────────────────────

export interface Finding {
  text: string
  color: string
}
export interface Diagnosis {
  findings: Finding[]
  recommendations: string[]
  conclusieTxt: string
  conclusieKleur: string
  sevLabel: string
  cv: CvRh | null
  ach: AchResult | null
  nacht: NachtCo2 | null
  pctMr60: number
}

export function buildDiagnosis(s: Series): Diagnosis {
  const { times, co2, rh, mr } = s
  const cv = cvRh(rh)
  const ach = berekenAch(times, co2)
  const nacht = nachtCo2(times, co2)
  const co2Trend = langetermijntrend(times, co2)
  const rhTrend = langetermijntrend(times, rh)
  const pctMr60 = pct(mr, (v) => v > 60)

  const findings: Finding[] = []
  const recommendations: string[] = []
  let conclusieTxt = 'Geen structureel probleem vastgesteld'
  let conclusieKleur = GREEN

  if (cv && cv.interpretatie.includes('LEKKAGE')) {
    findings.push({ text: 'Mogelijke lekkage — luchtvochtigheid constant hoog', color: RED })
    conclusieTxt = 'Bouwkundig gebrek — verhuurder verantwoordelijk'
    conclusieKleur = RED
  }
  if (pctMr60 > 30) {
    findings.push({ text: `Schimmelrisico te hoog: ${pctMr60.toFixed(1)}% van de tijd > 60/100`, color: RED })
    conclusieTxt = 'Bouwkundig gebrek — verhuurder verantwoordelijk'
    conclusieKleur = RED
  }
  if (cv && cv.interpretatie.includes('BOUWKUNDIG')) {
    findings.push({ text: 'Luchtvochtigheid structureel hoog — geen activiteitspatroon', color: RED })
  }
  if (cv && cv.interpretatie.includes('GEDRAG')) {
    findings.push({ text: 'Vochtigheidspieken zichtbaar — gedragspatroon (koken/douchen)', color: AMBER })
    if (conclusieKleur !== RED) {
      conclusieTxt = 'Ventilatie-advies — bewonersgedrag heeft grote invloed'
      conclusieKleur = AMBER
    }
  }
  if (ach && !ach.voldoet) {
    findings.push({ text: `Ventilatie onder norm — ACH = ${ach.achGem} (Bouwbesluit: ≥ 0,9)`, color: AMBER })
  }
  if (nacht && nacht.probleem) {
    findings.push({ text: "CO₂ loopt 's nachts op — slaapkamer onvoldoende geventileerd", color: AMBER })
  }
  if (co2Trend && co2Trend.p < 0.1 && co2Trend.deltaTotaal > 120) {
    findings.push({ text: `CO₂ stijgt in periode (+${co2Trend.deltaTotaal.toFixed(0)} ppm)`, color: RED })
  }
  if (rhTrend && rhTrend.p < 0.1 && rhTrend.deltaTotaal > 4) {
    findings.push({ text: `Luchtvochtigheid stijgt (+${rhTrend.deltaTotaal.toFixed(1)}%)`, color: AMBER })
  }

  if (pctMr60 > 30) recommendations.push('Thermografisch onderzoek om koudebruggen te lokaliseren')
  if (cv && cv.interpretatie.includes('LEKKAGE')) recommendations.push('Vochtmeting achter wanden — officieel melden bij verhuurder')
  if (cv && cv.interpretatie.includes('GEDRAG')) recommendations.push('30 min. ventileren na douchen/koken met mechanische afzuiging')
  if (ach && !ach.voldoet) recommendations.push('Ventilatiesysteem laten controleren/reinigen')
  if (nacht && nacht.probleem) recommendations.push("Slaapkamerraam elke nacht op een kier (ook 's winters)")
  if (co2Trend && co2Trend.deltaTotaal > 120) recommendations.push('Ventilatiefilter controleren op verstopping of slijtage')

  // Keep the headline consistent with the findings: if anything was flagged but
  // nothing rose to a structural defect, say "let op" rather than "alles in orde".
  if (findings.length && conclusieKleur === GREEN) {
    conclusieKleur = AMBER
    conclusieTxt = 'Aandachtspunten gevonden — geen acuut bouwkundig gebrek'
  }

  const sevLabel = conclusieKleur === RED ? 'Actie vereist' : conclusieKleur === AMBER ? 'Let op' : 'Alles in orde'
  return { findings, recommendations, conclusieTxt, conclusieKleur, sevLabel, cv, ach, nacht, pctMr60 }
}

// ── Personalized resident tips ────────────────────────────────────────────────

export interface Tip {
  severity: 'critical' | 'warning' | 'info' | 'ok'
  title: string
  text: string
}

interface WeatherCtx {
  temp?: number | null
  humidity?: number | null
}

export function buildTips(s: Series, d: Diagnosis, weather?: WeatherCtx | null): Tip[] {
  const { co2, rh } = s
  const tips: Tip[] = []
  const avgCo2 = mean(co2)
  const avgRh = mean(rh)
  const pct1000 = pct(co2, (v) => v > 1000)
  const pct800 = pct(co2, (v) => v > 800)
  const { cv, ach, nacht, pctMr60 } = d

  if (nacht && nacht.probleem) {
    tips.push({
      severity: 'critical',
      title: "Slaapkamer-CO2 te hoog 's nachts",
      text: `Gemiddeld ${nacht.gemNacht} ppm tijdens slaapuren (norm: < 1000 ppm). Zet elke avond een raam op een kier — zelfs 2–3 cm is genoeg om CO₂ te halveren. In de winter werkt ook een ventilatierooster in de slaapkamerdeur. Daggemiddelde ter vergelijking: ${nacht.gemDag} ppm.`,
    })
  }
  if (pct1000 > 20) {
    tips.push({
      severity: 'critical',
      title: 'CO₂ structureel boven norm',
      text: `${pct1000.toFixed(0)}% van de gemeten tijd overschrijdt CO₂ de Bouwbesluit-grens van 1000 ppm. Controleer of ventilatieroosters niet zijn dichtgeplakt of afgedekt. Laat de mechanische ventilatie reinigen — een verstopt filter halveert de capaciteit. Bij huurwoning: verhuurder is verantwoordelijk voor het ventilatiesysteem.`,
    })
  } else if (pct800 > 35) {
    tips.push({
      severity: 'warning',
      title: 'CO₂ regelmatig te hoog',
      text: `CO₂ zit ${pct800.toFixed(0)}% van de tijd boven 800 ppm (gemiddeld ${Math.round(avgCo2)} ppm). Ventileer elke ochtend 10 minuten met ramen open. Na het koken altijd de afzuigkap gebruiken en daarna 15 minuten ramen open. Bij meer dan 2 personen in de slaapkamer: extra ventilatie is noodzakelijk.`,
    })
  }
  if (cv && cv.interpretatie.includes('LEKKAGE')) {
    tips.push({
      severity: 'critical',
      title: 'Vermoedelijke vochtlekkage — verhuurder aansprakelijk',
      text: 'De luchtvochtigheid is constant hoog en nauwelijks variabel. Dit profiel past bij een vochtbron achter de wanden (lekkage, optrekkend vocht of condensatie op koudebruggen) — geen gedragspatroon. Documenteer dit rapport en dien een officiële klacht in bij uw verhuurder of woningcorporatie. Vraag om een bouwkundige inspectie met vochtmeting.',
    })
  } else if (cv && cv.interpretatie.includes('BOUWKUNDIG')) {
    tips.push({
      severity: 'critical',
      title: 'Structureel hoge luchtvochtigheid',
      text: 'De luchtvochtigheid is structureel te hoog zonder duidelijke activiteitspieken. Dit wijst op onvoldoende isolatie of bouwkundige tekortkomingen. Controleer koudebruggen: raamkozijnen, hoeken van buitenmuren en ventilatieopeningen. Meld dit bij uw verhuurder met dit rapport als onderbouwing.',
    })
  }
  if (cv && cv.interpretatie.includes('GEDRAG')) {
    tips.push({
      severity: 'info',
      title: 'Ventileer na douchen en koken',
      text: 'Vochtigheidspieken zijn zichtbaar in de data — typisch voor douchen en koken. Praktische gewoonten: (1) Afzuigkap altijd aan tijdens het koken en 15 min. daarna. (2) Na het douchen badkamerdeur dicht, raam open — minimaal 20 minuten. (3) Geen vochtige was drogen in slaapkamer of woonkamer zonder extra ventilatie. Dit kan de RV met 5–10% verlagen.',
    })
  }
  if (pctMr60 > 40) {
    tips.push({
      severity: 'critical',
      title: `Kritiek schimmelrisico (${pctMr60.toFixed(0)}% van de tijd)`,
      text: 'Controleer nu de volgende plekken op zichtbare schimmel: hoeken van slaapkamers en woonkamer (vooral bij buitenmuren), achter kasten die tegen buitenmuren staan, en rond raamkozijnen. Houd kasten minimaal 5 cm van koude wanden. Bij zichtbare schimmel: dit is een gebrek dat meldingsplichtig is bij de verhuurder.',
    })
  } else if (pctMr60 > 15) {
    tips.push({
      severity: 'warning',
      title: 'Verhoogd schimmelrisico — preventie nodig',
      text: `Schimmelrisico is ${pctMr60.toFixed(0)}% van de tijd verhoogd (> 60/100). Luchtvochtigheid gemiddeld ${avgRh.toFixed(1)}% — streef naar < 60%. Gebruik een hygrometer in slaap- en badkamer als check. Ventileer gericht en houd verwarmingstemperatuur constant (grote temperatuurschommelingen vergroten het risico).`,
    })
  }
  if (ach && !ach.voldoet) {
    tips.push({
      severity: 'warning',
      title: `Ventilatieprestatie onder norm (ACH = ${ach.achGem})`,
      text: `De gemeten ventilatiesnelheid is ${ach.achGem} luchtverversingen per uur — onder de wettelijke norm van 0,9. Controleer en reinig alle ventilatieroosters. Laat het mechanische systeem controleren door een installateur. Bij huurwoning: verhuurder is wettelijk verplicht tot onderhoud van het ventilatiesysteem.`,
    })
  }
  if (weather && weather.humidity != null && avgRh > 62) {
    const outRh = +weather.humidity
    if (outRh < avgRh - 15) {
      tips.push({
        severity: 'info',
        title: 'Optimaal ventilatiemoment: nu',
        text: `Buitenlucht (${Math.round(outRh)}% RV) is significant droger dan binnen (${avgRh.toFixed(1)}% RV). Ventileer overdag actief — koude buitenlucht is in de winter relatief droog en heeft na opwarming een lage RV. Ideaal om vocht kwijt te raken.`,
      })
    } else if (outRh > avgRh + 12) {
      tips.push({
        severity: 'info',
        title: 'Ventileer op droge momenten',
        text: `Buitenlucht (${Math.round(outRh)}% RV) is vochtiger dan binnen. Ventileer bij voorkeur op droge, zonnige momenten. Bij regen: ventilatie via het mechanische systeem is beter dan ramen openen.`,
      })
    }
  }
  if (!tips.length) {
    tips.push({
      severity: 'ok',
      title: 'Luchtkwaliteit voldoet aan alle normen',
      text: 'Goed gedaan! Handige gewoonten om dit vol te houden: ventileer elke ochtend 10 minuten, gebruik altijd de afzuigkap bij het koken, controleer jaarlijks de ventilatieroosters op stof en verstoppingen, en houd de luchtvochtigheid onder 60%.',
    })
  }
  return tips
}

// Re-export for callers that want the raw mould risk used on the dashboard scale.
export { mouldRisk }
