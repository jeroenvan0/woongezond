'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import ChartCard from '@/components/ChartCard'
import TimeSeriesChart from '@/components/TimeSeriesChart'
import DualAxisChart from '@/components/DualAxisChart'
import ChatWidget from '@/components/ChatWidget'
import SegmentedControl from '@/components/ui/SegmentedControl'
import InfoHint from '@/components/ui/InfoHint'
import ChartTable from '@/components/ui/ChartTable'
import DataBanner, { DataError, describeError } from '@/components/DataBanner'
import MouldYearChart from '@/components/MouldYearChart'
import {
  assessMould, demoInputs, mouldIndexText, growthSentence, SENSITIVITY_LABELS, WINTER_TE,
  type Level, type LoadLevel, type MouldInputs, type SensitivityClass, type FSource, type MouldAssessment,
} from '@/lib/mouldRisk'
import { fetchMouldInputs } from '@/lib/mouldLoad'
import { useStickyState } from '@/lib/useStickyState'
import { useChartColors } from '@/lib/useChartColors'
import { useSelectedDevice, useDeviceSelectionReady } from '@/lib/useSelectedDevice'
import { ChevronDown, ChevronUp, FlaskConical, Snowflake, Sun, Droplets, Home } from 'lucide-react'

// Schimmelrisico per sensor (lib/mouldRisk.ts): nu — ook in de zomer — op de koudste
// plek, de verwachting voor de winter, en de vochtbelasting die beide aandrijft.

const RANGE_OPTIONS = [
  { label: 'Week', value: '7d', hours: 168 },
  { label: '2 weken', value: '14d', hours: 336 },
  { label: 'Maand', value: '28d', hours: 672 },
  { label: '3 maanden', value: '90d', hours: 2160 },
]

// Oude opgeslagen materiaalkeuzes (k₂ van de Flask-port) → gevoeligheidsklasse.
const LEGACY_MATERIAL: Record<string, SensitivityClass> = { wood: 'VS', gypsum: 'S', concrete: 'MR', treated: 'R' }

const LEVEL_STYLE: Record<Level, { color: string; bg: string; label: string }> = {
  laag: { color: 'var(--ok)', bg: 'var(--ok-fill)', label: 'Laag' },
  verhoogd: { color: 'var(--warn)', bg: 'var(--warn-fill)', label: 'Verhoogd' },
  hoog: { color: 'var(--crit)', bg: 'var(--crit-fill)', label: 'Hoog' },
}
const LOAD_STYLE: Record<LoadLevel, Level> = { laag: 'laag', normaal: 'laag', hoog: 'verhoogd', 'zeer hoog': 'hoog' }
const F_SOURCE_TEXT: Record<FSource, string> = {
  gemeten: 'gemeten in de woning',
  bouwperiode: 'geschat uit het bouwjaar',
  renovatie: 'geschat uit bouwjaar en renovatie',
  isolatie: 'geschat uit de isolatieklasse',
  standaard: 'onbekend, voorzichtige aanname',
}

// Bron van f in woorden; bij een oud huis zonder renovatieantwoord zeggen we dat erbij,
// anders is 0,53 i.p.v. 0,50 een raadsel.
const fText = (r: MouldAssessment, profile?: MouldInputs['profile']) =>
  F_SOURCE_TEXT[r.fSource] + (r.fSource === 'bouwperiode' && r.f < 0.7 && (!profile?.renovation || profile.renovation === 'onbekend') ? '; of het huis later geïsoleerd is, weten we niet' : '')
const pct = (p: number) => `${Math.round(p * 100)}%`
const nl = (v: number, d = 0) => v.toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtT = (t: number) => new Date(t).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

function Pill({ level, text }: { level: Level; text?: string }) {
  const s = LEVEL_STYLE[level]
  return (
    <span style={{ display: 'inline-block', fontSize: 'var(--fs-md)', fontWeight: 700, color: s.color, background: s.bg, padding: '3px 11px', borderRadius: 'var(--r-pill)' }}>
      {text ?? s.label}
    </span>
  )
}

