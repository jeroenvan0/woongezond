'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import MetricCard from '@/components/MetricCard'
import ChartCard from '@/components/ChartCard'
import ChatWidget from '@/components/ChatWidget'
import HealthTimelineChart from '@/components/HealthTimelineChart'
import MonthlyTrendChart from '@/components/MonthlyTrendChart'
import HourHeatmap from '@/components/HourHeatmap'
import SegmentedControl from '@/components/ui/SegmentedControl'
import InfoHint from '@/components/ui/InfoHint'
import Button from '@/components/ui/Button'
import ChartTable from '@/components/ui/ChartTable'
import DataBanner from '@/components/DataBanner'
import { SensorRow } from '@/lib/types'
import { healthLabel } from '@/lib/calculations'
import { useStickyState } from '@/lib/useStickyState'
import { useSeries } from '@/lib/useSeries'
import { useSelectedDevice } from '@/lib/useSelectedDevice'
import { Plus, Trash2 } from 'lucide-react'
import {
  computeHealthTimeline,
  rollingMean,
  computeMonthlyStats,
  buildHeatmapMatrix,
  comparePeriods,
  beforeAfter,
  HeatmapMetric,
  CompareResult,
} from '@/lib/trends'

const RANGE_OPTIONS = [
  { label: '30 dagen', value: 30 },
  { label: '90 dagen', value: 90 },
  { label: '1 jaar', value: 365 },
]

const METRIC_OPTIONS: { label: string; value: HeatmapMetric }[] = [
  { label: 'CO₂', value: 'co2' },
  { label: 'Luchtvochtigheid', value: 'humidity' },
  { label: 'Temperatuur', value: 'temperature' },
]

interface Intervention {
  id: string
  label: string
  notes: string | null
  intervention_date: string
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 'var(--fs-xs)',
        fontWeight: 600,
        color: 'var(--muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  )
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        padding: '16px 18px',
        boxShadow: 'var(--shadow-xs)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

const todayStr = () => new Date().toISOString().slice(0, 10)
const daysAgoStr = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)

