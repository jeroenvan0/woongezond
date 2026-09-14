'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import Card from '@/components/ui/Card'
import SectionHeading from '@/components/ui/SectionHeading'
import SegmentedControl from '@/components/ui/SegmentedControl'
import DataBanner, { DataError, describeError } from '@/components/DataBanner'
import { ChartSkeleton, MetricCardSkeleton } from '@/components/ui/Skeleton'
import FleetChart, { type FleetBand, type FleetSeries } from '@/components/FleetChart'
import { withBase } from '@/lib/basePath'
import { Building2, ShieldAlert, Activity, Wind, Moon, Droplets, Users, FlaskConical } from 'lucide-react'
import { EVENT_LABEL, type DaySummary, type EventKind, type VentEvent } from '@/lib/ventilationEvents'
import { vAbs } from '@/lib/mouldRisk'

// Cockpit › Analyse: alleen org-ADMINS. Alle sensoren van de vloot in één grafiek, en de
// gelabelde momenten (gelucht / achtergrond / vochtpiek / bezetting) met betrouwbaarheid.
// Onderzoeksweergave, ongevalideerd (docs/huisprofiel-luchtgedrag-plan.md): bewust niet
// voor bewoners. Alle pilotsensoren hangen in een slaapkamer; de labels gaan daarvan uit.

type Metric = 'co2' | 'temperature' | 'humidity' | 'v' | 'dv'
interface Org { id: string; name: string }
interface Point { t: number; co2: number | null; temperature: number | null; humidity: number | null; v: number | null; dv: number | null }
interface Device {
  id: string; device_number: number | null; name: string | null; active: boolean; room: string | null
  profile_known: boolean; readings: number; co2Floor: number | null
  assumptions: { room: string; volumeM3: number; occupantsNight: number | null }
  events: VentEvent[]; days: DaySummary[]; series: Point[]
}
interface Payload {
  orgs: Org[]; org: Org; days: number; bucketMinutes: number; devices: Device[]
  outdoor: Record<string, { t: number; temp: number | null; humidity: number | null }[]>; cityOf: Record<string, string | null>
}

const METRIC: Record<Metric, { label: string; unit: string; decimals: number; ref?: { value: number; label: string } }> = {
  co2: { label: 'CO₂', unit: 'ppm', decimals: 0, ref: { value: 1000, label: '1000 ppm' } },
  temperature: { label: 'Temperatuur', unit: '°C', decimals: 1 },
  humidity: { label: 'RV', unit: '%', decimals: 0, ref: { value: 70, label: '70 %' } },
  v: { label: 'Abs. vocht', unit: 'g/m³', decimals: 1 },
  dv: { label: 'Vochtoverschot', unit: 'g/m³', decimals: 1, ref: { value: 4, label: '4 g/m³ (ISO 13788 klasse 2)' } },
}
// Tien onderscheidbare kleuren die in licht én donker leesbaar blijven.
const PALETTE = ['#4338CA', '#0E7490', '#BE123C', '#15803D', '#B45309', '#7E22CE', '#0F766E', '#C2410C', '#1D4ED8', '#9F1239']
const KIND_COLOR: Record<EventKind, string> = { luchten: '#0B7A5C', achtergrond: '#6B7280', vochtpiek: '#0E7490', bezetting: '#B45309' }
const KIND_ICON: Record<EventKind, typeof Wind> = { luchten: Wind, achtergrond: Moon, vochtpiek: Droplets, bezetting: Users }

