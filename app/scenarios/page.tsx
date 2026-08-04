'use client'
import { useState, useMemo } from 'react'
import { withBase } from '@/lib/basePath'
import AppShell from '@/components/AppShell'
import MetricCard from '@/components/MetricCard'
import {
  scenarioOutputs,
  pctTimeCo2Above1000,
  healthScore,
  healthLabel,
  co2Status,
  rhStatus,
  mouldStatus,
  WindowHabit,
} from '@/lib/calculations'
import MLPredictionCard from '@/components/MLPredictionCard'
import ChatWidget from '@/components/ChatWidget'

const SEASON_DEFAULTS: Record<string, { outdoorTemp: number; outdoorRh: number }> = {
  winter: { outdoorTemp: 3, outdoorRh: 85 },
  lente: { outdoorTemp: 12, outdoorRh: 70 },
  zomer: { outdoorTemp: 22, outdoorRh: 65 },
  herfst: { outdoorTemp: 10, outdoorRh: 80 },
}

const HABIT_LABELS: Record<WindowHabit, string> = {
  never: 'Nooit',
  occasional: 'Af en toe',
  daily: 'Dagelijks ochtend',
}

function Slider({ label, value, min, max, step, unit, onChange }: any) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} style={{ width: '100%', accentColor: '#3B82F6' }} />
    </div>
  )
}

interface SavedScenario {
  id: string
  name: string
  ach: number
  occupants: number
  outdoorTemp: number
  indoorRh: number
  co2Night: number
  mould: number
  hs: number
}

