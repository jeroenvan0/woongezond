'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { withBase } from '@/lib/basePath'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import ChartCard from '@/components/ChartCard'
import TimeSeriesChart from '@/components/TimeSeriesChart'
import DualAxisChart from '@/components/DualAxisChart'
import ChatWidget from '@/components/ChatWidget'
import SegmentedControl from '@/components/ui/SegmentedControl'
import InfoHint from '@/components/ui/InfoHint'
import ChartTable from '@/components/ui/ChartTable'
import {
  runModels,
  generateDemoData,
  MATERIAL_K2,
  MATERIAL_LABELS,
  woonScoreLabel,
} from '@/lib/mouldModels'
import { calcWallConditions, INSULATION_R, type InsulationClass } from '@/lib/calculations'
import { useStickyState } from '@/lib/useStickyState'
import { useChartColors } from '@/lib/useChartColors'
import { ChevronDown, ChevronUp, FlaskConical } from 'lucide-react'

const INSULATION_LABELS: Record<InsulationClass, string> = {
  poor: 'Slecht — vóór 1975, ongeïsoleerd',
  moderate: 'Matig — 1975–2000, spouwmuur',
  good: 'Goed — na 2000',
  excellent: 'Uitstekend — na 2015, (bijna) energieneutraal',
}

// Conservative heating-season fallback used when no outdoor measurement is
// available for a given sample (e.g. history collected before per-city weather
// ingestion started). Cold outdoor air is the safest assumption for wall risk.
const DEFAULT_OUTDOOR_C = 5

interface OutdoorPoint { t: number; temp: number }

// Don't trust an outdoor reading for a sample more than this far away in time —
// otherwise a single stray hourly point gets smeared across days/weeks of
// indoor data (which would wrongly warm the wall and zero out the risk).
const MAX_OUTDOOR_GAP_MS = 3 * 3_600_000

/**
 * Convert indoor air T/RH into wall-surface T/RH for every sample, matching each
 * indoor timestamp to the nearest hourly outdoor reading. The mould models are
 * calibrated for the wall surface, so this is what makes the risk non-zero.
 */
function buildWallSeries(
  ts: number[],
  temps: number[],
  rhs: number[],
  outdoor: OutdoorPoint[],
  rTotaal: number,
): { wallTemps: number[]; wallRhs: number[] } {
  const wallTemps: number[] = []
  const wallRhs: number[] = []
  let p = 0
  for (let i = 0; i < ts.length; i++) {
    let tOut = DEFAULT_OUTDOOR_C
    if (outdoor.length) {
      while (p + 1 < outdoor.length && outdoor[p + 1].t <= ts[i]) p++
      // p is the last outdoor point at/under ts[i]; pick whichever neighbour is nearer.
      const cand = outdoor[p]
      const next = outdoor[p + 1]
      const nearest = next && Math.abs(next.t - ts[i]) < Math.abs(cand.t - ts[i]) ? next : cand
      // Only use a real reading when it's close enough in time; else fall back.
      if (Math.abs(nearest.t - ts[i]) <= MAX_OUTDOOR_GAP_MS) tOut = nearest.temp
    }
    const { T_wand, RH_wand } = calcWallConditions(temps[i], rhs[i], tOut, rTotaal)
    wallTemps.push(+T_wand.toFixed(2))
    wallRhs.push(+RH_wand.toFixed(2))
  }
  return { wallTemps, wallRhs }
}

const RANGE_OPTIONS = [
  { label: '24 uur', value: '24h', hours: 24 },
  { label: '7 dagen', value: '7d', hours: 168 },
  { label: '14 dagen', value: '14d', hours: 336 },
  { label: '28 dagen', value: '28d', hours: 672 },
]

interface Series {
  ts: number[]
  temps: number[]      // indoor air temperature (measured)
  rhs: number[]        // indoor air RH (measured)
  wallTemps: number[]  // reconstructed wall-surface temperature (model input)
  wallRhs: number[]    // reconstructed wall-surface RH (model input)
  insulation: InsulationClass // per-house wall insulation class
  rTotaal: number      // wall thermal resistance used (m²K/W)
  isDemo: boolean
}

