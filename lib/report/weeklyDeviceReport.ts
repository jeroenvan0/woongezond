// Weekrapport per SENSOR (laag A + laag B, docs/pilot-cockpit-plan.md §2c).
//
// Pure functie: een week aan metingen van één device + het huisprofiel + de voornaam uit
// device_contacts → onderwerp, platte tekst en HTML voor de weekmail. Geen I/O, zodat
// het zonder database of mailprovider te testen is; scripts/report-preview.mts en de
// weekmail-route doen het ophalen en versturen.
//
// Hergebruikt de rapport-analytics van /report (buildDiagnosis, buildTips) zodat de mail
// nooit iets anders zegt dan het rapport in de app. Meetdekking en gaten worden eerlijk
// benoemd (lib/coverage): een week met 11 uur data is geen "goede week".

import { SensorRow } from '@/lib/types'
import { toSeries, buildDiagnosis, buildTips, mean, Tip } from '@/lib/reportAnalytics'
import { measurementCoverage, detectGaps } from '@/lib/coverage'
import { HouseProfile, QUESTIONS } from '@/lib/houseProfile'

export interface ReportDevice {
  number: number | null
  room: string | null              // devices.location / house_profile.room
  profile: Partial<HouseProfile> | null
}
export interface ReportContact { name: string | null }
export interface ReportLinks {
  report?: string                  // ondertekende link naar /rapport?t=… (later)
  unsubscribe?: string
}
export interface ReportPeriod { start: Date; end: Date }

export interface WeeklyDeviceReport {
  hasData: boolean
  subject: string
  text: string
  html: string
  verdict: 'ok' | 'warning' | 'critical' | 'nodata'
  stats: {
    readings: number
    hoursCovered: number
    avgCo2: number | null
    maxCo2: number | null
    pctCo2Over1000: number | null
    nightCo2: number | null
    avgRh: number | null
    avgTemp: number | null
    gaps: number
  }
  tips: Tip[]
}

const TZ = 'Europe/Amsterdam'
const fmtDay = (d: Date) => d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', timeZone: TZ })
const fmtDayTime = (d: Date) => d.toLocaleString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ })
const r0 = (v: number | null) => (v == null || Number.isNaN(v) ? null : Math.round(v))
const r1 = (v: number | null) => (v == null || Number.isNaN(v) ? null : +v.toFixed(1))
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function optionLabel(key: keyof HouseProfile, value: string | undefined): string | null {
  if (!value) return null
  return QUESTIONS.find((q) => q.key === key)?.options.find((o) => o.value === value)?.label ?? null
}

function firstName(name: string | null): string | null {
  const n = (name ?? '').trim()
  if (!n) return null
  if (/^fam\.?\s/i.test(n)) return null          // "Fam. Jansen" → geen voornaam
  return n.split(/\s+/)[0]
}

function deviceLabel(d: ReportDevice): string {
  const num = d.number != null ? `sensor ${String(d.number).padStart(2, '0')}` : 'je sensor'
  const room = d.room ? optionLabel('room', d.room) ?? d.room : null
  return room ? `${num} (${room.toLowerCase()})` : num
}