export default function TrendsPage() {
  const router = useRouter()
  const supabase = createClient()
  const [rangeDays, setRangeDays] = useStickyState('wz-trends-range', 90)
  // B3: scope the whole trends series to the selected room, like the dashboard. Falls
  // back to all-devices when nothing is selected or the device-aware RPC isn't deployed.
  const selectedDevice = useSelectedDevice()
  const { rows, loading, error: dataError, refetch } = useSeries(rangeDays * 1440, { device: selectedDevice })
  const [metric, setMetric] = useStickyState<HeatmapMetric>('wz-trends-metric', 'co2')
  const [userId, setUserId] = useState<string | null>(null)

  const [interventions, setInterventions] = useState<Intervention[]>([])
  const [ivDate, setIvDate] = useState(todayStr())
  const [ivLabel, setIvLabel] = useState('')
  const [ivMsg, setIvMsg] = useState<{ text: string; color: string } | null>(null)

  // comparison
  const [aStart, setAStart] = useState(daysAgoStr(60))
  const [aEnd, setAEnd] = useState(daysAgoStr(30))
  const [bStart, setBStart] = useState(daysAgoStr(30))
  const [bEnd, setBEnd] = useState(todayStr())
  const [cmp, setCmp] = useState<CompareResult | null | 'none'>(null)

  const loadInterventions = useCallback(async () => {
    const { data } = await supabase
      .from('interventions')
      .select('id,label,notes,intervention_date')
      .order('intervention_date', { ascending: false })
      .limit(50)
    setInterventions((data as Intervention[]) ?? [])
  }, [supabase])

  useEffect(() => {
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      setUserId(user.id)
      loadInterventions()
    })()
  }, [router, supabase, loadInterventions])

  const timeline = useMemo(() => computeHealthTimeline(rows), [rows])
  const timelineData = useMemo(() => {
    const roll = rollingMean(timeline.map((p) => p.score), 7)
    return timeline.map((p, i) => ({ t: p.t, score: p.score, rolling: roll[i] }))
  }, [timeline])
  const monthly = useMemo(() => computeMonthlyStats(rows), [rows])
  const heatmap = useMemo(() => buildHeatmapMatrix(rows, metric), [rows, metric])

  const ivMarkers = useMemo(
    () =>
      interventions
        .map((iv) => ({ t: new Date(iv.intervention_date).getTime(), label: iv.label }))
        .filter((m) => !isNaN(m.t)),
    [interventions],
  )

  // KPIs
  const scores = timeline.map((p) => p.score)
  const latest = scores.length ? scores[scores.length - 1] : null
  const hl = latest != null ? healthLabel(latest) : null
  const avg30 =
    scores.length >= 3 ? Math.round(scores.slice(-30).reduce((a, b) => a + b, 0) / Math.min(30, scores.length)) : latest
  const delta = scores.length > 1 ? scores[scores.length - 1] - scores[0] : 0

  async function addIntervention() {
    if (!ivLabel.trim()) return
    if (!ivDate) {
      setIvMsg({ text: 'Kies een datum.', color: 'var(--warn)' })
      return
    }
    const { error } = await supabase.from('interventions').insert({
      user_id: userId,
      label: ivLabel.trim().slice(0, 200),
      notes: '',
      intervention_date: ivDate,
    })
    if (error) {
      setIvMsg({ text: 'Opslaan mislukt — ' + error.message, color: 'var(--crit)' })
      return
    }
    setIvMsg({ text: 'Interventie opgeslagen.', color: 'var(--ok)' })
    setIvLabel('')
    loadInterventions()
  }

  async function deleteIntervention(id: string, label: string) {
    // F2: interventions are treated as evidence on the timeline, so deleting one
    // needs an explicit confirmation (there is no undo).
    if (!window.confirm(`Interventie "${label}" verwijderen? Dit kan niet ongedaan worden gemaakt.`)) return
    await supabase.from('interventions').delete().eq('id', id)
    loadInterventions()
  }

  function runComparison() {
    if (!aStart || !aEnd || !bStart || !bEnd) {
      setCmp('none')
      return
    }
    const res = comparePeriods(rows, aStart, aEnd, bStart, bEnd)
    setCmp(res ?? 'none')
  }

  const divider = <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '22px 0' }} />

  return (
    <AppShell title="Trends">
      <DataBanner error={dataError} onRetry={refetch} />

      {/* Range selector */}
      <div style={{ marginBottom: 14 }}>
        <SegmentedControl
          ariaLabel="Periode"
          options={RANGE_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
          value={rangeDays}
          onChange={setRangeDays}
        />
      </div>

      {/* KPI cards */}
      {latest != null && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <MetricCard title="Huidige score" value={`${latest}`} unit="/ 100" label={hl?.label} labelColor={hl?.color} accent={hl?.color} progress={latest} />
          <MetricCard title="Gem. (30 dagen)" value={`${avg30}`} unit="/ 100" accent="var(--accent)" />
          <MetricCard
            title="Trend"
            value={`${delta >= 0 ? '+' : ''}${delta}`}
            unit="in periode"
            label={delta >= 0 ? 'stijgend' : 'dalend'}
            labelColor={delta >= 0 ? 'var(--ok)' : 'var(--crit)'}
            accent={delta >= 0 ? 'var(--ok)' : 'var(--crit)'}
          />
        </div>
      )}

      {loading && <div style={{ color: 'var(--muted)', fontSize: 'var(--fs-md)', padding: '20px 0' }}>Laden…</div>}

      {/* Health timeline */}
      <ChartCard label="Huisgezondheid per dag">
        <HealthTimelineChart data={timelineData} interventions={ivMarkers} />
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          Dagelijkse gezondheidsscore — hoger = beter.
          <InfoHint label="gezondheidsscore" text="0–100, hoger = beter (dezelfde score als op het dashboard). Let op: de WoonScore op de Schimmel-pagina loopt juist andersom — daar betekent hoger méér risico." />
          <span>Groen ≥ 65 · Amber 40–64 · Rood &lt; 40 · Stippellijn = interventie · lijn = 7-daags gemiddelde</span>
        </p>
        <ChartTable
          caption="Huisgezondheid per dag"
          columns={[{ key: 'd', label: 'Datum' }, { key: 's', label: 'Score' }, { key: 'r', label: '7-daags gem.' }]}
          rows={timelineData.map((p) => ({ d: new Date(p.t).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }), s: `${p.score}`, r: p.rolling.toFixed(0) }))}
        />
      </ChartCard>

      {/* Monthly */}
      <ChartCard label="Gezondheidsscore per maand">
        <MonthlyTrendChart data={monthly} />
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginTop: 6 }}>
          Stippellijn = geschatte gemiddelde buitentemperatuur Amsterdam · Groen ≥ 65 · Amber 40–64 · Rood &lt; 40
        </p>
        <ChartTable
          caption="Gezondheidsscore per maand"
          columns={[{ key: 'm', label: 'Maand' }, { key: 's', label: 'Score' }, { key: 'c', label: 'CO₂ gem.' }, { key: 'rh', label: 'RV gem.' }]}
          rows={monthly.map((m) => ({ m: m.label, s: `${m.healthScore}`, c: `${m.co2Avg} ppm`, rh: `${m.rhAvg}%` }))}
        />
      </ChartCard>

      {/* Heatmap */}
      <Card style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
          <Section>Seizoen × uur patroon</Section>
          <SegmentedControl
            ariaLabel="Meetwaarde voor heatmap"
            options={METRIC_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
            value={metric}
            onChange={setMetric}
          />
        </div>
        <HourHeatmap metric={metric} result={heatmap} />
        <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
          Gemiddelde per maand en uur van de dag. Nieuwe maanden verschijnen automatisch naarmate er meer data
          binnenkomt.
        </p>
      </Card>

      {divider}

      {/* Period comparison */}
      <Section>Periodes vergelijken</Section>
      <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 12px' }}>
        Vergelijk twee periodes met seizoenscorrectie — zo zie je het echte effect van een interventie los van
        temperatuurverschillen.
      </p>
      <Card>
        <ComparisonRow label="Periode A" start={aStart} end={aEnd} onStart={setAStart} onEnd={setAEnd} />
        <ComparisonRow label="Periode B" start={bStart} end={bEnd} onStart={setBStart} onEnd={setBEnd} />
        <Button variant="primary" onClick={runComparison} style={{ marginTop: 4 }}>
          Vergelijk →
        </Button>
        {cmp === 'none' && (
          <div style={{ fontSize: 'var(--fs-md)', color: 'var(--muted)', marginTop: 14 }}>
            Geen data in één of beide periodes. Kies een ruimere datumrange.
          </div>
        )}
        {cmp && cmp !== 'none' && <ComparisonResult result={cmp} labelA={`${aStart} – ${aEnd}`} labelB={`${bStart} – ${bEnd}`} />}
      </Card>

      {divider}

      {/* Interventions */}
      <Section>Interventies</Section>
      <Card style={{ marginBottom: 10 }}>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', margin: '0 0 12px' }}>
          Registreer wijzigingen in je woning om het voor/na-effect op de tijdlijn te zien. Vergelijking toont
          2-weekse gemiddelden voor en na de datum.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <input
            type="date"
            aria-label="Datum interventie"
            value={ivDate}
            onChange={(e) => setIvDate(e.target.value)}
            style={{ padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-md)', background: 'var(--surface-2)', color: 'var(--text)', width: 150 }}
          />
          <input
            type="text"
            value={ivLabel}
            maxLength={200}
            aria-label="Omschrijving interventie"
            onChange={(e) => setIvLabel(e.target.value)}
            placeholder="Omschrijving (bijv. WTW-filter gereinigd)"
            onKeyDown={(e) => e.key === 'Enter' && addIntervention()}
            style={{ padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-md)', flex: 1, minWidth: 180, background: 'var(--surface-2)', color: 'var(--text)' }}
          />
          <Button variant="primary" onClick={addIntervention} icon={<Plus size={15} />}>
            Toevoegen
          </Button>
        </div>
        <div aria-live="polite" style={{ fontSize: 'var(--fs-sm)', minHeight: 16 }}>
          {ivMsg && <span style={{ color: ivMsg.color }}>{ivMsg.text}</span>}
        </div>
      </Card>

      <InterventionList interventions={interventions} rows={rows} onDelete={deleteIntervention} />

      <ChatWidget />
    </AppShell>
  )
}

function ComparisonRow({ label, start, end, onStart, onEnd }: any) {
  const inp = (val: string, on: (v: string) => void) => (
    <input
      type="date"
      value={val}
      onChange={(e) => on(e.target.value)}
      style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'var(--surface-2)', color: 'var(--text)', width: 140 }}
    />
  )
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
      <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--muted)', minWidth: 70 }}>{label}</span>
      {inp(start, onStart)}
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>t/m</span>
      {inp(end, onEnd)}
    </div>
  )
}

