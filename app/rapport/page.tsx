'use client'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Logo from '@/components/Logo'
import SegmentedControl from '@/components/ui/SegmentedControl'
import Button from '@/components/ui/Button'
import { ReportLineChart, ReportDualChart } from '@/components/ReportChart'
import { withBase } from '@/lib/basePath'
import { SensorRow } from '@/lib/types'
import { toSeries, buildDiagnosis, buildTips, mean } from '@/lib/reportAnalytics'
import { measurementCoverage, detectGaps } from '@/lib/coverage'
import { Printer, Loader2, Link2Off, ShieldCheck } from 'lucide-react'

// Rapport voor de bewoner zonder account: de link in de weekmail is /rapport?t=wgr_…
// (docs/rapport-weekmail-plan.md). Het token is aan één sensor gebonden; de pagina haalt
// alleen dat device op via /api/rapport en rekent verder precies zoals /report
// (buildDiagnosis, buildTips, coverage), zodat mail, app en deze pagina één verhaal vertellen.
//
// Het rapportvel is een afdrukbaar document met vaste lichte kleuren (dezelfde uitzondering
// op de tokens als /report); de band eromheen volgt het thema.

const RED = '#DC2626',
  AMBER = '#B45309',
  GREEN = '#15803D',
  PRIMARY = '#0B7A5C',
  TEXT = '#0F172A',
  MUTED = '#475569',
  SUBTLE = '#64748B'

const GRADIENT = 'linear-gradient(135deg, var(--brand-mark) 0%, var(--brand-700) 100%)'
const PERIODS = [
  { label: '7 dagen', value: 7 },
  { label: '30 dagen', value: 30 },
  { label: '90 dagen', value: 90 },
]
const sevColor: Record<string, string> = { critical: RED, warning: AMBER, info: PRIMARY, ok: GREEN }

const ERR: Record<string, string> = {
  token_invalid: 'Deze link is verlopen of ongeldig. Je krijgt elke maandag een nieuwe link in je weekrapport.',
  device_unknown: 'Deze sensor kennen we niet (meer). Is hij overgedragen of gereset? Scan dan de QR-code op de sensor om hem opnieuw in te stellen.',
  rate_limited: 'Even te veel verzoeken. Wacht een paar minuten en ververs de pagina.',
  error: 'Het rapport kon niet worden geladen. Probeer het straks opnieuw.',
}

interface ReportData {
  device: { number: number | null; room: string | null; profile: unknown; last_seen_at: string | null }
  first_name: string | null
  report_consent: boolean
  period: { start: string; end: string; days: number }
  raw_count: number
  bucket_minutes: number
  rows: SensorRow[]
}

const TZ = 'Europe/Amsterdam'
const fmtDateTime = (d: Date) => d.toLocaleString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ })
const fmtDay = (d: Date) => d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', timeZone: TZ })