export default function ScenariosPage() {
  const [season, setSeason] = useState('winter')
  const [outdoorTemp, setOutdoorTemp] = useState(3)
  const [outdoorRh, setOutdoorRh] = useState(85)
  const [occupants, setOccupants] = useState(2)
  const [ach, setAch] = useState(0.8)
  const [heating, setHeating] = useState(true)
  const [windowHabit, setWindowHabit] = useState<WindowHabit>('occasional')
  const [recs, setRecs] = useState<any[]>([])
  const [recsLoading, setRecsLoading] = useState(false)
  const [saved, setSaved] = useState<SavedScenario[]>([])
  const [saveName, setSaveName] = useState('')

  const result = useMemo(
    () => scenarioOutputs({ ach, occupants, outdoorTemp, outdoorRh, heating, windowHabit }),
    [ach, occupants, outdoorTemp, outdoorRh, heating, windowHabit],
  )
  const pctCo2 = pctTimeCo2Above1000(result.co2Night)
  const hs = healthScore(result.co2Night, result.indoorRh, result.mouldRisk)
  const hl = healthLabel(hs)

  function applySeason(s: string) {
    setSeason(s)
    const d = SEASON_DEFAULTS[s]
    if (d) {
      setOutdoorTemp(d.outdoorTemp)
      setOutdoorRh(d.outdoorRh)
    }
  }

  async function getRecommendations() {
    setRecsLoading(true)
    setRecs([])
    const ctx = `CO2 nacht: ${result.co2Night.toFixed(0)} ppm, Binnen RV: ${result.indoorRh.toFixed(0)}%, Schimmelrisico: ${result.mouldRisk.toFixed(0)}/100, Effectieve ACH: ${result.effAch}, Wandtemp: ${result.wallTemp.toFixed(1)}°C, Dauwpunt: ${result.dewpoint.toFixed(1)}°C, Raamventilatie: ${windowHabit}`
    try {
      const r = await fetch(withBase('/api/recommendations'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: ctx }) })
      const d = await r.json()
      if (Array.isArray(d.recommendations) && d.recommendations.length) setRecs(d.recommendations)
      else setRecs([{ title: 'Geen specifieke aanbevelingen', body: 'Op basis van dit scenario zijn er geen acute aandachtspunten.', severity: 'info' }])
    } catch {
      setRecs([{ title: 'Fout', body: 'Kon geen aanbevelingen laden.', severity: 'critical' }])
    } finally {
      setRecsLoading(false)
    }
  }

  function saveScenario() {
    if (saved.length >= 5) setSaved((s) => s.slice(1))
    setSaved((s) => [
      ...s,
      { id: `${s.length}-${saveName || 'scenario'}`, name: saveName || `Scenario ${s.length + 1}`, ach, occupants, outdoorTemp, indoorRh: result.indoorRh, co2Night: result.co2Night, mould: result.mouldRisk, hs },
    ])
    setSaveName('')
  }

  const sevColor = (s: string) => (s === 'critical' ? '#DC2626' : s === 'warning' ? '#D97706' : '#3B82F6')

  return (
    <AppShell title="Scenario's">
      <div className="wz-two-col">
        {/* LEFT — inputs */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 18px', boxShadow: 'var(--shadow-xs)', height: 'fit-content' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 18 }}>Wat-als parameters</div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Seizoen</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {Object.keys(SEASON_DEFAULTS).map((s) => (
                <button key={s} onClick={() => applySeason(s)} style={{ flex: 1, padding: '6px 4px', borderRadius: 8, border: '1px solid var(--border)', background: season === s ? '#3B82F618' : 'var(--surface-2)', color: season === s ? '#3B82F6' : 'var(--muted)', fontSize: 11, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          <Slider label="Buitentemperatuur" value={outdoorTemp} min={-10} max={35} step={0.5} unit="°C" onChange={setOutdoorTemp} />
          <Slider label="Buiten RV" value={outdoorRh} min={20} max={100} step={1} unit="%" onChange={setOutdoorRh} />
          <Slider label="Bewoners (nacht)" value={occupants} min={1} max={6} step={1} unit="" onChange={setOccupants} />
          <Slider label="Ventilatie ACH" value={ach} min={0.3} max={3} step={0.05} unit=" /h" onChange={setAch} />

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text)', cursor: 'pointer', marginBottom: 14 }}>
            <input type="checkbox" checked={heating} onChange={(e) => setHeating(e.target.checked)} /> Verwarming aan
          </label>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Raam ventilatie gewoonte</div>
            <select value={windowHabit} onChange={(e) => setWindowHabit(e.target.value as WindowHabit)} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--text)', fontSize: 13 }}>
              {(Object.keys(HABIT_LABELS) as WindowHabit[]).map((h) => (
                <option key={h} value={h}>
                  {HABIT_LABELS[h]}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 11, color: 'var(--subtle)', marginTop: 6 }}>
              Effectieve ventilatie: <b style={{ color: 'var(--muted)' }}>{result.effAch.toFixed(2)} /h</b> (raam-gewoonte telt mee)
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Naam scenario…" style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--text)', fontSize: 13, outline: 'none' }} />
            <button onClick={saveScenario} disabled={saved.length >= 5} style={{ padding: '8px 14px', background: '#3B82F6', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: saved.length >= 5 ? 0.5 : 1 }}>
              Opslaan
            </button>
          </div>
        </div>

        {/* RIGHT — results */}
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>Resultaten</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <MetricCard title="CO₂ nacht" value={result.co2Night.toFixed(0)} unit="ppm" label={co2Status(result.co2Night).label} labelColor={co2Status(result.co2Night).color} accent="#3B82F6" />
            <MetricCard title="CO₂ dag" value={result.co2Day.toFixed(0)} unit="ppm" label={co2Status(result.co2Day).label} labelColor={co2Status(result.co2Day).color} accent="#3B82F6" />
            <MetricCard title="Binnen RV" value={result.indoorRh.toFixed(0)} unit="%" label={rhStatus(result.indoorRh).label} labelColor={rhStatus(result.indoorRh).color} accent="#10B981" />
            <MetricCard title="Schimmel" value={result.mouldRisk.toFixed(0)} unit="/ 100" label={mouldStatus(result.mouldRisk).label} labelColor={mouldStatus(result.mouldRisk).color} accent="#F97316" progress={result.mouldRisk} />
            <MetricCard title="Wandtemp" value={result.wallTemp.toFixed(1)} unit="°C" accent="#8B5CF6" />
            <MetricCard title="Dauwpunt" value={result.dewpoint.toFixed(1)} unit="°C" accent="#8B5CF6" />
            <MetricCard title="% > 1000 ppm" value={pctCo2.toFixed(0)} unit="%" accent="#3B82F6" progress={pctCo2} />
            <MetricCard title="Gezondheid" value={`${hs}`} unit="/ 100" label={hl.label} labelColor={hl.color} accent={hl.color} progress={hs} />
          </div>

          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14, padding: '8px 12px', background: 'var(--surface-tint)', borderRadius: 8 }}>
            Binnentemperatuur aanname: <b>{result.indoorTemp.toFixed(1)}°C</b> (verwarming {heating ? 'aan' : 'uit'})
          </div>

          <MLPredictionCard />

          <button onClick={getRecommendations} disabled={recsLoading} style={{ width: '100%', padding: '11px', background: 'linear-gradient(135deg,#3B82F6 0%,#2563EB 100%)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', marginBottom: 14, opacity: recsLoading ? 0.7 : 1 }}>
            {recsLoading ? '⏳ Aanbevelingen laden…' : '✨ Aanbevelingen genereren'}
          </button>

          {recs.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {recs.map((r, i) => (
                <div key={i} style={{ padding: '12px 14px', border: `1px solid ${sevColor(r.severity)}28`, borderRadius: 12, background: `${sevColor(r.severity)}08` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: sevColor(r.severity), flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{r.title}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: sevColor(r.severity), background: `${sevColor(r.severity)}18`, padding: '2px 8px', borderRadius: 99, marginLeft: 'auto', textTransform: 'uppercase' }}>{r.severity}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{r.body}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {saved.length > 0 && (
        <div style={{ marginTop: 24, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px', boxShadow: 'var(--shadow-xs)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>Vergelijking opgeslagen scenario&apos;s</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Naam', 'ACH', 'Bewoners', 'Buitentemp', 'CO₂ nacht', 'Binnen RV', 'Schimmel', 'Score'].map((h) => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {saved.map((s) => (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--text)' }}>{s.name}</td>
                    <td style={{ padding: '8px 10px', color: 'var(--muted)' }}>{s.ach}</td>
                    <td style={{ padding: '8px 10px', color: 'var(--muted)' }}>{s.occupants}</td>
                    <td style={{ padding: '8px 10px', color: 'var(--muted)' }}>{s.outdoorTemp}°C</td>
                    <td style={{ padding: '8px 10px', fontWeight: 600, color: co2Status(s.co2Night).color }}>{s.co2Night.toFixed(0)} ppm</td>
                    <td style={{ padding: '8px 10px', color: 'var(--muted)' }}>{s.indoorRh.toFixed(0)}%</td>
                    <td style={{ padding: '8px 10px', fontWeight: 600, color: mouldStatus(s.mould).color }}>{s.mould.toFixed(0)}</td>
                    <td style={{ padding: '8px 10px', fontWeight: 700, color: healthLabel(s.hs).color }}>{s.hs} — {healthLabel(s.hs).label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ChatWidget />
    </AppShell>
  )
}