function RiskCard({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '18px 20px', boxShadow: 'var(--shadow-sm)', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <span style={{ color: 'var(--muted)', display: 'inline-flex' }}>{icon}</span>
        <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</span>
        <InfoHint label={title} text={hint} />
      </div>
      {children}
    </div>
  )
}

function Fact({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 'var(--fs-md)', color: 'var(--muted)', lineHeight: 1.5, margin: '8px 0 0' }}>{children}</p>
}

function DemoNotice() {
  return (
    <div style={{ background: 'var(--warn-fill)', border: '1px solid color-mix(in srgb, var(--warn) 28%, transparent)', borderLeft: '3px solid var(--warn)', borderRadius: 'var(--r-lg)', padding: '18px 22px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text)' }}>
        <FlaskConical size={18} color="var(--warn)" /> Voorbeeldweergave
      </div>
      <p style={{ fontSize: 'var(--fs-md)', color: 'var(--muted)', lineHeight: 1.5, margin: '6px 0 0' }}>
        Er zijn nog geen eigen metingen. Hieronder staat een <strong>voorbeeld</strong> van een vochtige slaapkamer in de
        herfst, zodat je ziet hoe deze pagina eruit gaat zien. Je eigen beoordeling verschijnt zodra de sensor meet.
      </p>
    </div>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return <code style={{ fontSize: 11.5, color: 'var(--text)', background: 'rgba(128,128,128,0.12)', borderRadius: 4, padding: '2px 6px', fontFamily: 'monospace' }}>{children}</code>
}

function Explanation() {
  const h = (t: string) => <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: '14px 0 5px' }}>{t}</p>
  const p = (t: React.ReactNode) => <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 6px' }}>{t}</p>
  return (
    <div style={{ marginTop: 4 }}>
      {h('1. De koudste plek')}
      {p('Schimmel groeit niet in de lucht maar op het koudste oppervlak: een buitenhoek, een latei boven het raam, de vloerrand, achter een kast. Daar is de lucht afgekoeld en dus vochtiger. We rekenen de gemeten binnenlucht om naar die plek:')}
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.9, margin: '0 0 8px' }}>
        <Code>θ_opp = θ_buiten + f·(θ_binnen − θ_buiten)</Code> <Code>RV_opp = p_binnen / p_sat(θ_opp)</Code>
        <br />
        f is de temperatuurfactor van die plek (NEN 2778 / ISO 13788). Het Bouwbesluit eist ≥ 0,65 voor nieuwbouw; een
        ongeïsoleerde hoek in een vooroorlogse woning zit rond 0,5. Zonder meting schatten we f uit het bouwjaar (vóór 1945
        0,50 · 1945–74 0,55 · 1975–91 0,65 · 1992–2005 0,70 · na 2005 0,75). De buitentemperatuur is uurlijks gemeten en
        gedempt over ~12 uur, omdat een stenen muur niet meteen afkoelt. In een souterrain rekenen we met de koelere bodem.
      </p>
      {h('2. Groei: de VTT-schimmelindex (0–6)')}
      {p('Boven ongeveer 80% aan het oppervlak kan schimmel groeien, maar dat kost dagen tot weken. Het VTT-model (Hukka & Viitanen 1999, uitgebreid door Ojanen e.a. 2010) telt die groei op en laat hem langzaam afnemen als het droger wordt. 1 = groei begint (microscopisch), 3 = zichtbare plekjes, 6 = volledig bedekt. Hoe gevoelig het materiaal is (behang en gips gevoelig, beton minder) kun je hieronder kiezen.')}
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.9, margin: '0 0 8px' }}>
        <Code>dM/dt = k₁·k₂ / (7·exp(−0,68·ln T − 13,9·ln RV + 66,02))</Code> per dag, alleen boven de kritieke RV.
      </p>
      {h('3. Vochtbelasting')}
      {p('Hoeveel vochtiger is het binnen dan buiten, in gram water per m³ lucht? Dat hangt af van het huishouden (koken, douchen, was drogen, adem) en van ventilatie. In de zomer staan ramen open en is het verschil klein; ISO 13788 rekent daarom met een seizoenslijn die bij 20 °C buiten naar nul gaat. Wij rekenen gemeten waarden terug naar winterniveau. Een normaal huishouden zit volgens ISO 13788 rond 4 g/m³, een druk bewoond huis rond 6.')}
      {p('In de zomer schatten we dit alleen op koele dagen of nachten (buiten ≤ 15 °C), en dan is de schatting onzeker: een kleine meetfout wordt bij warm weer sterk vergroot. Zonder koele dagen gebruiken we de vragenlijst. De betrouwbaarheid staat erbij en wordt vanzelf beter vanaf oktober.')}
      {h('Achter een kast')}
      {p('Achter een kast of bed tegen de buitenmuur komt weinig warmte bij de muur. Daar is het flink kouder dan in een open hoek (in het model: temperatuurfactor 0,1 lager), en daar begint schimmel vaak. Staat er zo’n kast, dan rekenen we met die plek; weten we het niet, dan telt die plek voor de helft mee in de kans. Kasten 5–10 cm van de buitenmuur zetten helpt vaak meer dan je zou denken.')}
      {h('4. Verwachting voor de winter')}
      {p(`We nemen een gemiddelde januaridag (${nl(WINTER_TE, 1)} °C buiten, 88% RV), tellen de vochtbelasting erbij en rekenen de koudste plek uit. De binnentemperatuur is gemeten zodra het stookseizoen begint; daarvoor een aanname per kamer (slaapkamer 17 °C, woonkamer 20 °C). Daarna rekent het VTT-model het komende seizoen maand voor maand door, 200 keer, telkens met een iets andere vochtbelasting, binnentemperatuur en temperatuurfactor binnen wat we niet zeker weten (bouwjaar geschat of gemeten, wel of niet gerenoveerd, zomer- of wintermeting). Het deel van die berekeningen met zichtbare schimmel is de kans. Zichtbaar betekent index 3, ook de grens in de Amerikaanse norm ASHRAE 160. Label: laag onder 15% kans, hoog vanaf 50%. Niet de 80%-grens uit ISO 13788 alleen: dat is een ontwerpgrens met veiligheidsmarge, en daarmee kreeg bijna elk oud huis “hoog”. Het groeimodel werkt bijna als een schakelaar: per huis is de uitkomst meestal ‘niets’ of ‘zeker’, met een scherpe grens rond 4–5 g/m³ vocht in een oud huis. De kans komt vooral uit wat we niet precies weten: vocht, isolatie, temperatuur en of er een kast tegen de buitenmuur staat. Microscopische groei, die al geur en sporen geeft, komt eerder dan zichtbare schimmel en telt mee in het label: vanaf 30% kans daarop is het risico verhoogd. Let op: dit is de onzekerheid van het model, nog geen kans die aan echte huizen is afgemeten. Dat doet de pilot.`)}
      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '14px 0 10px' }} />
      <p style={{ fontSize: 11.5, color: 'var(--subtle)', fontStyle: 'italic', margin: 0, lineHeight: 1.6 }}>
        Dit is een risico-inschatting met bouwfysische modellen, geen bouwkundig onderzoek. De grootste onzekerheid is f: één meting met een
        infraroodthermometer in de koudste hoek op een koude ochtend maakt de uitkomst veel preciezer.
      </p>
    </div>
  )
}