function ComparisonResult({ result, labelA, labelB }: { result: CompareResult; labelA: string; labelB: string }) {
  const { a, b } = result
  const fairColor = result.fairness === 'fair' ? 'var(--ok)' : result.fairness === 'caution' ? 'var(--warn)' : 'var(--crit)'

  const deltaCell = (va: number | null, vb: number | null, unit = '', lowerBetter = false, d = 1) => {
    if (va == null || vb == null) return <td style={{ textAlign: 'right', padding: '7px 12px' }}>—</td>
    const delta = vb - va
    const improved = lowerBetter ? delta < 0 : delta > 0
    const col = improved ? 'var(--ok)' : Math.abs(delta) > 0.5 ? 'var(--crit)' : 'var(--muted)'
    return (
      <td style={{ textAlign: 'right', padding: '7px 12px' }}>
        <span style={{ fontWeight: 600, color: 'var(--text)' }}>
          {vb.toFixed(d)}
          {unit}
        </span>
        <span style={{ color: col, fontSize: 11, marginLeft: 6 }}>
          {delta > 0 ? '+' : ''}
          {delta.toFixed(d)}
        </span>
      </td>
    )
  }
  const lblTd = (t: string, bold = false) => (
    <td style={{ padding: '7px 12px', fontSize: 12.5, fontWeight: bold ? 600 : 400, color: 'var(--text)' }}>{t}</td>
  )
  const valTd = (v: number, unit = '', d = 1) => (
    <td style={{ textAlign: 'right', padding: '7px 12px', fontSize: 12.5, color: 'var(--text)', fontWeight: 500 }}>
      {v.toFixed(d)}
      {unit}
    </td>
  )
  const sep = (t: string) => (
    <tr>
      <td colSpan={3} style={{ padding: '8px 12px 4px', fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderTop: '1px solid var(--border)' }}>
        {t}
      </td>
    </tr>
  )

  const corrD = result.corrDelta
  const seas = result.seasonalShare
  let interp: string
  if (Math.abs(corrD) < 2)
    interp =
      'Na seizoenscorrectie is er nauwelijks verschil tussen de periodes. Het zichtbare verschil in de ruwe score wordt grotendeels door het seizoen verklaard.'
  else if (seas !== 0 && Math.abs(seas) > Math.abs(corrD) * 0.3)
    interp = `De score is ${corrD > 0 ? 'verbeterd' : 'verslechterd'} met ${Math.abs(corrD).toFixed(0)} punten na correctie. Ongeveer ${Math.abs(seas).toFixed(0)} punt${Math.abs(seas) !== 1 ? 'en' : ''} van het ruwe verschil (${result.rawDelta >= 0 ? '+' : ''}${result.rawDelta}) wordt verklaard door het seizoensverschil.`
  else
    interp = `De score is ${corrD > 0 ? 'verbeterd' : 'verslechterd'} met ${Math.abs(corrD).toFixed(0)} punten — seizoenseffect is klein (${Math.abs(seas).toFixed(0)} punt${Math.abs(seas) !== 1 ? 'en' : ''}).`

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ padding: '10px 14px', fontSize: 'var(--fs-sm)', marginBottom: 12, borderRadius: 'var(--r-md)', background: `color-mix(in srgb, ${fairColor} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${fairColor} 30%, transparent)`, color: 'var(--text)' }}>
        {result.fairnessMsg}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr>
              <th />
              <th style={{ padding: '7px 12px', fontSize: 12, fontWeight: 700, color: 'var(--text)', textAlign: 'right' }}>{labelA}</th>
              <th style={{ padding: '7px 12px', fontSize: 12, fontWeight: 700, color: 'var(--text)', textAlign: 'right' }}>{labelB}</th>
            </tr>
          </thead>
          <tbody>
            {sep('Ruwe meting')}
            <tr>
              {lblTd('Gezondheidsscore', true)}
              {valTd(a.score, '/100', 0)}
              {deltaCell(a.score, b.score, '/100', false, 0)}
            </tr>
            <tr>
              {lblTd('CO₂ gemiddeld')}
              {valTd(a.co2Avg, ' ppm', 0)}
              {deltaCell(a.co2Avg, b.co2Avg, ' ppm', true, 0)}
            </tr>
            <tr>
              {lblTd('CO₂ (95e percentiel)')}
              {valTd(a.co2P95, ' ppm', 0)}
              {deltaCell(a.co2P95, b.co2P95, ' ppm', true, 0)}
            </tr>
            <tr>
              {lblTd('Luchtvochtigheid')}
              {valTd(a.rhAvg, '%')}
              {deltaCell(a.rhAvg, b.rhAvg, '%', true)}
            </tr>
            <tr>
              {lblTd('Schimmelrisico')}
              {valTd(a.mrAvg, '/100')}
              {deltaCell(a.mrAvg, b.mrAvg, '', true)}
            </tr>
            <tr>
              {lblTd('Gem. buitentemp (schatting)')}
              {valTd(a.estOutTemp, '°C')}
              {valTd(b.estOutTemp, '°C')}
            </tr>
            {sep('Na seizoenscorrectie')}
            <tr>
              {lblTd('Gecorrigeerde score', true)}
              {valTd(result.scoreACorr, '/100', 0)}
              {deltaCell(result.scoreACorr, result.scoreBCorr, '/100', false, 0)}
            </tr>
            <tr>
              {lblTd('Gecorrigeerd schimmelrisico')}
              {valTd(result.mrACorr, '/100')}
              {deltaCell(result.mrACorr, b.mrAvg, '', true)}
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 12, padding: '10px 14px', background: 'var(--surface-tint)', borderRadius: 8, lineHeight: 1.5 }}>
        <span style={{ fontWeight: 600 }}>Interpretatie: </span>
        {interp}
      </div>
    </div>
  )
}