// Eén extra tip uit het huisprofiel, alleen als die past bij wat er gemeten is.
function profileTip(p: Partial<HouseProfile> | null, stats: WeeklyDeviceReport['stats']): Tip | null {
  if (!p) return null
  const occ = p.occupants && p.occupants !== '0' ? p.occupants : null
  if (p.room === 'slaapkamer' && occ && occ !== '1' && p.ventilation === 'raam' && (stats.nightCo2 ?? 0) > 900) {
    return {
      severity: 'info',
      title: `Met ${occ === '4+' ? '4 of meer' : occ} personen in de slaapkamer loopt CO₂ snel op`,
      text: 'Je gaf aan dat de slaapkamer alleen via het raam ventileert. Twee slapers produceren samen zo\'n 40 liter CO₂ per uur; zonder aanvoer van buitenlucht zit je binnen een paar uur boven de 1000 ppm. Een raam 2–3 cm op kier de hele nacht is effectiever dan ’s ochtends kort wijd open.',
    }
  }
  if ((p.laundry_indoors === 'soms' || p.laundry_indoors === 'vaak') && (stats.avgRh ?? 0) >= 58) {
    return {
      severity: 'info',
      title: 'Was drogen binnen: een emmer water in de lucht',
      text: 'Een wasje van 5 kg verdampt 2 tot 3 liter water in je woning. Met een luchtvochtigheid rond de 60% is dat precies wat je niet wilt. Droog de was in een kamer met het raam open en de deur dicht, of buiten zodra het droog is.',
    }
  }
  if (p.moisture === 'condens' && (stats.avgRh ?? 0) >= 55) {
    return {
      severity: 'info',
      title: 'Condens op de ramen? Dat is een vochtsignaal',
      text: 'Je gaf aan dat er condens op de ramen staat. Dat gebeurt als warme, vochtige binnenlucht een koud oppervlak raakt. Elke ochtend 10 minuten ventileren met het raam wijd open verwijdert het vocht van de nacht. Blijft het aanhouden bij een luchtvochtigheid onder 55%, dan is het een isolatie-kwestie voor de verhuurder.',
    }
  }
  return null
}

