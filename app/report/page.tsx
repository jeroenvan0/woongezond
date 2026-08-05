'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { withBase } from '@/lib/basePath'
import { SensorRow } from '@/lib/types'
import { toSeries, buildDiagnosis, buildTips, mean } from '@/lib/reportAnalytics'
import { measurementCoverage, detectGaps } from '@/lib/coverage'
import { ReportLineChart, ReportDualChart } from '@/components/ReportChart'
import AppShell from '@/components/AppShell'
import Button from '@/components/ui/Button'
import { Download, Printer } from 'lucide-react'

// The report is a *printed document*, so its palette is fixed light values — a court
// exhibit must render the same on paper regardless of the app's theme. These literals
// are the deliberate print exception to the token system; the surrounding shell is
// theme-aware, the paper sheet is not. PRIMARY is the brand green so the mark matches.
const RED = '#DC2626',
  AMBER = '#B45309',
  GREEN = '#15803D',
  PRIMARY = '#0B7A5C',
  TEXT = '#0F172A',
  MUTED = '#475569',
  SUBTLE = '#64748B'

const PERIODS = [
  { label: '7 dagen', value: 10080 },
  { label: '30 dagen', value: 43200 },
  { label: '90 dagen', value: 129600 },
  { label: '1 jaar', value: 525600 },
]

const sevColor: Record<string, string> = { critical: RED, warning: AMBER, info: PRIMARY, ok: GREEN }

function fmtDateTime(d: Date) {
  return d.toLocaleString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' })
}