function Chip({ level, children }: { level: Level | null; children: React.ReactNode }) {
  const c = level ? LEVEL_STYLE[level].color : 'var(--muted)'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', color: 'var(--text)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-pill)', padding: '4px 11px' }}>
      <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: c, flexShrink: 0 }} />
      {children}
    </span>
  )
}

function HouseProfileSection({ r, isDemo, profile }: { r: MouldAssessment; isDemo: boolean; profile?: MouldInputs['profile'] }) {
  const w = r.winter
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '18px 20px', boxShadow: 'var(--shadow-sm)', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <span style={{ color: 'var(--muted)', display: 'inline-flex' }}><Home size={16} /></span>
        <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Schimmelprofiel van dit huis{isDemo ? ' — voorbeeld' : ''}</span>
        <InfoHint label="Schimmelprofiel" text="Waar zit het risico: in het gebouw (koude plekken) of in het vocht in de lucht? Samen bepalen ze hoe het huis zich door het jaar heen gedraagt." />
      </div>
      <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>{r.profile.title}</div>
      <p style={{ fontSize: 'var(--fs-md)', color: 'var(--muted)', lineHeight: 1.55, margin: '6px 0 12px', maxWidth: 760 }}>{r.profile.text}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <Chip level={r.profile.cold ? 'hoog' : 'laag'}>Koudste plek f = {nl(r.f, 2)} ({fText(r, profile)})</Chip>
        <Chip level={LOAD_STYLE[r.load.level]}>Vochtbelasting {r.load.level}: {nl(r.load.dv0, 1)} g/m³</Chip>
        <Chip level={null}>Winter binnen {nl(w.ti, 0)} °C ({w.tiMeasured ? 'gemeten' : 'aanname'})</Chip>
      </div>

      <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>Hoe het door het jaar gaat</div>
      <p style={{ fontSize: 'var(--fs-md)', color: 'var(--muted)', margin: '0 0 6px', lineHeight: 1.5 }}>{growthSentence(r.yearGrowth)}</p>
      <MouldYearChart data={r.year} />
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--subtle)', margin: '4px 0 16px', lineHeight: 1.5 }}>
        Balken: verwachte vochtigheid op de koudste plek bij een gemiddelde maand (ISO 13788-maandmethode); oranje = boven 80%, groei mogelijk; rood = zichtbare schimmel verwacht. Stippen: berekend uit de eigen metingen.
        Koude nachten en vochtige dagen liggen hoger dan het maandgemiddelde.
      </p>

      <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Wat helpt deze winter?</div>
      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', fontSize: 'var(--fs-md)', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
          <span style={{ color: 'var(--muted)' }}>Zoals het nu gaat</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>kans {pct(w.pVisible)} · hoek ~{nl(w.rhSurface)}%</span><Pill level={w.level} /></span>
        </div>
        {r.whatIf.map((v) => (
          <div key={v.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', fontSize: 'var(--fs-md)', padding: '4px 0' }}>
            <span style={{ color: 'var(--text)', minWidth: 0 }}>{v.label}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ color: v.better ? 'var(--text)' : 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>kans {pct(v.pVisible)} · hoek ~{nl(v.rhSurface)}%</span><Pill level={v.level} /></span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--subtle)', margin: '8px 0 0', lineHeight: 1.5 }}>
        Kans: zichtbare schimmel in het komende seizoen. Hoek: op een gemiddelde januaridag. Ventileren telt als 1,5 g/m³ minder vocht; na-isolatie als temperatuurfactor 0,75.
      </p>
    </div>
  )
}

export default function SchimmelrisicoPage() {
  const router = useRouter()
  const supabase = createClient()
  const [inputs, setInputs] = useState<(MouldInputs & { isDemo: boolean; spanDays: number }) | null>(null)
  const [range, setRange] = useStickyState('wz-schimmel-range', '14d')
  const [materialRaw, setMaterial] = useStickyState('wz-schimmel-material', 'S')
  const mappedMaterial = LEGACY_MATERIAL[materialRaw] ?? materialRaw
  const material: SensitivityClass = mappedMaterial in SENSITIVITY_LABELS ? (mappedMaterial as SensitivityClass) : 'S'
  const [showExplain, setShowExplain] = useState(false)
  const [dataError, setDataError] = useState<DataError>(null)
  const chartC = useChartColors()
  const selectedDevice = useSelectedDevice()
  const deviceReady = useDeviceSelectionReady()

  useEffect(() => {
    if (!deviceReady) return   // eerst de sensorkeuze uit localStorage, dan pas ophalen
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const demo = () => ({ ...demoInputs(), isDemo: true, spanDays: 28 })
      const res = await fetchMouldInputs(selectedDevice)
      if (!res.ok) { setDataError(describeError(res.status, !!res.network)); setInputs(demo()); return }
      setDataError(null)
      setInputs(res.readings < 2 ? demo() : { ...res.inputs, isDemo: false, spanDays: res.spanDays })
    })()
  }, [router, supabase, selectedDevice, deviceReady])

  const result = useMemo(() => (inputs ? assessMould({ ...inputs, material }) : null), [inputs, material])

  const view = useMemo(() => {
    if (!result) return null
    const s = result.series
    const hours = RANGE_OPTIONS.find((o) => o.value === range)?.hours ?? 336
    const cutoff = (s.ts[s.ts.length - 1] ?? 0) - hours * 3_600_000
    const idx = s.ts.map((t, i) => [t, i] as const).filter(([t]) => t >= cutoff).map(([, i]) => i)
    return {
      surf: idx.map((i) => ({ t: s.ts[i], v: s.rhSurface[i] })),
      mi: idx.map((i) => ({ t: s.ts[i], v: s.mi[i] })),
      trh: idx.map((i) => ({ t: s.ts[i], a: s.tIndoor[i], b: s.rhIndoor[i] })),
    }
  }, [result, range])

  const r = result
  const w = r?.winter
  const winterPill = w ? `${LEVEL_STYLE[w.level].label} · kans ${pct(w.pVisible)}` : ''
  const hasProfile = !!inputs?.profile
  const loadBasis = r
    ? r.load.basis === 'dagen' ? `${r.load.n} koele dagen`
      : r.load.basis === 'nachten' ? `${r.load.n} koele nachten`
        : hasProfile ? 'de vragenlijst (nog geen koele dagen gemeten)' : 'een standaardwoning (vragenlijst nog niet ingevuld)'
    : ''

  return (
    <AppShell title="Schimmelrisico">
      <DataBanner error={dataError} onRetry={() => location.reload()} />
      {!r || !inputs ? (
        <div style={{ color: 'var(--muted)', fontSize: 'var(--fs-md)', padding: '24px 0' }}>Laden…</div>
      ) : (
        <>
          {inputs.isDemo && <DemoNotice />}
          {!inputs.isDemo && inputs.spanDays < 3 && (
            <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '10px 14px', marginBottom: 14, fontSize: 'var(--fs-md)', color: 'var(--muted)' }}>
              De sensor meet pas {inputs.spanDays < 1 ? `${Math.max(1, Math.round(inputs.spanDays * 24))} uur` : `${nl(inputs.spanDays, 0)} dag${inputs.spanDays >= 1.5 ? 'en' : ''}`}.{hasProfile ? ' De verwachting leunt nu vooral op het bouwjaar en de vragenlijst.' : ' De vragenlijst is ook nog niet ingevuld (via de QR-code op de sensor), dus de verwachting leunt op aannames.'} Hij wordt de komende weken vanzelf preciezer.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 14, marginBottom: 14 }}>
            <RiskCard icon={<Sun size={16} />} title="Nu" hint="Het risico van de afgelopen weken op de koudste plek in de kamer: hoe vaak het daar boven 80% vochtigheid kwam, en of het groeimodel al groei ziet. Dit geldt ook in de zomer.">
              <Pill level={r.now.level} />
              <Fact>
                Koudste plek nu <strong style={{ color: 'var(--text)' }}>{r.now.rhSurface != null ? `${nl(r.now.rhSurface)}%` : '–'}</strong> vochtig
                {r.now.pctAbove80 != null && <>; afgelopen 14 dagen <strong style={{ color: 'var(--text)' }}>{nl(r.now.pctAbove80)}%</strong> van de tijd boven 80%</>}.
              </Fact>
              <Fact>Schimmelindex {nl(r.now.mi, 2)} van 6: {mouldIndexText(r.now.mi)}.{r.now.condensHours > 0 && <> {nl(r.now.condensHours)} uur condens in de hoek.</>}</Fact>
              {!r.now.outdoorMeasured && <Fact>Geen weerdata: gerekend met de gemiddelde buitentemperatuur van deze maand.</Fact>}
            </RiskCard>

            <RiskCard icon={<Snowflake size={16} />} title="Deze winter" hint={`De kans dat er deze winter zichtbare schimmel komt op de koudste plek. We rekenen het seizoen 200 keer door met wat we van dit huis weten, telkens met iets andere vochtbelasting, binnentemperatuur en isolatie binnen de onzekerheid. Het deel waarin schimmel zichtbaar wordt (index 3, ook de grens in de norm ASHRAE 160) is de kans. Onder 15% laag, vanaf 50% hoog.`}>
              {w && <Pill level={w.level} text={winterPill} />}
              {w && (
                <>
                  <Fact>
                    Kans op zichtbare schimmel: <strong style={{ color: 'var(--text)' }}>{pct(w.pVisible)}</strong>; op groei die je nog niet ziet (geur, sporen): {pct(w.pGrowth)}.
                  </Fact>
                  <Fact>
                    In een open hoek {pct(w.pOpen)}, achter een kast of bed tegen de buitenmuur {pct(w.pFurniture)}
                    {r.furniture === 'onbekend' ? ' (we weten niet of daar iets staat, dus beide tellen mee).' : r.furniture === 'ja' ? ' (daar staat er een, dus dat telt).' : '.'}
                  </Fact>
                  <Fact>
                    Op een gemiddelde januaridag is de hoek ongeveer <strong style={{ color: 'var(--text)' }}>{nl(w.rhSurface)}%</strong> vochtig
                    {w.rhSurfaceRange[0] !== w.rhSurfaceRange[1] && <> ({nl(w.rhSurfaceRange[0])}–{nl(w.rhSurfaceRange[1])}%)</>}, bij {nl(w.ti, 0)} °C binnen
                    {w.tiMeasured ? ' (gemeten)' : ' (aanname)'} en {nl(w.rhIndoor)}% in de kamer.
                  </Fact>
                  <Fact>
                    {r.yearGrowth.start && r.yearGrowth.start !== 'nu'
                      ? `Middelste schatting: groei begint in ${r.yearGrowth.start}${r.yearGrowth.visible ? ` en is in ${r.yearGrowth.visible} zichtbaar` : ' en wordt nog niet zichtbaar'}.`
                      : growthSentence(r.yearGrowth)}
                  </Fact>
                </>
              )}
            </RiskCard>

            <RiskCard icon={<Droplets size={16} />} title="Vochtbelasting" hint="Hoeveel vochtiger het binnen is dan buiten, omgerekend naar winterniveau (g/m³). Een normaal huishouden zit volgens ISO 13788 rond 4, een druk bewoond huis rond 6. Dit drijft het winterrisico aan.">
              <Pill level={LOAD_STYLE[r.load.level]} text={r.load.level[0].toUpperCase() + r.load.level.slice(1)} />
              <Fact>
                Ongeveer <strong style={{ color: 'var(--text)' }}>{nl(r.load.dv0, 1)} g/m³</strong> in de winter ({nl(r.load.range[0], 1)}–{nl(r.load.range[1], 1)}),
                op basis van {loadBasis}. Betrouwbaarheid: <strong style={{ color: 'var(--text)' }}>{r.load.reliability}</strong>.
              </Fact>
              {r.load.recentDv != null && (
                <Fact>{r.load.recentDv >= 0.15
                  ? `Afgelopen week was het binnen gemiddeld ${nl(r.load.recentDv, 1)} g/m³ vochtiger dan buiten.`
                  : 'Afgelopen week was het binnen nauwelijks vochtiger dan buiten (ramen open of warm weer).'}</Fact>
              )}
            </RiskCard>
          </div>

          <HouseProfileSection r={r} isDemo={inputs.isDemo} profile={inputs.profile} />

          {/* Instellingen */}
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end', flexWrap: 'wrap', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px', marginBottom: 14, boxShadow: 'var(--shadow-xs)' }}>
            <div style={{ flex: '1 1 330px', minWidth: 0 }}>
              <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Tijdsperiode</div>
              <SegmentedControl ariaLabel="Tijdsperiode" options={RANGE_OPTIONS.map((o) => ({ label: o.label, value: o.value }))} value={range} onChange={setRange} />
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <label htmlFor="wz-materiaal" style={{ display: 'block', fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Oppervlak in de hoek</label>
              <select id="wz-materiaal" value={material} onChange={(e) => setMaterial(e.target.value)} style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 'var(--fs-md)', width: '100%', maxWidth: 300 }}>
                {Object.entries(SENSITIVITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 0, fontSize: 'var(--fs-sm)', color: 'var(--muted)', lineHeight: 1.5 }}>
              Koudste plek: temperatuurfactor <strong style={{ color: 'var(--text)' }}>f = {nl(r.f, 2)}</strong>, {fText(r, inputs.profile)}.
            </div>
          </div>

          {view && (
            <div style={inputs.isDemo ? { opacity: 0.85 } : undefined}>
              <ChartCard label={`Vochtigheid op de koudste plek${inputs.isDemo ? ' — voorbeeld' : ''}`}>
                <TimeSeriesChart id="surf" data={view.surf} color={chartC.mould} unit="%" decimals={0} height={220}
                  refLines={[{ value: 80, label: '80% — schimmel kan groeien', color: chartC.crit }, { value: 70, label: '70%', color: chartC.warn }]} />
                <ChartTable caption="Vochtigheid op de koudste plek per meetpunt" columns={[{ key: 't', label: 'Tijd' }, { key: 'v', label: 'RV oppervlak (%)' }]} rows={view.surf.map((p) => ({ t: fmtT(p.t), v: p.v.toFixed(0) }))} />
              </ChartCard>
              <ChartCard label={`Schimmelindex (VTT, 0–6)${inputs.isDemo ? ' — voorbeeld' : ''}`}>
                <TimeSeriesChart id="mi" data={view.mi} color={chartC.crit} unit="" decimals={2} height={200}
                  refLines={[{ value: 1, label: '1 — groei begint', color: chartC.warn }, { value: 3, label: '3 — zichtbaar', color: chartC.crit }]} />
                <ChartTable caption="Schimmelindex per meetpunt" columns={[{ key: 't', label: 'Tijd' }, { key: 'v', label: 'Index' }]} rows={view.mi.map((p) => ({ t: fmtT(p.t), v: p.v.toFixed(2) }))} />
              </ChartCard>
              <ChartCard label={`Binnenklimaat (gemeten)${inputs.isDemo ? ' — voorbeeld' : ''}`}>
                <DualAxisChart data={view.trh} aLabel="Temperatuur (binnen)" bLabel="Luchtvochtigheid (binnen)" aColor={chartC.temp} bColor={chartC.rh} aUnit="°C" bUnit="%" height={220}
                  bRefLine={{ value: 70, label: 'RV 70%', color: chartC.warn }} />
                <ChartTable caption="Binnenklimaat per meetpunt" columns={[{ key: 't', label: 'Tijd' }, { key: 'a', label: 'Temp (°C)' }, { key: 'b', label: 'RV (%)' }]} rows={view.trh.map((p) => ({ t: fmtT(p.t), a: p.a.toFixed(1), b: p.b.toFixed(1) }))} />
              </ChartCard>
            </div>
          )}
        </>
      )}

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '16px 18px', marginTop: 14, boxShadow: 'var(--shadow-xs)' }}>
        <button onClick={() => setShowExplain((s) => !s)} aria-expanded={showExplain}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--muted)', padding: 0, fontFamily: 'inherit' }}>
          {showExplain ? <ChevronUp size={15} /> : <ChevronDown size={15} />} Hoe rekenen we dit uit?
        </button>
        {showExplain && <Explanation />}
      </div>

      <ChatWidget />
    </AppShell>
  )
}
