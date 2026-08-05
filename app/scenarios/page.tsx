'use client'
import { useState, useMemo } from 'react'
import { withBase } from '@/lib/basePath'
import AppShell from '@/components/AppShell'
import MetricCard from '@/components/MetricCard'
import SegmentedControl from '@/components/ui/SegmentedControl'
import Button from '@/components/ui/Button'
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
import { useStickyState } from '@/lib/useStickyState'
import { Sparkles, Trash2 } from 'lucide-react'

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
  const id = `sc-${label.replace(/[^a-z0-9]/gi, '').toLowerCase()}`
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <label htmlFor={id} style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
        <span style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text)' }}>{value}{unit}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} style={{ width: '100%', accentColor: 'var(--brand)' }} />
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
  // F4: saved scenarios persist across reloads like every other filter, instead of
  // living in transient React state that a refresh silently wiped.
  const [saved, setSaved] = useStickyState<SavedScenario[]>('wz-saved-scenarios', [])
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
    setSaved((s) => {
      const entry: SavedScenario = {
        id: `${Date.now()}`,
        name: saveName || `Scenario ${s.length + 1}`,
        ach, occupants, outdoorTemp,
        indoorRh: result.indoorRh, co2Night: result.co2Night, mould: result.mouldRisk, hs,
      }
      // Cap at 5, dropping the oldest — but the cap is no longer silent (F4).
      return [...s, entry].slice(-5)
    })
    setSaveName('')
  }

  function deleteScenario(id: string) {
    setSaved((s) => s.filter((x) => x.id !== id))
  }

  const sevColor = (s: string) => (s === 'critical' ? 'var(--crit)' : s === 'warning' ? 'var(--warn)' : 'var(--accent)')

  return (
    <AppShell title="Scenario's">
      <div className="wz-two-col">
        {/* LEFT — inputs */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '20px 18px', boxShadow: 'var(--shadow-xs)', height: 'fit-content' }}>
          <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text)', marginBottom: 18 }}>Wat-als parameters</div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Seizoen</div>
            <SegmentedControl
              ariaLabel="Seizoen"
              fill
              options={Object.keys(SEASON_DEFAULTS).map((s) => ({ label: s.charAt(0).toUpperCase() + s.slice(1), value: s }))}
              value={season}
              onChange={applySeason}
            />
          </div>

          <Slider label="Buitentemperatuur" value={outdoorTemp} min={-10} max={35} step={0.5} unit="°C" onChange={setOutdoorTemp} />
          <Slider label="Buiten RV" value={outdoorRh} min={20} max={100} step={1} unit="%" onChange={setOutdoorRh} />
          <Slider label="Bewoners (nacht)" value={occupants} min={1} max={6} step={1} unit="" onChange={setOccupants} />
          <Slider label="Ventilatie ACH" value={ach} min={0.3} max={3} step={0.05} unit=" /h" onChange={setAch} />

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-md)', color: 'var(--text)', cursor: 'pointer', marginBottom: 14 }}>
            <input type="checkbox" checked={heating} onChange={(e) => setHeating(e.target.checked)} /> Verwarming aan
          </label>

          <div style={{ marginBottom: 16 }}>
            <label htmlFor="sc-habit" style={{ display: 'block', fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Raam ventilatie gewoonte</label>
            <select id="sc-habit" value={windowHabit} onChange={(e) => setWindowHabit(e.target.value as WindowHabit)} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 'var(--fs-md)' }}>
              {(Object.keys(HABIT_LABELS) as WindowHabit[]).map((h) => (
                <option key={h} value={h}>
                  {HABIT_LABELS[h]}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--subtle)', marginTop: 6 }}>
              Effectieve ventilatie: <b style={{ color: 'var(--muted)' }}>{result.effAch.toFixed(2)} /h</b> (raam-gewoonte telt mee)
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Naam scenario…" aria-label="Naam scenario" style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 'var(--fs-md)', outline: 'none' }} />
            <Button variant="primary" onClick={saveScenario}>Opslaan</Button>
          </div>
        </div>

        {/* RIGHT — results */}
        <div>
          <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>Resultaten</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <MetricCard title="CO₂ nacht" value={result.co2Night.toFixed(0)} unit="ppm" label={co2Status(result.co2Night).label} labelColor={co2Status(result.co2Night).color} accent="var(--c-co2)" />
            <MetricCard title="CO₂ dag" value={result.co2Day.toFixed(0)} unit="ppm" label={co2Status(result.co2Day).label} labelColor={co2Status(result.co2Day).color} accent="var(--c-co2)" />
            <MetricCard title="Binnen RV" value={result.indoorRh.toFixed(0)} unit="%" label={rhStatus(result.indoorRh).label} labelColor={rhStatus(result.indoorRh).color} accent="var(--c-rh)" />
            <MetricCard title="Schimmel" value={result.mouldRisk.toFixed(0)} unit="/ 100" label={mouldStatus(result.mouldRisk).label} labelColor={mouldStatus(result.mouldRisk).color} accent="var(--c-mould)" progress={result.mouldRisk} />
            <MetricCard title="Wandtemp" value={result.wallTemp.toFixed(1)} unit="°C" accent="var(--c-dew)" />
            <MetricCard title="Dauwpunt" value={result.dewpoint.toFixed(1)} unit="°C" accent="var(--c-dew)" />
            <MetricCard title="% > 1000 ppm" value={pctCo2.toFixed(0)} unit="%" accent="var(--accent)" progress={pctCo2} />
            <MetricCard title="Gezondheid" value={`${hs}`} unit="/ 100" label={hl.label} labelColor={hl.color} accent={hl.color} progress={hs} />
          </div>

          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', marginBottom: 14, padding: '8px 12px', background: 'var(--surface-tint)', borderRadius: 'var(--r-sm)' }}>
            Binnentemperatuur aanname: <b>{result.indoorTemp.toFixed(1)}°C</b> (verwarming {heating ? 'aan' : 'uit'})
          </div>

          <MLPredictionCard />

          <Button variant="primary" onClick={getRecommendations} disabled={recsLoading} icon={<Sparkles size={15} />} style={{ width: '100%', marginBottom: 14 }}>
            {recsLoading ? 'Aanbevelingen laden…' : 'Aanbevelingen genereren'}
          </Button>

          {recs.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {recs.map((r, i) => (
                <div key={i} style={{ padding: '12px 14px', border: `1px solid color-mix(in srgb, ${sevColor(r.severity)} 24%, transparent)`, borderRadius: 'var(--r-md)', background: `color-mix(in srgb, ${sevColor(r.severity)} 7%, transparent)` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: sevColor(r.severity), flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, fontSize: 'var(--fs-md)', color: 'var(--text)' }}>{r.title}</span>
                    <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: sevColor(r.severity), background: `color-mix(in srgb, ${sevColor(r.severity)} 15%, transparent)`, padding: '2px 8px', borderRadius: 'var(--r-pill)', marginLeft: 'auto', textTransform: 'uppercase' }}>{r.severity}</span>
                  </div>
                  <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', lineHeight: 1.5 }}>{r.body}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {saved.length > 0 && (
        <div style={{ marginTop: 24, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '16px 18px', boxShadow: 'var(--shadow-xs)' }}>
          <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>Vergelijking opgeslagen scenario&apos;s</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Naam', 'ACH', 'Bewoners', 'Buitentemp', 'CO₂ nacht', 'Binnen RV', 'Schimmel', 'Score', ''].map((h, i) => (
                    <th key={i} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{h}</th>
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
                    <td style={{ padding: '8px 10px' }}>
                      <button onClick={() => deleteScenario(s.id)} title="Verwijder scenario" aria-label={`Scenario "${s.name}" verwijderen`} style={{ display: 'inline-flex', background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 4 }}>
                        <Trash2 size={14} />
                      </button>
                    </td>
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