function RapportInner() {
  const params = useSearchParams()
  const t = params.get('t') ?? ''
  const [days, setDays] = useState(7)
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null)

  const load = useCallback(async () => {
    if (!t) { setErr(ERR.token_invalid); setLoading(false); return }
    setLoading(true)
    setErr(null)
    try {
      const r = await fetch(withBase(`/api/rapport?t=${encodeURIComponent(t)}&days=${days}`), { cache: 'no-store' })
      const d = await r.json().catch(() => null)
      if (!r.ok) { setErr(ERR[d?.error] ?? (r.status === 401 ? ERR.token_invalid : r.status === 429 ? ERR.rate_limited : ERR.error)); setData(null); return }
      setData(d as ReportData)
      setGeneratedAt(new Date())
    } catch {
      setErr(ERR.error)
    } finally {
      setLoading(false)
    }
  }, [t, days])

  useEffect(() => { load() }, [load])

  const model = useMemo(() => {
    if (!data) return null
    const s = toSeries(data.rows)
    if (!s.co2.length) return null
    const diag = buildDiagnosis(s)
    const tips = buildTips(s, diag, null)
    return { s, diag, tips }
  }, [data])

  const kpi = useMemo(() => {
    if (!model) return null
    const { co2, temp, rh, mr, dp } = model.s
    const last = co2.length - 1
    const pct = (a: number[], p: (v: number) => boolean) => (a.length ? (a.filter(p).length / a.length) * 100 : 0)
    return {
      co2Now: Math.round(co2[last]), co2Avg: Math.round(mean(co2)), co2Max: Math.round(Math.max(...co2)),
      tempNow: temp[last], tempAvg: mean(temp), rhNow: rh[last], rhAvg: mean(rh), mrNow: mr[last], mrAvg: mean(mr), dpNow: dp[last],
      pct1000: pct(co2, (v) => v > 1000), pctMr60: pct(mr, (v) => v > 60),
    }
  }, [model])

  const cov = useMemo(() => (data ? measurementCoverage(data.rows) : null), [data])
  const gaps = useMemo(() => (data ? detectGaps(data.rows) : []), [data])

  const colCo2 = (v: number) => (v >= 1000 ? RED : v >= 800 ? AMBER : GREEN)
  const colRh = (v: number) => (v >= 70 ? RED : v >= 60 ? AMBER : GREEN)
  const colMr = (v: number) => (v >= 80 ? RED : v >= 60 ? AMBER : GREEN)

  const nr = data?.device.number != null ? String(data.device.number).padStart(2, '0') : null
  const room = data?.device.room ? data.device.room.toLowerCase() : null
  const sensorLabel = nr ? `sensor ${nr}${room ? ` (${room})` : ''}` : 'je sensor'
  const afmeldHref = { pathname: '/rapport/afmelden', query: { t } }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)' }}>
      <style>{`
        @page { size: A4; margin: 14mm; }
        @media print {
          .no-print { display: none !important; }
          .report-sheet { box-shadow: none !important; margin: 0 !important; width: auto !important; max-width: none !important; border-radius: 0 !important; border: none !important; }
          .report-sheet, .report-sheet * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .page-break { break-before: page; }
          .report-wrap { padding: 0 !important; }
        }
        @keyframes wgr-spin { to { transform: rotate(360deg); } }
        .report-sheet { color: ${TEXT}; }
        .report-sheet h1,.report-sheet h2,.report-sheet p { margin: 0; }
        .report-stats { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; margin-bottom: 14px; }
        @media (max-width: 760px) { .report-stats { grid-template-columns: repeat(2,1fr); } }
        @media (max-width: 420px) { .report-stats { grid-template-columns: 1fr; } }
        @media (max-width: 560px) { .report-kv { flex-direction: column; gap: 1px !important; } .report-kv > span:first-child { min-width: 0 !important; } }
        @media (max-width: 560px) { .report-sheet { padding: 22px 18px !important; } }
        .report-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
      `}</style>

      {/* ---- header band (theme-aware, not printed) ---- */}
      <div className="no-print" style={{ background: GRADIENT, color: '#fff', padding: '18px 18px 56px' }}>
        <div style={{ maxWidth: 800, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'inline-flex', background: '#fff', borderRadius: 10, padding: 3 }}><Logo size={26} /></span>
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>Woongezond</span>
          {nr && <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-sm)', fontWeight: 700, background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.35)', padding: '4px 12px', borderRadius: 'var(--r-pill)', letterSpacing: '0.02em' }}>Sensor {nr}</span>}
        </div>
      </div>

      <div className="report-wrap" style={{ maxWidth: 800, margin: '-36px auto 0', padding: '0 14px 40px' }}>
        {/* ---- the sheet ---- */}
        <div className="report-sheet" style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-sm)', padding: '32px 36px', fontFamily: 'inherit' }}>
          {/* ---- controls (screen only) ---- */}
          {!err && (
            <div className="no-print report-toolbar" style={{ marginBottom: 18 }}>
              <SegmentedControl options={PERIODS} value={days} onChange={setDays} ariaLabel="Rapportperiode" />
              <Button variant="primary" size="md" onClick={() => window.print()} disabled={loading || !model} icon={<Printer size={15} />}>Print / bewaar als PDF</Button>
            </div>
          )}
          {err ? (
            <div style={{ textAlign: 'center', padding: '28px 8px' }}>
              <span style={{ display: 'inline-flex', width: 48, height: 48, borderRadius: 14, background: '#FEF2F2', color: RED, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}><Link2Off size={24} /></span>
              <h1 style={{ fontSize: 19, fontWeight: 700, color: TEXT, marginBottom: 8 }}>Rapport niet beschikbaar</h1>
              <p style={{ fontSize: 14, color: MUTED, lineHeight: 1.6, maxWidth: 440, margin: '0 auto' }}>{err}</p>
              {err !== ERR.token_invalid && err !== ERR.device_unknown && (
                <div style={{ marginTop: 18 }}><Button variant="secondary" onClick={load}>Opnieuw proberen</Button></div>
              )}
            </div>
          ) : loading || !data ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: MUTED, fontSize: 14, padding: '48px 0' }}>
              <Loader2 size={18} style={{ animation: 'wgr-spin 1.2s linear infinite' }} /> Rapport genereren…
            </div>
          ) : (
            <>
              {/* ── Header ── */}
              <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid #E2E8F0', marginBottom: 16 }}>
                <div style={{ background: 'linear-gradient(135deg,#12B886 0%,#0B7A5C 100%)', padding: '22px 24px', color: '#fff' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', opacity: 0.85 }}>Woongezond · Luchtkwaliteit</div>
                  <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 3, overflowWrap: 'anywhere' }}>Rapport · {sensorLabel}</h1>
                  <div style={{ fontSize: 12.5, opacity: 0.92, marginTop: 5 }}>
                    {data.first_name ? `Hoi ${data.first_name}, ` : ''}dit is het beeld van de laatste {data.period.days} dagen · gemaakt op {generatedAt ? fmtDateTime(generatedAt) : ''}
                  </div>
                </div>
                <div style={{ padding: '11px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', background: '#fff' }}>
                  <span style={{ fontSize: 12, color: MUTED }}>
                    Periode {fmtDay(new Date(data.period.start))} – {fmtDay(new Date(data.period.end))}
                    {model ? ` · ${data.raw_count.toLocaleString('nl-NL')} metingen${cov ? ` · ${cov.coveragePct}% dekking` : ''}` : ''}
                  </span>
                  {model && <span style={{ fontSize: 11.5, fontWeight: 700, color: model.diag.conclusieKleur, background: `${model.diag.conclusieKleur}1a`, padding: '4px 12px', borderRadius: 99 }}>{model.diag.sevLabel}</span>}
                </div>
              </div>

              {!model || !kpi ? (
                <div style={{ padding: '24px 8px', textAlign: 'center' }}>
                  <p style={{ fontSize: 14, color: TEXT, fontWeight: 600, marginBottom: 6 }}>Geen metingen in deze periode.</p>
                  <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.6, maxWidth: 460, margin: '0 auto' }}>
                    {data.device.last_seen_at
                      ? `De laatste meting van ${sensorLabel} was op ${fmtDateTime(new Date(data.device.last_seen_at))}. Zit de stekker erin en staat de WiFi aan? Zodra de sensor weer meet, vult dit rapport zich vanzelf.`
                      : `We hebben nog geen metingen van ${sensorLabel} ontvangen. Zit de stekker erin en staat de WiFi aan?`}
                  </p>
                </div>
              ) : (
                <>
                  {/* ── Conclusie ── */}
                  <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start', padding: '13px 16px', borderRadius: 12, background: `${model.diag.conclusieKleur}0e`, border: `1px solid ${model.diag.conclusieKleur}2e`, marginBottom: 18 }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: model.diag.conclusieKleur, marginTop: 5, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: model.diag.conclusieKleur, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Conclusie</div>
                      <div style={{ fontSize: 14, color: TEXT, marginTop: 2, fontWeight: 500 }}>{model.diag.conclusieTxt}</div>
                    </div>
                  </div>

                  {/* ── Kerncijfers ── */}
                  <SectionHeader>Gemeten waarden (nu / periode)</SectionHeader>
                  <div className="report-stats">
                    <Stat label="CO₂ (nu / gem / max)" value={`${kpi.co2Now} / ${kpi.co2Avg} / ${kpi.co2Max}`} unit="ppm" color={colCo2(kpi.co2Now)} />
                    <Stat label="Temperatuur (nu / gem)" value={`${kpi.tempNow.toFixed(1)} / ${kpi.tempAvg.toFixed(1)}`} unit="°C" color={TEXT} />
                    <Stat label="Luchtvochtigheid (nu / gem)" value={`${kpi.rhNow.toFixed(0)} / ${kpi.rhAvg.toFixed(0)}`} unit="%" color={colRh(kpi.rhNow)} />
                    <Stat label="Schimmelrisico (nu / gem)" value={`${kpi.mrNow.toFixed(0)} / ${kpi.mrAvg.toFixed(0)}`} unit="/ 100" color={colMr(kpi.mrNow)} />
                  </div>
                  <div style={{ marginBottom: 6 }}>
                    <Kv label="CO₂ > 1000 ppm (Bouwbesluit)" value={`${kpi.pct1000.toFixed(1)}% van de gemeten tijd`} color={kpi.pct1000 > 10 ? RED : GREEN} />
                    <Kv label="Schimmelrisico > 60" value={`${kpi.pctMr60.toFixed(1)}% van de gemeten tijd`} color={kpi.pctMr60 > 20 ? RED : kpi.pctMr60 > 5 ? AMBER : GREEN} />
                    <Kv label="Dauwpunt (nu)" value={`${kpi.dpNow.toFixed(1)} °C`} color={TEXT} />
                    {model.diag.ach && <Kv label="Ventilatie (ACH)" value={`${model.diag.ach.achGem} / uur  (norm ≥ 0,9)`} color={model.diag.ach.voldoet ? GREEN : RED} />}
                    {model.diag.nacht && <Kv label="Nacht-CO₂ / dag-CO₂" value={`${model.diag.nacht.gemNacht} / ${model.diag.nacht.gemDag} ppm`} color={model.diag.nacht.probleem ? RED : GREEN} />}
                  </div>

                  {/* ── Grafieken ── */}
                  <div className="page-break" />
                  <SectionHeader>Meetgrafieken over de periode</SectionHeader>
                  <ReportLineChart
                    title="CO₂ concentratie (ppm)" unit="ppm" color="#4338CA" fill="rgba(67,56,202,0.12)"
                    data={model.s.times.map((tm, i) => ({ t: tm.getTime(), v: model.s.co2[i] }))}
                    refLines={[{ value: 1000, label: 'Bouwbesluit 1000', color: RED }, { value: 800, label: 'Aanbevolen 800', color: AMBER, dash: '2 3' }]}
                  />
                  <ReportLineChart
                    title="Luchtvochtigheid (%)" unit="%" color="#0E7490" fill="rgba(14,116,144,0.12)"
                    data={model.s.times.map((tm, i) => ({ t: tm.getTime(), v: model.s.rh[i] }))}
                    refLines={[{ value: 70, label: 'Schimmelgrens 70%', color: RED }, { value: 60, label: 'Attentie 60%', color: AMBER, dash: '2 3' }]}
                  />
                  <ReportDualChart
                    title="Temperatuur & Dauwpunt (°C)" unit="°C" aColor="#BE123C" bColor="#7E22CE" aLabel="Temperatuur" bLabel="Dauwpunt"
                    a={model.s.times.map((tm, i) => ({ t: tm.getTime(), v: model.s.temp[i] }))}
                    b={model.s.times.map((tm, i) => ({ t: tm.getTime(), v: model.s.dp[i] }))}
                  />
                  <ReportLineChart
                    title="Schimmelrisico (0–100)" unit="score" color="#B45309" fill="rgba(180,83,9,0.12)"
                    data={model.s.times.map((tm, i) => ({ t: tm.getTime(), v: model.s.mr[i] }))}
                    yMin={0}
                    refLines={[{ value: 80, label: 'Kritiek 80', color: RED }, { value: 60, label: 'Risico 60', color: AMBER, dash: '2 3' }]}
                  />

                  {/* ── Bevindingen ── */}
                  <div className="page-break" />
                  <SectionHeader>Bevindingen</SectionHeader>
                  {model.diag.findings.length ? (
                    <div style={{ marginBottom: 14 }}>
                      {model.diag.findings.map((f, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
                          <span style={{ width: 3, alignSelf: 'stretch', background: f.color, borderRadius: 2, flexShrink: 0, minHeight: 16 }} />
                          <span style={{ fontSize: 12.5, color: TEXT, lineHeight: 1.4 }}>{f.text}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: 13, color: GREEN, marginBottom: 14 }}>Geen afwijkingen gevonden in deze periode.</p>
                  )}

                  {/* ── Tips ── */}
                  <SectionHeader>Tips voor komende week</SectionHeader>
                  <div style={{ marginBottom: 14 }}>
                    {model.tips.map((tip, i) => (
                      <div key={i} style={{ display: 'flex', gap: 9, marginBottom: 10 }}>
                        <span style={{ width: 3, background: sevColor[tip.severity], borderRadius: 2, flexShrink: 0 }} />
                        <div>
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: sevColor[tip.severity] }}>{tip.title}</div>
                          <div style={{ fontSize: 12, color: TEXT, lineHeight: 1.5, marginTop: 2 }}>{tip.text}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* ── Meetcontinuïteit ── */}
                  <SectionHeader>Meetcontinuïteit</SectionHeader>
                  <div style={{ marginBottom: 6 }}>
                    {cov && (
                      <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 8px' }}>
                        {cov.days} meetdagen over {cov.spanDays} dagen · langste onafgebroken reeks {cov.longestStreak} dagen · {cov.coveragePct}% dekking van de verwachte metingen.
                      </p>
                    )}
                    {gaps.length === 0 ? (
                      <p style={{ fontSize: 12.5, color: GREEN, margin: 0 }}>Onafgebroken gemeten — geen meethiaten langer dan een uur in deze periode.</p>
                    ) : (
                      <>
                        <p style={{ fontSize: 12, color: MUTED, margin: '0 0 6px' }}>Momenten waarop de sensor niet mat (bijvoorbeeld stekker eruit of WiFi weg):</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {gaps.map((g, i) => (
                            <div key={i} style={{ fontSize: 12, color: TEXT, lineHeight: 1.45, paddingLeft: 14, textIndent: -14 }}>
                              <span style={{ color: AMBER, fontWeight: 700, marginRight: 6 }}>•</span>
                              {fmtDateTime(new Date(g.startMs))} – {fmtDateTime(new Date(g.endMs))} <span style={{ color: MUTED, whiteSpace: 'nowrap' }}>({g.hours} uur)</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    <p style={{ fontSize: 11.5, color: SUBTLE, margin: '8px 0 0', lineHeight: 1.5 }}>
                      Voor dit overzicht zijn de {data.raw_count.toLocaleString('nl-NL')} losse metingen samengevat tot gemiddelden per {data.bucket_minutes} minuten ({model.s.co2.length} punten). Korte pieken kunnen daardoor iets lager uitvallen dan in de app.
                    </p>
                  </div>

                  <hr style={{ border: 'none', borderTop: '1px solid #E2E8F0', margin: '14px 0 8px' }} />
                  <p style={{ fontSize: 10, color: SUBTLE, lineHeight: 1.5 }}>
                    Methoden: Magnus-formule (dauwpunt), CO₂-decay log-lineaire fit (ACH-schatting). Schimmelrisico: model o.b.v.
                    relatieve vochtigheid, temperatuur en geschatte wandtemperatuur (dagcurve). Normen: Bouwbesluit 2012 (CO₂ &lt; 1000 ppm,
                    ACH ≥ 0,9/uur), GGD-richtlijn (RV 40–60%). Dit rapport is een geautomatiseerde indicatie op basis van sensordata en
                    vervangt geen bouwkundig onderzoek.
                  </p>
                </>
              )}
            </>
          )}
        </div>

        {/* ---- privacy footer ---- */}
        {data && !err && (
          <div className="no-print" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 18, padding: '14px 16px', borderRadius: 'var(--r-md)', background: 'var(--surface-tint)', color: 'var(--muted)', fontSize: 'var(--fs-sm)', lineHeight: 1.6 }}>
            <ShieldCheck size={16} style={{ color: 'var(--brand)', flex: '0 0 auto', marginTop: 2 }} />
            <div>
              {data.report_consent ? (
                <>
                  <p style={{ margin: 0 }}>
                    Je krijgt dit rapport omdat je bij het instellen van de sensor om een weekrapport hebt gevraagd. Alleen jij ziet deze pagina; de corporatie ziet uitsluitend cijfers zonder naam of adres.
                  </p>
                  <p style={{ margin: '8px 0 0' }}>
                    <Link href={afmeldHref} style={{ color: 'var(--brand)', fontWeight: 600 }}>Geen weekrapport meer ontvangen</Link>
                  </p>
                </>
              ) : (
                <p style={{ margin: 0 }}>
                  Je hebt het weekrapport stopgezet; deze link blijft nog even werken. Alleen jij ziet deze pagina; de corporatie ziet uitsluitend cijfers zonder naam of adres. Opnieuw aanmelden kan via de QR-code op de sensor.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '4px 0 10px' }}>
      <span style={{ width: 3, height: 14, background: PRIMARY, borderRadius: 2 }} />
      <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{children}</span>
    </div>
  )
}

function Stat({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div style={{ background: '#FAFBFC', border: '1px solid #EEF2F6', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ fontSize: 9, color: MUTED, lineHeight: 1.3, minHeight: 24 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
      <div style={{ fontSize: 8.5, color: SUBTLE }}>{unit}</div>
    </div>
  )
}

function Kv({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="report-kv" style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: 12 }}>
      <span style={{ color: MUTED, minWidth: 220 }}>{label}</span>
      <span style={{ fontWeight: 700, color }}>{value}</span>
    </div>
  )
}

export default function RapportPage() {
  return <Suspense fallback={null}><RapportInner /></Suspense>
}