export function buildWeeklyDeviceReport(
  rows: SensorRow[],
  device: ReportDevice,
  contact: ReportContact,
  period: ReportPeriod,
  links: ReportLinks = {},
): WeeklyDeviceReport {
  const label = deviceLabel(device)
  const name = firstName(contact.name)
  const hello = name ? `Hoi ${name},` : 'Hallo,'
  const periodTxt = `${fmtDay(period.start)} – ${fmtDay(period.end)}`

  const s = toSeries(rows)
  const coverage = measurementCoverage(rows)
  const gaps = detectGaps(rows)
  // Uren met data: aantal metingen × mediane interval, afgetopt op de week.
  const hoursCovered = s.times.length >= 2 ? Math.min(168, +((rows.length * medianIntervalMs(s.times)) / 3600000).toFixed(1)) : 0

  const emptyStats: WeeklyDeviceReport['stats'] = {
    readings: rows.length, hoursCovered, avgCo2: null, maxCo2: null, pctCo2Over1000: null, nightCo2: null, avgRh: null, avgTemp: null, gaps: gaps.length,
  }

  if (s.times.length < 30) {
    const text = [
      hello, '',
      `Deze week (${periodTxt}) zijn er ${rows.length === 0 ? 'geen' : 'te weinig'} metingen binnengekomen van ${label}, dus er is geen weekrapport te maken.`,
      '',
      'Meestal betekent dit dat de sensor geen stroom of geen wifi had. Check:',
      '• Brandt er een lampje op de sensor? Zo niet: zit de stekker erin?',
      '• Knippert het rode lampje 2× achter elkaar? Dan heeft hij geen wifi. Zie de handleiding, of houd de knop 10 seconden ingedrukt om het wifi opnieuw in te stellen.',
      '',
      'Zodra de sensor weer meet, krijg je volgende week gewoon een rapport.',
      '', footerText(links),
    ].join('\n')
    return {
      hasData: false, verdict: 'nodata',
      subject: `Weekrapport ${label}: geen metingen · Woongezond`,
      text, html: wrapHtml(`Weekrapport · ${esc(label)}`, periodTxt, [
        `<p>${esc(hello)}</p>`,
        `<p>Deze week zijn er ${rows.length === 0 ? 'geen' : 'te weinig'} metingen binnengekomen van <strong>${esc(label)}</strong>, dus er is geen weekrapport te maken.</p>`,
        `<p>Meestal betekent dit dat de sensor geen stroom of geen wifi had.</p>`,
        `<ul><li>Brandt er een lampje op de sensor? Zo niet: zit de stekker erin?</li><li>Knippert het rode lampje 2× achter elkaar? Dan heeft hij geen wifi. Houd de knop 10 seconden ingedrukt om het wifi opnieuw in te stellen.</li></ul>`,
        `<p>Zodra de sensor weer meet, krijg je volgende week gewoon een rapport.</p>`,
      ].join(''), links, 'nodata'),
      stats: emptyStats, tips: [],
    }
  }

  const d = buildDiagnosis(s)
  const pct1000 = (100 * s.co2.filter((v) => v > 1000).length) / s.co2.length
  const stats: WeeklyDeviceReport['stats'] = {
    readings: rows.length,
    hoursCovered,
    avgCo2: r0(mean(s.co2)),
    maxCo2: r0(Math.max(...s.co2)),
    pctCo2Over1000: r0(pct1000),
    nightCo2: d.nacht ? r0(d.nacht.gemNacht) : null,
    avgRh: r1(mean(s.rh)),
    avgTemp: r1(mean(s.temp)),
    gaps: gaps.length,
  }

  // Tips: die van het rapport, plus hooguit één uit het huisprofiel; max 4, ernstigste eerst.
  const order = { critical: 0, warning: 1, info: 2, ok: 3 }
  const tips = [...buildTips(s, d, null)]
  const extra = profileTip(device.profile, stats)
  if (extra && !tips.some((t) => t.severity === 'ok')) tips.push(extra)
  tips.sort((a, b) => order[a.severity] - order[b.severity])
  const shown = tips.slice(0, 4)

  const verdict: WeeklyDeviceReport['verdict'] = tips.some((t) => t.severity === 'critical') ? 'critical' : tips.some((t) => t.severity === 'warning' || t.severity === 'info') ? 'warning' : 'ok'
  const headline = verdict === 'ok' ? 'het ziet er goed uit' : verdict === 'critical' ? 'dit vraagt aandacht' : 'een paar aandachtspunten'

  // ── Hoe ging het ─────────────────────────────────────────────
  const co2Word = stats.avgCo2! < 800 ? 'goed geventileerd' : stats.avgCo2! < 1000 ? 'redelijk, maar aan de hoge kant' : 'vaak te benauwd'
  const rhWord = stats.avgRh! < 40 ? 'aan de droge kant' : stats.avgRh! <= 60 ? 'prima' : 'aan de vochtige kant'
  const howLines: string[] = []
  howLines.push(`CO₂ was gemiddeld ${stats.avgCo2} ppm (${co2Word}), met een piek van ${stats.maxCo2} ppm.`)
  if (stats.pctCo2Over1000! > 0) howLines.push(`${stats.pctCo2Over1000}% van de tijd zat de lucht boven de 1000 ppm, de grens waarboven je ’s ochtends minder uitgerust wakker wordt.`)
  if (d.nacht) howLines.push(`’s Nachts (23–7 u) gemiddeld ${stats.nightCo2} ppm, overdag ${r0(d.nacht.gemDag)} ppm.`)
  howLines.push(`Luchtvochtigheid gemiddeld ${stats.avgRh}% (${rhWord}) bij ${stats.avgTemp} °C.`)
  const best = bestAndWorstDay(s)
  if (best) howLines.push(`Beste dag: ${best.best.day} (${best.best.co2} ppm). Zwaarste dag: ${best.worst.day} (${best.worst.co2} ppm).`)

  // ── Meetdekking ──────────────────────────────────────────────
  const covLines: string[] = []
  covLines.push(`${rows.length} metingen, ongeveer ${Math.round(hoursCovered)} van de 168 uur${coverage ? `, op ${coverage.days} ${coverage.days === 1 ? 'dag' : 'dagen'}` : ''}.`)
  for (const g of gaps.slice(0, 3)) covLines.push(`Geen metingen van ${fmtDayTime(new Date(g.startMs))} tot ${fmtDayTime(new Date(g.endMs))} (${g.hours >= 24 ? `${(g.hours / 24).toFixed(1)} dagen` : `${Math.round(g.hours)} uur`}).`)
  if (gaps.length > 3) covLines.push(`… en nog ${gaps.length - 3} kortere onderbrekingen.`)
  const lowCoverage = hoursCovered < 84
  if (lowCoverage) covLines.push('Minder dan de helft van de week gemeten: de cijfers hierboven zeggen alleen iets over de uren mét data.')

  // ── Tekstversie ──────────────────────────────────────────────
  const text = [
    hello, '',
    `Dit is je weekrapport voor ${label}, ${periodTxt}: ${headline}.`,
    '', 'HOE GING HET',
    ...howLines.map((l) => `• ${l}`),
    '', 'TIPS VOOR KOMENDE WEEK',
    ...shown.flatMap((t) => [`${sevMark(t.severity)} ${t.title}`, `  ${t.text}`, '']),
    'MEETDEKKING',
    ...covLines.map((l) => `• ${l}`),
    '', footerText(links),
  ].join('\n')

  // ── HTML ─────────────────────────────────────────────────────
  // Inline-blocks i.p.v. een 4-koloms tabel: op een telefoon (≤ 400 px) vouwen ze vanzelf naar 2×2,
  // zonder media queries (die niet elke mailclient respecteert).
  const kpi = (v: string, k: string) => `<div style="display:inline-block;vertical-align:top;box-sizing:border-box;width:23%;min-width:120px;margin:0 1% 8px;padding:12px 8px;text-align:center;font-size:15px;border:1px solid #E2E8F0;border-radius:8px;background:#F8FAFC"><div style="font-size:22px;font-weight:700;color:#0F172A;white-space:nowrap">${v}</div><div style="font-size:12px;color:#64748B;margin-top:2px">${k}</div></div>`
  const body = [
    `<p style="margin:0 0 12px">${esc(hello)}</p>`,
    `<p style="margin:0 0 18px">Dit is je weekrapport voor <strong>${esc(label)}</strong>: <strong>${esc(headline)}</strong>.</p>`,
    `<div style="margin:0 -1% 12px;font-size:0">`,
    kpi(`${stats.avgCo2} <span style="font-size:12px;font-weight:400">ppm</span>`, 'CO₂ gemiddeld'),
    kpi(`${stats.maxCo2} <span style="font-size:12px;font-weight:400">ppm</span>`, 'CO₂ piek'),
    kpi(`${stats.avgRh}<span style="font-size:12px;font-weight:400">%</span>`, 'luchtvochtigheid'),
    kpi(`${stats.avgTemp}<span style="font-size:12px;font-weight:400"> °C</span>`, 'temperatuur'),
    `</div>`,
    section('Hoe ging het', `<ul style="margin:0;padding-left:18px">${howLines.map((l) => `<li style="margin:0 0 6px">${esc(l)}</li>`).join('')}</ul>`),
    section('Tips voor komende week', shown.map((t) => `<div style="margin:0 0 14px;padding:12px 14px;border-left:4px solid ${sevColor(t.severity)};background:#F8FAFC;border-radius:0 8px 8px 0"><div style="font-weight:600;margin:0 0 4px">${esc(t.title)}</div><div style="color:#334155">${esc(t.text)}</div></div>`).join('')),
    section('Meetdekking', `<ul style="margin:0;padding-left:18px;color:${lowCoverage ? '#B45309' : '#475569'}">${covLines.map((l) => `<li style="margin:0 0 4px">${esc(l)}</li>`).join('')}</ul>`),
  ].join('')

  return {
    hasData: true, verdict,
    subject: `Weekrapport ${label}: ${headline} · Woongezond`,
    text, html: wrapHtml(`Weekrapport · ${esc(label)}`, periodTxt, body, links, verdict),
    stats, tips: shown,
  }
}