function ScoreHero({
  ws, mi, ser, insulation, rTotaal,
}: {
  ws: number; mi: number; ser: number
  insulation: InsulationClass; rTotaal: number
}) {
  const { label, color, bg } = woonScoreLabel(ws)
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        padding: '24px 28px',
        boxShadow: 'var(--shadow-sm)',
        marginBottom: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>WoonScore — risico</span>
        <InfoHint label="WoonScore" text="WoonScore is een risicoscore: 0–100, hoger = méér schimmelrisico. Dit is de omgekeerde richting van de Gezondheidsscore op het dashboard. Berekend als 0,6·(MI/6·100) + 0,4·SER." />
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 4 }}>
        <span
          style={{
            fontSize: 'var(--fs-hero)',
            fontWeight: 800,
            color,
            lineHeight: 1,
            letterSpacing: '-0.04em',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {ws.toFixed(0)}
        </span>
        <span style={{ fontSize: 18, fontWeight: 500, color: 'var(--muted)', marginLeft: 4 }}>/ 100 risico</span>
      </div>
      <div
        style={{
          fontSize: 'var(--fs-md)',
          fontWeight: 700,
          color,
          background: bg,
          padding: '4px 12px',
          borderRadius: 'var(--r-pill)',
          display: 'inline-block',
          marginTop: 8,
        }}
      >
        {label}
      </div>
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', margin: '6px 0 0' }}>
        Gebaseerd op VTT Mould Index + WUFI-Bio · hoger = meer risico
      </p>
      <div style={{ marginTop: 8, fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--muted)' }}>
        MI {mi.toFixed(2)} / 6 <span style={{ color: 'var(--subtle)' }}>·</span> SER {ser.toFixed(0)} / 100
      </div>
      <div style={{ marginTop: 4, fontSize: 'var(--fs-xs)', color: 'var(--subtle)' }}>
        Muurisolatie: <span style={{ fontWeight: 600, color: 'var(--muted)' }}>{INSULATION_LABELS[insulation]}</span>
        {' '}(R = {rTotaal.toFixed(2)} m²K/W)
      </div>
    </div>
  )
}

// A2/1.3: with fewer than two real readings, do NOT render a fabricated WoonScore in
// hero type. Show an explicit example-view state that says what will appear and when.
function DemoNotice() {
  return (
    <div
      style={{
        background: 'var(--warn-fill)',
        border: '1px solid color-mix(in srgb, var(--warn) 28%, transparent)',
        borderLeft: '3px solid var(--warn)',
        borderRadius: 'var(--r-lg)',
        padding: '18px 22px',
        marginBottom: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text)' }}>
        <FlaskConical size={18} color="var(--warn)" /> Voorbeeldweergave
      </div>
      <p style={{ fontSize: 'var(--fs-md)', color: 'var(--muted)', lineHeight: 1.5, margin: '6px 0 0' }}>
        Er zijn nog geen eigen metingen. De grafieken hieronder tonen <strong>voorbeelddata</strong> zodat je ziet
        hoe deze pagina eruit gaat zien. Je persoonlijke WoonScore verschijnt zodra de sensor een paar dagen heeft
        gemeten.
      </p>
    </div>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      style={{
        fontSize: 11.5,
        color: 'var(--text)',
        background: 'rgba(128,128,128,0.12)',
        borderRadius: 4,
        padding: '2px 6px',
        fontFamily: 'monospace',
      }}
    >
      {children}
    </code>
  )
}

function Explanation() {
  const h = (t: string) => (
    <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: '14px 0 5px' }}>{t}</p>
  )
  const p = (t: string) => (
    <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 4px' }}>{t}</p>
  )
  const thr = (label: string, c: string, desc: string) => (
    <div style={{ fontSize: 12, marginBottom: 3 }}>
      <span style={{ fontWeight: 600, color: c }}>{label}</span>
      <span style={{ color: 'var(--muted)' }}> — {desc}</span>
    </div>
  )
  return (
    <div style={{ marginTop: 4 }}>
      {h('Wandcondities (modelinvoer)')}
      {p(
        'Schimmel groeit op het koudste oppervlak — de buitenmuur — niet in de binnenlucht. De gemeten binnenlucht-T en -RV worden daarom eerst omgerekend naar de wandoppervlaktemperatuur en -vochtigheid met het buitenklimaat en de thermische weerstand van de muur (ISO 6946). Pas die wandcondities gaan in de VTT- en WUFI-Bio-modellen.',
      )}
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.9, margin: '5px 0 10px' }}>
        <Code>T_wand = T_binnen − (T_binnen − T_buiten)·(Rsi/R_totaal)</Code>
        <br />
        <Code>RV_wand = RV_binnen·(p_sat(T_binnen)/p_sat(T_wand))</Code>
        <br />
        Rsi = 0,13 m²K/W (ISO 6946). R_totaal = thermische weerstand muur per woning op basis van
        isolatieklasse (slecht 0,35 · matig 0,90 · goed 2,50 · uitstekend 4,00 m²K/W). Buitentemperatuur per
        uur uit de weerhistorie van de stad.
      </p>
      {h('VTT Schimmelindex (MI, schaal 0–6)')}
      {p(
        'Modelleert biologische schimmelgroei op bouwmaterialen op basis van temperatuur en luchtvochtigheid. Schaalmaat 0–6: ≥1 is zichtbare schimmel op gevoelig materiaal, ≥2 significante aantasting.',
      )}
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.9, margin: '5px 0 10px' }}>
        Groeistap: <Code>dM/dt = k₁·k₂·[1/(7·eᴬ+1) − W/6]</Code>
        <br />
        <Code>A = 0,3·(RV − RV_krit)/(100 − RV_krit)</Code>
        <br />
        <Code>RV_krit = max(80, −0,00267·T³ + 0,160·T² − 3,13·T + 100)</Code>
        <br />
        k₁ = 1 bij 0≤T≤50°C en RV≥RV_krit, anders 0. k₂ = materiaalklasse (hout 2,0 · gips 1,0 · beton 0,5 ·
        behandeld 0,2). W/6 = vertraging naarmate MI stijgt.
      </p>
      {h('WUFI-Bio Wateractiviteit (SER, schaal 0–100)')}
      {p(
        'Fraunhofer IBP-model: accumuleert groeipotentieel (GP) zodra de wateractiviteit (aw = RV/100) boven de materiaalspecifieke kritieke drempel uitkomt.',
      )}
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.9, margin: '5px 0 10px' }}>
        <Code>aw_krit(T) = max(0,70; 0,80 − 0,0007·T)</Code>
        <br />
        Als aw ≥ aw_krit en 0≤T≤40°C: <Code>GP += (aw − aw_krit)·dt</Code>
        <br />
        Anders: <Code>GP = max(0, GP − 0,05·dt)</Code>
        <br />
        <Code>SER = min(100, GP/50·100)</Code>
      </p>
      {h('WoonScore (0–100, hoger = meer risico)')}
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '5px 0 10px' }}>
        <Code>WoonScore = 0,6·(MI/6·100) + 0,4·SER</Code>
      </p>
      {h('Drempelwaarden')}
      <div style={{ margin: '5px 0 12px', paddingLeft: 4 }}>
        {thr('MI < 1', 'var(--ok)', 'laag risico')}
        {thr('1 ≤ MI < 2', 'var(--warn)', 'verhoogd risico — zichtbare schimmel mogelijk')}
        {thr('MI ≥ 2', 'var(--crit)', 'hoog risico — significante aantasting')}
        <div style={{ height: 6 }} />
        {thr('SER < 30', 'var(--ok)', 'laag risico')}
        {thr('30 ≤ SER < 60', 'var(--warn)', 'verhoogd risico')}
        {thr('SER ≥ 60', 'var(--crit)', 'hoog risico — actie gewenst')}
      </div>
      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '14px 0 10px' }} />
      <p style={{ fontSize: 11.5, color: 'var(--subtle)', margin: '0 0 8px', lineHeight: 1.6 }}>
        <strong>Bronnen: </strong>VTT model: Hukka &amp; Viitanen (1999), Ojanen et al. (2010), VTT Technical
        Research Centre of Finland. WUFI-Bio: Fraunhofer IBP.
      </p>
      <p style={{ fontSize: 11.5, color: 'var(--subtle)', fontStyle: 'italic', margin: 0, lineHeight: 1.6 }}>
        Deze scores zijn risico-indicaties op basis van gevalideerde bouwfysische modellen en zijn geen
        vervanging voor een bouwkundig onderzoek.
      </p>
    </div>
  )
}