export default function ReportPage() {
  const router = useRouter()
  const supabase = createClient()
  const [rows, setRows] = useState<SensorRow[]>([])
  const [email, setEmail] = useState('')
  const [weather, setWeather] = useState<any>(null)
  const [pollution, setPollution] = useState<any>(null)
  const [period, setPeriod] = useState(43200)
  const [loading, setLoading] = useState(true)
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }
    setEmail(user.email ?? '')
    const [dRes, wRes] = await Promise.all([
      fetch(withBase(`/api/data?minutes=${period}`)).then((r) => r.json()).catch(() => ({ rows: [] })),
      fetch(withBase('/api/weather')).then((r) => r.json()).catch(() => ({ weather: null, pollution: null })),
    ])
    setRows(dRes.rows ?? [])
    setWeather(wRes.weather ?? null)
    setPollution(wRes.pollution ?? null)
    setGeneratedAt(new Date())
    setLoading(false)
  }, [period, router, supabase])

  useEffect(() => {
    load()
  }, [load])

  const model = useMemo(() => {
    const s = toSeries(rows)
    if (!s.co2.length) return null
    const diag = buildDiagnosis(s)
    const tips = buildTips(s, diag, weather)
    return { s, diag, tips }
  }, [rows, weather])

  const kpi = useMemo(() => {
    if (!model) return null
    const { co2, temp, rh, mr, dp } = model.s
    const last = co2.length - 1
    const pct = (a: number[], p: (v: number) => boolean) => (a.length ? (a.filter(p).length / a.length) * 100 : 0)
    return {
      co2Now: Math.round(co2[last]),
      co2Avg: Math.round(mean(co2)),
      co2Max: Math.round(Math.max(...co2)),
      tempNow: temp[last],
      tempAvg: mean(temp),
      rhNow: rh[last],
      rhAvg: mean(rh),
      mrNow: mr[last],
      mrAvg: mean(mr),
      dpNow: dp[last],
      pct1000: pct(co2, (v) => v > 1000),
      pctMr60: pct(mr, (v) => v > 60),
    }
  }, [model])

  const cov = useMemo(() => measurementCoverage(rows), [rows])
  const gaps = useMemo(() => detectGaps(rows), [rows])

  function downloadCsv() {
    if (!model) return
    const s = model.s
    const header = 'tijd,co2_ppm,temperatuur_c,vochtigheid_pct,schimmelrisico,dauwpunt_c'
    const lines = s.times.map((t, i) =>
      [new Date(t).toISOString(), Math.round(s.co2[i]), s.temp[i].toFixed(2), s.rh[i].toFixed(2), s.mr[i].toFixed(1), s.dp[i].toFixed(2)].join(','),
    )
    const blob = new Blob([header + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `woongezond-metingen-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const colCo2 = (v: number) => (v >= 1000 ? RED : v >= 800 ? AMBER : GREEN)
  const colRh = (v: number) => (v >= 70 ? RED : v >= 60 ? AMBER : GREEN)
  const colMr = (v: number) => (v >= 80 ? RED : v >= 60 ? AMBER : GREEN)

  const controls = (
    <>
      <select value={period} onChange={(e) => setPeriod(+e.target.value)} aria-label="Rapportperiode" style={{ padding: '7px 10px', fontSize: 'var(--fs-md)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface)', color: 'var(--text)' }}>
        {PERIODS.map((p) => (
          <option key={p.value} value={p.value}>
            Periode: {p.label}
          </option>
        ))}
      </select>
      <Button variant="secondary" size="sm" onClick={downloadCsv} disabled={loading || !model} icon={<Download size={14} />}>CSV</Button>
      <Button variant="primary" size="sm" onClick={() => window.print()} disabled={loading || !model} icon={<Printer size={14} />}>Download als PDF</Button>
    </>
  )

  return (
    <AppShell title="Rapport" actions={controls}>
      <style>{`
        @page { size: A4; margin: 14mm; }
        @media print {
          .no-print { display: none !important; }
          .report-sheet { box-shadow: none !important; margin: 0 !important; width: auto !important; max-width: none !important; border-radius: 0 !important; }
          .report-sheet, .report-sheet * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .page-break { break-before: page; }
        }
        .report-sheet { color: ${TEXT}; }
        .report-sheet h1,.report-sheet h2,.report-sheet p { margin: 0; }
        /* Responsive report (4.2): stat grid 4→2→1, Kv rows stack under 560px. */
        .report-stats { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; margin-bottom: 14px; }
        @media (max-width: 760px) { .report-stats { grid-template-columns: repeat(2,1fr); } }
        @media (max-width: 420px) { .report-stats { grid-template-columns: 1fr; } }
        @media (max-width: 560px) { .report-kv { flex-direction: column; gap: 1px !important; } .report-kv > span:first-child { min-width: 0 !important; } }
      `}</style>

      <div
        className="report-sheet"
        style={{ maxWidth: 800, margin: '0 auto', background: '#fff', borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-sm)', padding: '32px 36px', fontFamily: 'inherit' }}
      >
        {loading ? (
          <div style={{ color: MUTED, fontSize: 14, padding: '40px 0', textAlign: 'center' }}>Rapport genereren…</div>
        ) : !model || !kpi ? (
          <div style={{ color: MUTED, fontSize: 14, padding: '40px 0', textAlign: 'center' }}>
            Geen meetgegevens beschikbaar voor de geselecteerde periode.
          </div>
        ) : (
          <>
            {/* ── Header ── */}
            <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid #E2E8F0', marginBottom: 16 }}>
              <div style={{ background: 'linear-gradient(135deg,#12B886 0%,#0B7A5C 100%)', padding: '22px 24px', color: '#fff' }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', opacity: 0.85 }}>Woongezond · Luchtkwaliteit</div>
                <h1 style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 3 }}>Luchtkwaliteitsrapport</h1>
                <div style={{ fontSize: 12.5, opacity: 0.92, marginTop: 5 }}>
                  {email ? `${email} · ` : ''}gegenereerd op {generatedAt ? fmtDateTime(generatedAt) : ''}
                </div>
              </div>
              <div style={{ padding: '11px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', background: '#fff' }}>
                <span style={{ fontSize: 12, color: MUTED }}>
                  Meetperiode {fmtDateTime(model.s.times[0])} – {fmtDateTime(model.s.times[model.s.times.length - 1])} · {model.s.co2.length} metingen{cov ? ` · ${cov.coveragePct}% dekking` : ''}
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: model.diag.conclusieKleur, background: `${model.diag.conclusieKleur}1a`, padding: '4px 12px', borderRadius: 99 }}>{model.diag.sevLabel}</span>
              </div>
            </div>

            {/* ── Conclusion ── */}
            <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start', padding: '13px 16px', borderRadius: 12, background: `${model.diag.conclusieKleur}0e`, border: `1px solid ${model.diag.conclusieKleur}2e`, marginBottom: 18 }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: model.diag.conclusieKleur, marginTop: 5, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: model.diag.conclusieKleur, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Conclusie</div>
                <div style={{ fontSize: 14, color: TEXT, marginTop: 2, fontWeight: 500 }}>{model.diag.conclusieTxt}</div>
              </div>
            </div>

            {/* ── Key stats ── */}
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
              {model.diag.ach && (
                <Kv label="Ventilatie (ACH)" value={`${model.diag.ach.achGem} / uur  (norm ≥ 0,9)`} color={model.diag.ach.voldoet ? GREEN : RED} />
              )}
              {model.diag.nacht && (
                <Kv label="Nacht-CO₂ / dag-CO₂" value={`${model.diag.nacht.gemNacht} / ${model.diag.nacht.gemDag} ppm`} color={model.diag.nacht.probleem ? RED : GREEN} />
              )}
            </div>

            {/* ── Weather ── */}
            {weather && (
              <>
                <SectionHeader>Buitenomstandigheden</SectionHeader>
                <div style={{ marginBottom: 8 }}>
                  <Kv label="Temperatuur buiten" value={weather.temp != null ? `${(+weather.temp).toFixed(1)} °C` : '—'} color={TEXT} />
                  <Kv label="Luchtvochtigheid buiten" value={weather.humidity != null ? `${Math.round(+weather.humidity)} %` : '—'} color={TEXT} />
                  <Kv label="Dauwpunt buiten" value={weather.outdoorDewpoint != null ? `${(+weather.outdoorDewpoint).toFixed(1)} °C` : '—'} color={TEXT} />
                  <Kv label="Conditie" value={weather.description || '—'} color={TEXT} />
                  {pollution && pollution.aqi && (
                    <Kv label="Luchtkwaliteit buiten (AQI)" value={`${{ 1: 'Goed', 2: 'Redelijk', 3: 'Matig', 4: 'Slecht', 5: 'Zeer slecht' }[pollution.aqi as 1] ?? '—'} (${pollution.aqi})`} color={TEXT} />
                  )}
                </div>
              </>
            )}

            {/* ── Charts ── */}
            <div className="page-break" />
            <SectionHeader>Meetgrafieken over de periode</SectionHeader>
            <ReportLineChart
              title="CO₂ concentratie (ppm)"
              unit="ppm"
              color="#4338CA"
              fill="rgba(67,56,202,0.12)"
              data={model.s.times.map((t, i) => ({ t: t.getTime(), v: model.s.co2[i] }))}
              refLines={[
                { value: 1000, label: 'Bouwbesluit 1000', color: RED },
                { value: 800, label: 'Aanbevolen 800', color: AMBER, dash: '2 3' },
              ]}
            />
            <ReportLineChart
              title="Luchtvochtigheid (%)"
              unit="%"
              color="#0E7490"
              fill="rgba(14,116,144,0.12)"
              data={model.s.times.map((t, i) => ({ t: t.getTime(), v: model.s.rh[i] }))}
              refLines={[
                { value: 70, label: 'Schimmelgrens 70%', color: RED },
                { value: 60, label: 'Attentie 60%', color: AMBER, dash: '2 3' },
              ]}
            />
            <ReportDualChart
              title="Temperatuur & Dauwpunt (°C)"
              unit="°C"
              aColor="#BE123C"
              bColor="#7E22CE"
              aLabel="Temperatuur"
              bLabel="Dauwpunt"
              a={model.s.times.map((t, i) => ({ t: t.getTime(), v: model.s.temp[i] }))}
              b={model.s.times.map((t, i) => ({ t: t.getTime(), v: model.s.dp[i] }))}
            />
            <ReportLineChart
              title="Schimmelrisico (0–100)"
              unit="score"
              color="#B45309"
              fill="rgba(180,83,9,0.12)"
              data={model.s.times.map((t, i) => ({ t: t.getTime(), v: model.s.mr[i] }))}
              yMin={0}
              refLines={[
                { value: 80, label: 'Kritiek 80', color: RED },
                { value: 60, label: 'Risico 60', color: AMBER, dash: '2 3' },
              ]}
            />

            {/* ── Findings ── */}
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
              <p style={{ fontSize: 13, color: GREEN, marginBottom: 14 }}>Geen afwijkingen gedetecteerd in de geselecteerde periode.</p>
            )}

            {/* ── Recommendations ── */}
            {model.diag.recommendations.length > 0 && (
              <>
                <SectionHeader>Aanbevelingen (ook geschikt voor verhuurder)</SectionHeader>
                <ol style={{ margin: '0 0 14px', paddingLeft: 20 }}>
                  {model.diag.recommendations.map((r, i) => (
                    <li key={i} style={{ fontSize: 12.5, color: TEXT, lineHeight: 1.5, marginBottom: 4 }}>
                      {r}
                    </li>
                  ))}
                </ol>
              </>
            )}

            {/* ── Tips ── */}
            <SectionHeader>Persoonlijke bewonerstips</SectionHeader>
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

            {/* ── Methodology ── */}
            {/* ── Measurement continuity (evidence robustness + honest gap disclosure) ── */}
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
                  <p style={{ fontSize: 12, color: MUTED, margin: '0 0 6px' }}>Perioden waarin de sensor offline was (volledig en transparant vermeld):</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {gaps.map((g, i) => (
                      <div key={i} style={{ fontSize: 12, color: TEXT, display: 'flex', gap: 8, alignItems: 'baseline' }}>
                        <span style={{ color: AMBER, fontWeight: 700 }}>•</span>
                        {fmtDateTime(new Date(g.startMs))} – {fmtDateTime(new Date(g.endMs))}
                        <span style={{ color: MUTED }}>({g.hours} uur)</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid #E2E8F0', margin: '14px 0 8px' }} />
            <p style={{ fontSize: 10, color: SUBTLE, lineHeight: 1.5 }}>
              Methoden: Magnus-formule (dauwpunt), CO₂-decay log-lineaire fit (ACH-schatting). Schimmelrisico: model o.b.v.
              relatieve vochtigheid, temperatuur en geschatte wandtemperatuur (dagcurve). Trendsignificantie: Student-t
              tweezijdige toets op de regressiehelling. Normen: Bouwbesluit 2012 (CO₂ &lt; 1000 ppm, ACH ≥ 0,9/uur),
              GGD-richtlijn (RV 40–60%). Dit rapport is een geautomatiseerde indicatie op basis van sensordata en vervangt
              geen bouwkundig onderzoek.
            </p>

            {/* Complaint letter — screen only; copy into your own letter/e-mail */}
            <ComplaintLetter diag={model.diag} kpi={kpi} s={model.s} email={email} generatedAt={generatedAt} />
          </>
        )}
      </div>
    </AppShell>
  )
}

const fmtDateShort = (d: Date) => d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })

function buildLetter(diag: any, kpi: any, s: any, email: string, generatedAt: Date): string {
  const period = `${fmtDateShort(s.times[0])} t/m ${fmtDateShort(s.times[s.times.length - 1])}`
  const findings = diag.findings.length ? diag.findings.map((f: any) => `• ${f.text}`).join('\n') : '• Geen structurele afwijkingen vastgesteld.'
  const achLine = diag.ach ? `\n• Geschatte ventilatie (ACH) ${diag.ach.achGem} per uur (richtlijn ≥ 0,9).` : ''
  return `Betreft: Melding van een gebrek aan de huurwoning – vocht en ventilatie

Geachte verhuurder,

Met deze brief meld ik formeel een mogelijk gebrek aan de door mij gehuurde woning, betreffende de luchtkwaliteit en de vochthuishouding. Op basis van continue sensormetingen over de periode ${period} (${s.co2.length} metingen) is het volgende vastgesteld:

${findings}

Conclusie: ${diag.conclusieTxt}.

Kerncijfers:
• CO₂ gemiddeld ${kpi.co2Avg} ppm; ${kpi.pct1000.toFixed(0)}% van de tijd boven de Bouwbesluit-norm van 1000 ppm.
• Relatieve luchtvochtigheid gemiddeld ${kpi.rhAvg.toFixed(0)}%.
• Schimmelrisico-indicatie ${kpi.pctMr60.toFixed(0)}% van de tijd verhoogd.${achLine}

Op grond van artikel 7:206 van het Burgerlijk Wetboek verzoek ik u dit gebrek binnen een redelijke termijn — uiterlijk zes weken na dagtekening — te (laten) onderzoeken en te verhelpen. Het bijgevoegde luchtkwaliteitsrapport onderbouwt deze melding met grafieken en de gebruikte meetmethodiek.

Graag ontvang ik binnen veertien dagen een schriftelijke ontvangstbevestiging en een voorstel voor de vervolgstappen.

Hoogachtend,

${email || '[uw naam]'}
${fmtDateShort(generatedAt)}`
}

function ComplaintLetter({ diag, kpi, s, email, generatedAt }: { diag: any; kpi: any; s: any; email: string; generatedAt: Date | null }) {
  const [copied, setCopied] = useState(false)
  if (!generatedAt) return null
  const letter = buildLetter(diag, kpi, s, email, generatedAt)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(letter)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }
  return (
    <div className="no-print" style={{ marginTop: 20, border: '1px solid #E2E8F0', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 16px', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>Klachtbrief voor de verhuurder</div>
          <div style={{ fontSize: 11.5, color: MUTED, marginTop: 1 }}>Automatisch opgesteld uit de bevindingen — kopieer en stuur als begeleidende brief bij dit rapport.</div>
        </div>
        <button onClick={copy} style={{ padding: '8px 14px', background: copied ? GREEN : PRIMARY, color: '#fff', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          {copied ? 'Gekopieerd ✓' : 'Kopieer tekst'}
        </button>
      </div>
      <pre style={{ margin: 0, padding: '16px 18px', fontSize: 12.5, lineHeight: 1.65, color: TEXT, whiteSpace: 'pre-wrap', fontFamily: 'Inter, system-ui, sans-serif', background: '#fff' }}>{letter}</pre>
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