// ── helpers ───────────────────────────────────────────────────

function medianIntervalMs(times: Date[]): number {
  const deltas: number[] = []
  for (let i = 1; i < times.length; i++) deltas.push(times[i].getTime() - times[i - 1].getTime())
  deltas.sort((a, b) => a - b)
  return deltas[Math.floor(deltas.length / 2)] || 60000
}

function bestAndWorstDay(s: ReturnType<typeof toSeries>): { best: { day: string; co2: number }; worst: { day: string; co2: number } } | null {
  const byDay = new Map<string, number[]>()
  s.times.forEach((t, i) => {
    const k = t.toLocaleDateString('nl-NL', { weekday: 'long', timeZone: TZ })
    byDay.set(k, [...(byDay.get(k) ?? []), s.co2[i]])
  })
  const days = [...byDay.entries()].filter(([, v]) => v.length >= 60).map(([day, v]) => ({ day, co2: Math.round(mean(v)) }))
  if (days.length < 2) return null
  days.sort((a, b) => a.co2 - b.co2)
  return { best: days[0], worst: days[days.length - 1] }
}

const sevMark = (s: Tip['severity']) => (s === 'critical' ? '!!' : s === 'warning' ? '!' : s === 'ok' ? '✓' : '→')
const sevColor = (s: Tip['severity']) => (s === 'critical' ? '#DC2626' : s === 'warning' ? '#B45309' : s === 'ok' ? '#15803D' : '#0B7A5C')
const verdictColor = (v: WeeklyDeviceReport['verdict']) => (v === 'critical' ? '#DC2626' : v === 'warning' ? '#B45309' : v === 'nodata' ? '#64748B' : '#15803D')