export default function SchimmelrisicoPage() {
  const router = useRouter()
  const supabase = createClient()
  const [series, setSeries] = useState<Series | null>(null)
  const [range, setRange] = useStickyState('wz-schimmel-range', '7d')
  const [material, setMaterial] = useStickyState('wz-schimmel-material', 'gypsum')
  const [showExplain, setShowExplain] = useState(false)
  const chartC = useChartColors()

  useEffect(() => {
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      const makeDemo = (): Series => {
        const demo = generateDemoData(28)
        // No outdoor history for demo data — buildWallSeries falls back to the
        // conservative heating-season outdoor temperature; assume 'poor' insulation.
        const rTotaal = INSULATION_R.poor
        const { wallTemps, wallRhs } = buildWallSeries(demo.timestampsMs, demo.temps, demo.rhs, [], rTotaal)
        return {
          ts: demo.timestampsMs, temps: demo.temps, rhs: demo.rhs,
          wallTemps, wallRhs, insulation: 'poor', rTotaal, isDemo: true,
        }
      }
      try {
        const [r, wr] = await Promise.all([
          fetch(withBase('/api/data?minutes=' + 28 * 1440)),
          fetch(withBase('/api/weather/history?minutes=' + 28 * 1440)),
        ])
        const d = await r.json()
        const rows = (d.rows ?? []).filter((x: any) => x.temperature != null && x.humidity != null)
        if (rows.length < 2) {
          setSeries(makeDemo())
        } else {
          const wd = await wr.json().catch(() => ({ rows: [] }))
          const outdoor: OutdoorPoint[] = (wd.rows ?? [])
            .filter((x: any) => x.temp != null)
            .map((x: any) => ({ t: new Date(x.observed_at).getTime(), temp: +x.temp }))
          const insulation: InsulationClass = (wd.insulation as InsulationClass) ?? 'poor'
          const rTotaal = wd.rTotaal ?? INSULATION_R[insulation] ?? INSULATION_R.poor
          const ts = rows.map((x: any) => new Date(x.created_at).getTime())
          const temps = rows.map((x: any) => +(+x.temperature).toFixed(1))
          const rhs = rows.map((x: any) => +(+x.humidity).toFixed(1))
          const { wallTemps, wallRhs } = buildWallSeries(ts, temps, rhs, outdoor, rTotaal)
          setSeries({ ts, temps, rhs, wallTemps, wallRhs, insulation, rTotaal, isDemo: false })
        }
      } catch {
        setSeries(makeDemo())
      }
    })()
  }, [router, supabase])

  const computed = useMemo(() => {
    if (!series) return null
    const k2 = MATERIAL_K2[material] ?? 1.0
    // Models run on reconstructed wall-surface conditions, not indoor air.
    const res = runModels(series.ts, series.wallTemps, series.wallRhs, k2)
    const hours = RANGE_OPTIONS.find((o) => o.value === range)?.hours ?? 168
    const cutoff = series.ts[series.ts.length - 1] - hours * 3_600_000
    const idx = series.ts.map((t, i) => [t, i] as const).filter(([t]) => t >= cutoff).map(([, i]) => i)
    const useIdx = idx.length ? idx : series.ts.map((_, i) => i)
    return {
      miPts: useIdx.map((i) => ({ t: series.ts[i], v: res.mi[i] })),
      serPts: useIdx.map((i) => ({ t: series.ts[i], v: res.ser[i] })),
      trhPts: useIdx.map((i) => ({ t: series.ts[i], a: series.temps[i], b: series.rhs[i] })),
      wsLast: res.woonScore[res.woonScore.length - 1],
      miLast: res.mi[res.mi.length - 1],
      serLast: res.ser[res.ser.length - 1],
    }
  }, [series, material, range])

  return (
    <AppShell title="Schimmelrisico">
      {!computed ? (
        <div style={{ color: 'var(--muted)', fontSize: 'var(--fs-md)', padding: '24px 0' }}>Laden…</div>
      ) : series!.isDemo ? (
        <DemoNotice />
      ) : (
        <ScoreHero
          ws={computed.wsLast}
          mi={computed.miLast}
          ser={computed.serLast}
          insulation={series!.insulation}
          rTotaal={series!.rTotaal}
        />
      )}

      {/* Controls */}
      <div
        style={{
          display: 'flex',
          gap: 24,
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          padding: '16px 18px',
          marginBottom: 14,
          boxShadow: 'var(--shadow-xs)',
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <div
            style={{
              fontSize: 'var(--fs-xs)',
              fontWeight: 600,
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 8,
            }}
          >
            Tijdsperiode
          </div>
          <SegmentedControl
            ariaLabel="Tijdsperiode"
            options={RANGE_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
            value={range}
            onChange={setRange}
          />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label
            htmlFor="wz-materiaal"
            style={{
              display: 'block',
              fontSize: 'var(--fs-xs)',
              fontWeight: 600,
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 8,
            }}
          >
            Materiaalklasse (k₂)
          </label>
          <select
            id="wz-materiaal"
            value={material}
            onChange={(e) => setMaterial(e.target.value)}
            style={{
              padding: '8px 10px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-sm)',
              background: 'var(--surface-2)',
              color: 'var(--text)',
              fontSize: 'var(--fs-md)',
              width: '100%',
              maxWidth: 280,
            }}
          >
            {Object.entries(MATERIAL_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      {computed && (
        <div style={series!.isDemo ? { opacity: 0.85 } : undefined}>
          <ChartCard label={`VTT Schimmelindex (MI)${series!.isDemo ? ' — voorbeelddata' : ''}`}>
            <TimeSeriesChart
              id="mi"
              data={computed.miPts}
              color={chartC.mould}
              unit="MI"
              decimals={2}
              height={220}
              refLines={[
                { value: 1, label: 'MI 1 — verhoogd', color: chartC.warn },
                { value: 2, label: 'MI 2 — hoog', color: chartC.crit },
              ]}
            />
            <ChartTable caption="VTT Schimmelindex per meetpunt" columns={[{ key: 't', label: 'Tijd' }, { key: 'v', label: 'MI' }]} rows={computed.miPts.map((p) => ({ t: new Date(p.t).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }), v: p.v.toFixed(2) }))} />
          </ChartCard>
          <ChartCard label={`WUFI-Bio Wateractiviteit (SER)${series!.isDemo ? ' — voorbeelddata' : ''}`}>
            <TimeSeriesChart
              id="ser"
              data={computed.serPts}
              color={chartC.crit}
              unit="SER"
              decimals={0}
              height={220}
              refLines={[
                { value: 30, label: 'SER 30 — verhoogd', color: chartC.warn },
                { value: 60, label: 'SER 60 — hoog', color: chartC.crit },
              ]}
            />
            <ChartTable caption="WUFI-Bio wateractiviteit per meetpunt" columns={[{ key: 't', label: 'Tijd' }, { key: 'v', label: 'SER' }]} rows={computed.serPts.map((p) => ({ t: new Date(p.t).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }), v: p.v.toFixed(0) }))} />
          </ChartCard>
          <ChartCard label={`Binnenklimaat (gemeten) — modelinvoer is wandconditie${series!.isDemo ? ' — voorbeelddata' : ''}`}>
            <DualAxisChart
              data={computed.trhPts}
              aLabel="Temperatuur (binnen)"
              bLabel="Luchtvochtigheid (binnen)"
              aColor={chartC.temp}
              bColor={chartC.rh}
              aUnit="°C"
              bUnit="%"
              height={220}
              bRefLine={{ value: 70, label: 'RV 70% (binnen verhoogd)', color: chartC.warn }}
            />
            <ChartTable caption="Binnenklimaat per meetpunt" columns={[{ key: 't', label: 'Tijd' }, { key: 'a', label: 'Temp (°C)' }, { key: 'b', label: 'RV (%)' }]} rows={computed.trhPts.map((p) => ({ t: new Date(p.t).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }), a: p.a.toFixed(1), b: p.b.toFixed(1) }))} />
          </ChartCard>
        </div>
      )}

      {/* Explanation */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
          padding: '16px 18px',
          marginTop: 14,
          boxShadow: 'var(--shadow-xs)',
        }}
      >
        <button
          onClick={() => setShowExplain((s) => !s)}
          aria-expanded={showExplain}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 'var(--fs-md)',
            fontWeight: 600,
            color: 'var(--muted)',
            padding: 0,
            fontFamily: 'inherit',
          }}
        >
          {showExplain ? <ChevronUp size={15} /> : <ChevronDown size={15} />} Uitleg modellen
        </button>
        {showExplain && <Explanation />}
      </div>

      <ChatWidget />
    </AppShell>
  )
}