function InterventionList({
  interventions,
  rows,
  onDelete,
}: {
  interventions: Intervention[]
  rows: SensorRow[]
  onDelete: (id: string, label: string) => void
}) {
  if (!interventions.length)
    return <div style={{ fontSize: 'var(--fs-md)', color: 'var(--muted)', padding: '4px 0' }}>Nog geen interventies geregistreerd.</div>

  const deltaSpan = (before: number | null, after: number | null, unit: string, lowerBetter = false) => {
    if (before == null || after == null) return null
    const delta = after - before
    const improved = lowerBetter ? delta < 0 : delta > 0
    const col = improved ? 'var(--ok)' : Math.abs(delta) > 0.5 ? 'var(--crit)' : 'var(--muted)'
    return (
      <span style={{ color: col, fontWeight: 600 }}>
        {delta > 0 ? '+' : ''}
        {delta.toFixed(1)}
        {unit}
      </span>
    )
  }

  return (
    <div>
      {interventions.map((iv) => {
        const ba = beforeAfter(rows, iv.intervention_date)
        return (
          <div
            key={iv.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 6,
              padding: '10px 14px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              marginBottom: 6,
            }}
          >
            <div style={{ display: 'flex', gap: 10, flex: 1 }}>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', fontWeight: 500, minWidth: 76, flexShrink: 0, paddingTop: 2 }}>
                {iv.intervention_date}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)' }}>{iv.label}</span>
                {iv.notes && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginTop: 2 }}>{iv.notes}</div>}
                {ba && (
                  <div style={{ fontSize: 'var(--fs-xs)', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                    <span style={{ color: 'var(--subtle)' }}>2w voor→na:</span>
                    <span style={{ color: 'var(--muted)' }}>CO₂</span> {deltaSpan(ba.co2Before, ba.co2After, ' ppm', true)}
                    <span style={{ color: 'var(--muted)', marginLeft: 6 }}>RV</span> {deltaSpan(ba.rhBefore, ba.rhAfter, '%', true)}
                    <span style={{ color: 'var(--muted)', marginLeft: 6 }}>Score</span> {deltaSpan(ba.scoreBefore, ba.scoreAfter, '/100', false)}
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={() => onDelete(iv.id, iv.label)}
              title="Verwijder"
              aria-label={`Interventie "${iv.label}" verwijderen`}
              style={{ display: 'inline-flex', background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '4px 8px', borderRadius: 'var(--r-sm)', flexShrink: 0 }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