const nr = (n: number | null) => (n == null ? '—' : String(n).padStart(2, '0'))
const hhmm = (t: number) => new Date(t).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' })
const dayShort = (t: number) => new Date(t).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Amsterdam' })
const f1 = (x: number) => x.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const f2 = (x: number) => x.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const achText = (a: { ach: number; lo: number; hi: number } | null) => (a ? `${f2(a.ach)}/h [${f2(a.lo)}–${f2(a.hi)}]` : '—')
// Overal hetzelfde label: nummer, de naam tussen haakjes uit "Sensor 3 (Daan)", en de kamer uit
// de vragenlijst als die bekend is. Zo wisselt het niet tussen kamer en apparaatnaam.
const shortName = (name: string | null) => { const m = name?.match(/\(([^)]+)\)/); return m ? m[1] : (name ?? '').replace(/^Sensor \d+\s*/i, '') }
const labelOf = (d: { device_number: number | null; name: string | null; room: string | null }) => [nr(d.device_number), shortName(d.name), d.room ? `· ${d.room}` : ''].filter(Boolean).join(' ')

export default function AnalysePage() {
  const router = useRouter()
  const supabase = createClient()
  const [data, setData] = useState<Payload | null>(null)
  const [days, setDays] = useState<1 | 2 | 7>(2)
  const [metric, setMetric] = useState<Metric>('co2')
  // Meerdere sensoren tegelijk: leeg = alle. Bij precies één gekozen sensor verschijnen de
  // gelabelde momenten als vlakken.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const [orgId, setOrgId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState<DataError>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { if (!data.user) router.push('/login') })
  }, [supabase, router])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const q = `/api/cockpit/analyse?days=${days}${orgId ? `&org=${encodeURIComponent(orgId)}` : ''}`
      const r = await fetch(withBase(q))
      if (r.status === 401) { router.push('/login'); return }
      if (r.status === 403) { setForbidden(true); setError(null); return }
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status })
      const d: Payload = await r.json()
      setData(d)
      setForbidden(false)
      setError(null)
    } catch (e) {
      const status = (e as { status?: number })?.status
      setError(describeError(status, status == null))
    } finally {
      setLoading(false)
    }
  }, [days, orgId, router])
  useEffect(() => { load() }, [load])

  const devices = useMemo(() => [...(data?.devices ?? [])].sort((a, b) => (a.device_number ?? 1e9) - (b.device_number ?? 1e9)), [data])
  const colorOf = useMemo(() => new Map(devices.map((d, i) => [d.id, PALETTE[i % PALETTE.length]])), [devices])

  const series: FleetSeries[] = useMemo(() => devices.filter((d) => d.series.length).map((d) => ({
    id: d.id, label: labelOf(d), color: colorOf.get(d.id)!,
    points: d.series.map((p) => ({ t: p.t, v: p[metric] })),
  })), [devices, colorOf, metric])

  // Buitenlijn bij temperatuur, RV en absolute vochtigheid: alleen als alle sensoren in dezelfde
  // stad hangen (anders misleidend). Bij abs. vocht zie je binnen en buiten los van elkaar; een
  // stilstaande kamer is dan een vlakke lijn en bewoning een eigen beweging.
  const outdoor = useMemo(() => {
    if (!data || (metric !== 'temperature' && metric !== 'humidity' && metric !== 'v')) return undefined
    const cities = [...new Set(devices.map((d) => data.cityOf[d.id]).filter(Boolean))] as string[]
    if (cities.length !== 1) return undefined
    return (data.outdoor[cities[0]] ?? []).map((w) => ({ t: w.t, v: metric === 'temperature' ? w.temp : metric === 'humidity' ? w.humidity : w.temp != null && w.humidity != null ? Math.round(vAbs(w.temp, w.humidity) * 100) / 100 : null }))
  }, [data, devices, metric])

  const focused = selected.size === 1 ? devices.find((d) => selected.has(d.id)) ?? null : null
  const chosen = useMemo(() => (selected.size ? devices.filter((d) => selected.has(d.id)) : devices), [devices, selected])
  const bands: FleetBand[] | undefined = useMemo(() => focused?.events.map((e) => ({ start: e.start, end: e.end, color: KIND_COLOR[e.kind], label: e.kind === 'luchten' ? `gelucht ${Math.round(e.confidence * 100)}%` : EVENT_LABEL[e.kind].split(' ')[0].toLowerCase() })), [focused])

  const events = useMemo(() => {
    const list = chosen.flatMap((d) => d.events.map((e) => ({ ...e, device: d })))
    return list.sort((a, b) => b.start - a.start).slice(0, 300)
  }, [chosen])

  const m = METRIC[metric]
  return (
    <AppShell title="Analyse">
      {error && <DataBanner error={error} onRetry={load} />}
      {forbidden && (
        <Card style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
          <ShieldAlert style={{ color: 'var(--muted)', flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Alleen voor beheerders van de pilot</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>De analyse toont ruwe metingen van alle sensoren en ongevalideerde labels. Daarom alleen voor beheerders.</div>
          </div>
        </Card>
      )}

      {!forbidden && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-3)', flexWrap: 'wrap', marginBottom: 'var(--sp-3)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>
              <Building2 size={15} /> {data?.org.name ?? 'Pilot'} · {devices.length} sensor{devices.length === 1 ? '' : 'en'}
              {data && <span>· per {data.bucketMinutes} min</span>}
            </span>
            <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              {data && data.orgs.length > 1 && (
                <SegmentedControl ariaLabel="Kies organisatie" value={data.org.id} onChange={(v) => setOrgId(String(v))} options={data.orgs.map((o) => ({ label: o.name, value: o.id }))} />
              )}
              <SegmentedControl ariaLabel="Periode" value={days} onChange={(v) => setDays(v as 1 | 2 | 7)} options={[{ label: '24 uur', value: 1 }, { label: '2 dagen', value: 2 }, { label: '7 dagen', value: 7 }]} />
            </div>
          </div>

          <Card accent="var(--warn)" style={{ marginBottom: 'var(--sp-4)', display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
            <FlaskConical size={16} style={{ color: 'var(--warn)', flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>
              <strong style={{ color: 'var(--text)' }}>Onderzoeksweergave, ongevalideerd.</strong> De labels komen uit de CO₂-, temperatuur- en
              vochtreeks van de sensor zelf (docs/huisprofiel-luchtgedrag-plan.md). “Gelucht” betekent: de luchtwisseling van de kamer sprong omhoog —
              raam óf deur, dat onderscheid kan één sensor niet maken. Elk moment krijgt een 95%-interval op de luchtwisseling (ACH) en een zekerheid
              voor het label. Alle pilotsensoren hangen in een slaapkamer; slapers komen uit de vragenlijst. Niet zichtbaar voor bewoners.
            </div>
          </Card>

          <SectionHeading right={
            <SegmentedControl ariaLabel="Meetwaarde" value={metric} onChange={(v) => setMetric(v as Metric)} options={(Object.keys(METRIC) as Metric[]).map((k) => ({ label: METRIC[k].label, value: k }))} />
          }>
            Hele vloot
          </SectionHeading>
          <Card style={{ marginBottom: 'var(--sp-4)' }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 'var(--sp-2)' }}>
              {devices.map((d) => {
                const active = selected.has(d.id)
                const color = colorOf.get(d.id)!
                return (
                  <button key={d.id} type="button" onClick={() => toggle(d.id)} aria-pressed={active}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 9px', borderRadius: 999, border: `1px solid ${active ? color : 'var(--border)'}`, background: active ? color : 'var(--surface)', color: active ? '#fff' : 'var(--text)', fontSize: 'var(--fs-xs)', fontWeight: 600, cursor: 'pointer', opacity: d.series.length ? 1 : 0.5, fontFamily: 'inherit' }}>
                    <span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, background: active ? '#fff' : color }} />
                    {labelOf(d)}{!d.series.length ? ' · geen data' : ''}
                  </button>
                )
              })}
              {selected.size > 0 && <button type="button" onClick={() => setSelected(new Set())} style={{ padding: '4px 9px', borderRadius: 999, border: '1px solid var(--border)', background: 'none', color: 'var(--muted)', fontSize: 'var(--fs-xs)', cursor: 'pointer', fontFamily: 'inherit' }}>Alle sensoren</button>}
            </div>
            {loading && !data ? <ChartSkeleton height={320} /> : (
              <FleetChart series={series} unit={m.unit} decimals={m.decimals} height={320} highlight={selected} bands={bands} refLine={m.ref} outdoor={outdoor} outdoorLabel={metric === 'temperature' ? 'buiten (°C)' : metric === 'humidity' ? 'buiten (RV)' : 'buiten (g/m³)'} />
            )}
            <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--subtle)', marginTop: 6 }}>
              Klik op sensoren om ze uit te lichten (meerdere kan). Bij precies één gekozen sensor verschijnen de gelabelde momenten als vlakken.
              {metric === 'dv' ? ' Vochtoverschot = absolute vochtigheid binnen − buiten. Lopen sensoren gelijk op, dan zie je het buitenweer (omgekeerd), niet de bewoning: kijk dan bij Abs. vocht.' : metric === 'v' ? ' Stippellijn = buitenlucht. Een gesloten kamer volgt die met uren vertraging; bewoning is een eigen beweging erbovenop.' : ''}
            </div>
          </Card>

          <SectionHeading>Per sensor · {data?.days ?? days} dag{(data?.days ?? days) === 1 ? '' : 'en'}</SectionHeading>
          {loading && !data ? (
            <div style={{ display: 'grid', gap: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}>{[0, 1, 2].map((i) => <MetricCardSkeleton key={i} />)}</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}>
              {devices.map((d) => <DeviceSummary key={d.id} d={d} color={colorOf.get(d.id)!} focused={selected.has(d.id)} onFocus={() => toggle(d.id)} />)}
            </div>
          )}

          <SectionHeading right={<span style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>{events.length} momenten{selected.size ? ` · ${chosen.map(labelOf).join(', ')}` : ''}</span>}>
            Gelabelde momenten
          </SectionHeading>
          <Card pad={0} style={{ overflowX: 'auto' }}>
            {events.length === 0 ? (
              <div style={{ padding: 'var(--sp-4)', fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>Geen momenten gevonden in deze periode.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-xs)' }}>
                <thead>
                  <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                    {['Sensor', 'Wanneer', 'Label', 'Duur', 'CO₂', 'ACH (95 %)', 'Zekerheid', 'Bewijs'].map((h) => (
                      <th key={h} style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {events.map((e, i) => {
                    const Icon = KIND_ICON[e.kind]
                    const color = KIND_COLOR[e.kind]
                    return (
                      <tr key={`${e.device.id}-${e.start}-${e.kind}`} style={{ background: i % 2 ? 'var(--surface-tint)' : undefined }}>
                        <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                          <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: colorOf.get(e.device.id), marginRight: 6 }} />
                          <strong>{nr(e.device.device_number)}</strong> {shortName(e.device.name)}{e.device.room ? ` · ${e.device.room}` : ''}
                        </td>
                        <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{dayShort(e.start)} {hhmm(e.start)}–{hhmm(e.end)}</td>
                        <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', color, fontWeight: 700 }}><Icon size={12} style={{ verticalAlign: -1, marginRight: 4 }} />{EVENT_LABEL[e.kind]}</td>
                        <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{e.minutes} min</td>
                        <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                          {e.kind === 'vochtpiek' ? `+${f1(e.vRise ?? 0)} g/m³` : `${e.co2Start} → ${e.co2End}`}
                        </td>
                        <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{e.ach != null && e.achCI ? achText({ ach: e.ach, ...e.achCI }) : '—'}</td>
                        <td style={{ padding: '7px 10px', minWidth: 110 }}><Confidence value={e.confidence} /></td>
                        <td style={{ padding: '7px 10px', color: 'var(--muted)', minWidth: 260 }}>{e.evidence.join(' · ')}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </AppShell>
  )
}

function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = value >= 0.75 ? 'var(--ok)' : value >= 0.5 ? 'var(--warn)' : 'var(--crit)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} title={`Zekerheid van het label: ${pct}%`}>
      <div style={{ flex: 1, height: 6, borderRadius: 999, background: 'var(--surface-tint)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color }} />
      </div>
      <span style={{ fontVariantNumeric: 'tabular-nums', color, fontWeight: 700, minWidth: 34, textAlign: 'right' }}>{pct}%</span>
    </div>
  )
}

function DeviceSummary({ d, color, focused, onFocus }: { d: Device; color: string; focused: boolean; onFocus: () => void }) {
  const total = d.days.reduce((s, x) => s + x.luchtmomenten, 0)
  const minutes = d.days.reduce((s, x) => s + x.minutenGelucht, 0)
  const bg = d.events.filter((e) => e.kind === 'achtergrond' && e.ach != null && e.achCI)
  const bgMed = bg.length ? { ach: [...bg].sort((a, b) => a.ach! - b.ach!)[bg.length >> 1].ach!, lo: Math.min(...bg.map((e) => e.achCI!.lo)), hi: Math.max(...bg.map((e) => e.achCI!.hi)) } : null
  const nights = d.days.filter((x) => x.nachtCo2 != null)
  const lastNight = nights[nights.length - 1] ?? null
  const vocht = d.days.reduce((s, x) => s + x.vochtpieken, 0)
  const Row = ({ Icon, label, value, hint }: { Icon: typeof Wind; label: string; value: string; hint?: string }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 'var(--fs-xs)' }} title={hint}>
      <Icon size={12} style={{ color: 'var(--muted)', flexShrink: 0, alignSelf: 'center' }} />
      <span style={{ color: 'var(--muted)', flex: '0 0 92px' }}>{label}</span>
      <span style={{ color: 'var(--text)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
  return (
    <Card accent={color} style={{ display: 'grid', gap: 6, outline: focused ? `2px solid ${color}` : undefined, cursor: 'pointer' }} className="wz-devsum">
      <div role="button" tabIndex={0} onClick={onFocus} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFocus() } }} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 700, color: 'var(--text)' }}>{labelOf(d)}</span>
        <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--muted)' }}>{d.readings.toLocaleString('nl-NL')} metingen{d.co2Floor != null ? ` · nullijn ${d.co2Floor} ppm` : ''}</span>
      </div>
      <Row Icon={Wind} label="Gelucht" value={total ? `${total}× · ${minutes} min` : 'niet gezien'} hint="Steile CO₂-dalingen (raam of deur)" />
      <Row Icon={Moon} label="Achtergrond" value={achText(bgMed)} hint="Luchtwisseling bij gesloten raam, uit trage dalingen (bron weg). Interval = omhullende van de momenten." />
      <Row Icon={Users} label="Nacht" value={lastNight?.nachtCo2 != null ? `${lastNight.nachtCo2} ppm${lastNight.nachtAch ? ` → ${achText(lastNight.nachtAch)}` : d.assumptions.occupantsNight == null ? ' (slapers onbekend)' : ''}` : '—'} hint={`Mediane CO₂ 01–05 u; wisseling uit het plateau met ${d.assumptions.occupantsNight ?? '?'} slaper(s) in ~${d.assumptions.volumeM3} m³ (±50 %).`} />
      <Row Icon={Droplets} label="Vochtpieken" value={vocht ? `${vocht}×` : 'geen'} hint="Absolute vochtigheid stijgt zonder CO₂-verandering (douche, koken, was)." />
      <Row Icon={Wind} label="Buitenniveau" value={`${(d.days.reduce((s, x) => s + x.minutenOpBuitenniveau, 0) / 60).toFixed(0)} u`} hint="Uren waarin de CO₂ binnen 60 ppm van de nullijn zat: raam open of kamer leeg. Veel uren + geen luchtmomenten = staat permanent open." />
      {!d.profile_known && <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--warn)' }}>Geen vragenlijst: slaapkamer en slapers aangenomen.</div>}
    </Card>
  )
}