function section(title: string, inner: string): string {
  return `<h2 style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#64748B;margin:22px 0 8px">${esc(title)}</h2>${inner}`
}

function footerText(links: ReportLinks): string {
  const l: string[] = []
  if (links.report) l.push(`Volledig rapport met grafieken: ${links.report}`)
  l.push('Je krijgt deze mail omdat je bij het instellen van de sensor om een weekrapport hebt gevraagd. Alleen jij ontvangt de metingen van jouw sensor; de corporatie ziet uitsluitend cijfers zonder naam of adres.')
  if (links.unsubscribe) l.push(`Geen rapport meer ontvangen: ${links.unsubscribe}`)
  l.push('— Woongezond')
  return l.join('\n')
}

function wrapHtml(title: string, periodTxt: string, body: string, links: ReportLinks, verdict: WeeklyDeviceReport['verdict']): string {
  const foot = [
    links.report ? `<p style="margin:0 0 10px"><a href="${esc(links.report)}" style="display:inline-block;padding:10px 16px;background:#0B7A5C;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Bekijk het volledige rapport</a></p>` : '',
    `<p style="margin:0 0 6px">Je krijgt deze mail omdat je bij het instellen van de sensor om een weekrapport hebt gevraagd. Alleen jij ontvangt de metingen van jouw sensor; de corporatie ziet uitsluitend cijfers zonder naam of adres.</p>`,
    links.unsubscribe ? `<p style="margin:0"><a href="${esc(links.unsubscribe)}" style="color:#64748B">Geen rapport meer ontvangen</a></p>` : '',
  ].join('')
  return `<!doctype html><html lang="nl"><body style="margin:0;padding:0;background:#EEF2F5"><div style="max-width:600px;margin:0 auto;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#0F172A">
<div style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0">
  <div style="padding:18px 24px;border-top:6px solid ${verdictColor(verdict)}"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#0B7A5C;font-weight:700">Woongezond</div><div style="font-size:20px;font-weight:700;margin-top:4px">${title}</div><div style="color:#64748B;font-size:13px">${esc(periodTxt)}</div></div>
  <div style="padding:8px 24px 24px">${body}</div>
</div>
<div style="padding:18px 8px;color:#64748B;font-size:12px;line-height:1.5">${foot}</div>
</div></body></html>`
}
