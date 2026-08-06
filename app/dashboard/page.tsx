'use client'
import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { withBase } from '@/lib/basePath'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import MetricCard from '@/components/MetricCard'
import SensorChart from '@/components/SensorChart'
import ChartCard from '@/components/ChartCard'
import ChatWidget from '@/components/ChatWidget'
import MLPredictionCard from '@/components/MLPredictionCard'
import NightOutlookCard from '@/components/NightOutlookCard'
import ContinuityChip from '@/components/ContinuityChip'
import DataBanner from '@/components/DataBanner'
import FirstRunNotice from '@/components/FirstRunNotice'
import SegmentedControl from '@/components/ui/SegmentedControl'
import SectionHeading from '@/components/ui/SectionHeading'
import Stat from '@/components/ui/Stat'
import InfoHint from '@/components/ui/InfoHint'
import ChartTable from '@/components/ui/ChartTable'
import { MetricCardSkeleton } from '@/components/ui/Skeleton'
import { ProcessedRow, SensorRow } from '@/lib/types'
import { dewpoint, mouldRisk, co2Status, rhStatus, tempStatus, mouldStatus, movingAverage, healthScore, healthLabel, absHumidityGkg } from '@/lib/calculations'
import { windowMinutes, maxWindowPoints, formatWindow } from '@/lib/smoothing'
import { toSeries, buildDiagnosis } from '@/lib/reportAnalytics'
import { useStickyState } from '@/lib/useStickyState'
import { freshness } from '@/lib/freshness'
import { useChartColors, alpha } from '@/lib/useChartColors'
import { useSelectedDevice } from '@/lib/useSelectedDevice'
import { useSeries } from '@/lib/useSeries'
import { Wind, Thermometer, Droplets, Bug, Droplet, Activity, MapPin } from 'lucide-react'

const PERIOD_OPTIONS = [
  { label: '30 min', value: 30 },
  { label: '1 uur', value: 60 },
  { label: '6 uur', value: 360 },
  { label: '24 uur', value: 1440 },
  { label: '7 dagen', value: 10080 },
  { label: '30 dagen', value: 43200 },
  { label: '1 jaar', value: 525600 },
]

const TABS = [
  { key: 'metingen', label: 'Metingen' },
  { key: 'schimmel', label: 'Schimmel & dauwpunt' },
]

function processRows(raw: SensorRow[]): ProcessedRow[] {
  return raw
    .filter((r) => r.co2 != null && r.temperature != null && r.humidity != null)
    .map((r) => {
      const ts = new Date(r.created_at)
      const t = +r.temperature!,
        rh = +r.humidity!
      return { ts, co2: +r.co2!, temp: t, rh, mr: mouldRisk(t, rh), dp: dewpoint(t, rh) }
    })
}

/**
 * Smooth the series over `points` samples.
 *
 * The window is in SAMPLES, not minutes, because that is what movingAverage takes.
 * /api/data has already bucketed the series by period (1 min at 24 h, up to 720 min
 * beyond a year), so one sample is `bucketMinutes` of wall-clock time — which is why
 * the UI must convert rather than pass a minute count straight through. It used to,
 * and "60 min" on the 1-year view silently meant 15 days.
 */
function applyMA(rows: ProcessedRow[], points: number): ProcessedRow[] {
  if (points < 2) return rows
  const n = Math.round(points)
  const co2 = movingAverage(rows.map((x) => x.co2), n)
  const temp = movingAverage(rows.map((x) => x.temp), n)
  const rh = movingAverage(rows.map((x) => x.rh), n)
  const mr = movingAverage(rows.map((x) => x.mr), n)
  return rows.map((r, i) => ({ ...r, co2: co2[i], temp: temp[i], rh: rh[i], mr: mr[i] }))
}


const fmtTs = (d: Date) => d.toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

const AQI_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: 'Goed', color: 'var(--ok)' },
  2: { label: 'Redelijk', color: 'var(--ok)' },
  3: { label: 'Matig', color: 'var(--warn)' },
  4: { label: 'Slecht', color: 'var(--warn)' },
  5: { label: 'Zeer slecht', color: 'var(--crit)' },
}

export default function DashboardPage() {
  const router = useRouter()
  const supabase = createClient()
  const selectedDevice = useSelectedDevice()
  const [period, setPeriod] = useStickyState('wz-dash-period', 1440)
  const [tab, setTab] = useState('metingen')
  // Smoothing window in SAMPLES, not minutes — see applyMA. The wall-clock
  // equivalent is derived from bucketMinutes and shown next to the slider.
  const [maPoints, setMaPoints] = useState(0)
  const [latest, setLatest] = useState<ProcessedRow | null>(null)
  const [latestTs, setLatestTs] = useState<Date | null>(null)
  const [weather, setWeather] = useState<any>(null)
  const [poll, setPoll] = useState<any>(null)
  // Tick so the "x min geleden" line and staleness re-evaluate without a refetch.
  const [nowTick, setNowTick] = useState(() => Date.now())
  const chartC = useChartColors()

  // The chart series come through the shared, cached, visibility-gated data path
  // (5.1/5.2) — one request per window across the whole app, polling paused on a
  // hidden tab. A5 fetch failures surface via `dataError`.
  const { rows: rawRows, bucketMinutes, loading, error: dataError, refetch } = useSeries(period, { poll: true })

  // Auth guard — the fetch used to double as this; useSeries doesn't, so keep it explicit.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push('/login')
    })
  }, [supabase, router])

  // The newest actual measurement, fetched independently of the chart period.
  //
  // The KPI cards cannot be derived from `rows`: /api/data returns a series bucketed
  // by period, so the final element is an average over one bucket — a whole hour on
  // the 30-day view. That made the headline "current CO₂" read 1016 ppm at 24 hours
  // and 736 ppm at 30 days for the same room at the same moment. A reported current
  // value must not depend on which chart range happens to be selected.
  //
  // One row, RLS-scoped to this user. Like the rest of the dashboard it has no
  // device filter yet, so on a multi-device account it shows the newest reading from
  // any of them — that waits on the device switcher (ROADMAP M4).
  useEffect(() => {
    let cancelled = false
    const loadLatest = async () => {
      // Scope the headline reading to the chosen device (6.1). This is the direct,
      // device-filterable query; the chart series still come from /api/data, whose
      // RPC has no device parameter yet.
      let q = supabase
        .from('air_quality')
        .select('created_at,co2,temperature,humidity')
        .order('created_at', { ascending: false })
        .limit(1)
      if (selectedDevice) q = q.eq('device_id', selectedDevice)
      const { data } = await q
      if (cancelled) return
      const rows = (data ?? []) as SensorRow[]
      const p = processRows(rows)
      setLatest(p[0] ?? null)
      // Keep the raw timestamp — the KPI freshness contract needs the reading's age,
      // which processRows discards, and a reading can arrive that fails the co2/temp/
      // humidity filter yet still tells us the sensor is alive.
      setLatestTs(rows[0]?.created_at ? new Date(rows[0].created_at) : null)
    }
    loadLatest()
    const id = setInterval(loadLatest, 60000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [supabase, selectedDevice])

  useEffect(() => {
    fetch(withBase('/api/weather'))
      .then((r) => r.json())
      .then((d) => {
        setWeather(d.weather)
        setPoll(d.pollution)
      })
      .catch(() => {})
  }, [])

  // Re-evaluate freshness every 30s so a card can go stale on its own, even if no
  // new data arrives — the outage case is precisely when fetches stop returning.
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  const rows = useMemo(() => processRows(rawRows), [rawRows])
  const diag = useMemo(() => (rawRows.length >= 12 ? buildDiagnosis(toSeries(rawRows)) : null), [rawRows])
  // `displayed` feeds the CHARTS only. Smoothing is a reading aid for a noisy line;
  // it must never reach the KPI cards or the health score, or dragging the slider
  // would change what the app reports as the current state of the room. It used to:
  // the cards read the smoothed array, and because movingAverage is centred, the
  // final point was an average of the trailing half-window rather than a measurement.
  const displayed = useMemo(() => applyMA(rows, maPoints), [rows, maPoints])
  // Falls back to the last bucket only if the single-row query hasn't landed yet.
  const last = latest ?? rows[rows.length - 1]

  const maxPoints = maxWindowPoints(rows.length)

  // Freshness of the reported value (A1). Prefer the raw sensor timestamp; fall back
  // to the last processed row's timestamp. Once offline, no card may show a status.
  const fresh = freshness(latestTs ?? last?.ts ?? null, nowTick)
  const stale = fresh.offline
  // Day-one: no reading and no series at all. Show the positive first-run card
  // instead of the KPI/chart empty states (H3).
  const firstRun = !loading && !last && rawRows.length === 0
  const withStatus = (s: { label: string; color: string } | null) => (stale ? null : s)

  const co2s = last ? co2Status(last.co2) : null
  const rhs = last ? rhStatus(last.rh) : null
  const temps = last ? tempStatus(last.temp) : null
  const moulds = last ? mouldStatus(last.mr) : null
  const hs = last ? healthScore(last.co2, last.rh, last.mr) : null
  const hl = hs != null ? healthLabel(hs) : null

  const card = (title: string, value: string, unit: string, status: any, accent: string, icon: React.ReactNode, progress?: number) => (
    <MetricCard title={title} value={loading ? '—' : value} unit={unit} label={withStatus(status)?.label} labelColor={withStatus(status)?.color} accent={accent} icon={icon} progress={progress} stale={stale && !loading} />
  )

  const periodSelect = (
    <select
      value={period}
      onChange={(e) => setPeriod(+e.target.value)}
      style={{ padding: '7px 10px', fontSize: 13, fontWeight: 500, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}
    >
      {PERIOD_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )

  return (
    <AppShell title="Dashboard" actions={periodSelect}>
      <DataBanner error={dataError} onRetry={refetch} />

      {firstRun && <FirstRunNotice />}

      {!firstRun && (
      <>
      {/* KPI cards — aria-live so a screen reader hears the values update (D4) */}
      <section aria-label="Huidige metingen" aria-live="polite">
        {loading && !last ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, marginBottom: 14 }}>
            {Array.from({ length: 6 }).map((_, i) => <MetricCardSkeleton key={i} />)}
          </div>
        ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, marginBottom: 8 }}>
          {card('CO₂', last?.co2.toFixed(0) ?? '—', 'ppm', co2s, 'var(--c-co2)', <Wind size={14} />, last ? Math.min(100, last.co2 / 20) : 0)}
          {card('Temperatuur', last?.temp.toFixed(1) ?? '—', '°C', temps, 'var(--c-temp)', <Thermometer size={14} />)}
          {card('Vochtigheid', last?.rh.toFixed(1) ?? '—', '% RV', rhs, 'var(--c-rh)', <Droplets size={14} />, last?.rh)}
          {card('Schimmel', last?.mr.toFixed(0) ?? '—', '/ 100', moulds, 'var(--c-mould)', <Bug size={14} />, last?.mr)}
          {card('Dauwpunt', last?.dp.toFixed(1) ?? '—', '°C', null, 'var(--c-dew)', <Droplet size={14} />)}
          {hs != null && (
            <MetricCard
              title="Gezondheid"
              value={`${hs}`}
              unit="/ 100"
              label={stale ? undefined : hl?.label}
              labelColor={hl?.color}
              accent={hl?.color}
              progress={hs}
              icon={<Activity size={14} />}
              stale={stale && !loading}
            />
          )}
        </div>
        )}

        {/* Freshness contract (A1): the age of the reported values, always visible. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, fontSize: 'var(--fs-xs)', flexWrap: 'wrap' }}>
          {stale ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--warn)', fontWeight: 600 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--warn-dot)' }} />
              {fresh.offlineMessage}
            </span>
          ) : (
            <span style={{ color: 'var(--subtle)' }}>
              gemeten {fresh.clock} · {fresh.ago}
            </span>
          )}
          <InfoHint label="gezondheidsscore" text="Gezondheid: 0–100, hoger = beter. Combineert CO₂ (40%), luchtvochtigheid (30%) en schimmelrisico (30%) tot één cijfer voor deze meting." />
        </div>
      </section>

      {/* Weather */}
      {weather && (
        <div className="wz-weather" style={{ borderRadius: 14, padding: '12px 16px', marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src={`https://openweathermap.org/img/wn/${weather.iconCode}@2x.png`} style={{ width: 40, height: 40 }} alt="" />
            <div>
              <div className="wx-ttl" style={{ fontWeight: 700, fontSize: 'var(--fs-md)', display: 'flex', alignItems: 'center', gap: 4 }}><MapPin size={13} /> {weather.cityName || 'Buiten'}</div>
              <div className="wx-desc" style={{ fontSize: 11 }}>{weather.description}</div>
            </div>
          </div>
          {[
            ['Temp', `${weather.temp?.toFixed(1)}°C`, `voelt ${weather.feelsLike?.toFixed(1)}°C`],
            ['Vochtigheid', `${weather.humidity?.toFixed(0)}%`, 'relatief'],
            ['Dauwpunt', `${weather.outdoorDewpoint?.toFixed(1)}°C`, 'buiten'],
            ['Wind', `${weather.windSpeed?.toFixed(1)} m/s`, ''],
            ['Neerslag', `${weather.precipitation1h?.toFixed(1)} mm/h`, ''],
          ].map(([t, v, u]) => (
            <div key={t} style={{ textAlign: 'center' }}>
              <div className="wx-lbl" style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t}</div>
              <div className="wx-val" style={{ fontSize: 15, fontWeight: 700 }}>{v}</div>
              {u && <div className="wx-sub" style={{ fontSize: 10 }}>{u}</div>}
            </div>
          ))}
          {poll && poll.aqi && (
            <div style={{ padding: '4px 12px', borderRadius: 'var(--r-pill)', background: `color-mix(in srgb, ${AQI_LABELS[poll.aqi]?.color} 14%, transparent)`, color: AQI_LABELS[poll.aqi]?.color, fontWeight: 700, fontSize: 'var(--fs-sm)' }}>
              AQI {poll.aqi} — {AQI_LABELS[poll.aqi]?.label ?? '—'}
            </div>
          )}
        </div>
      )}

      {/* Ventilation-moment advisor: is now a good time to air out? */}
      {last && weather && weather.temp != null && weather.humidity != null && (() => {
        const indoorAbs = absHumidityGkg(last.temp, last.rh)
        const outdoorAbs = absHumidityGkg(+weather.temp, +weather.humidity)
        const diff = indoorAbs - outdoorAbs // >0 means outside is drier
        const co2High = last.co2 > 1000
        let color = 'var(--accent)',
          title = 'Neutraal ventilatiemoment',
          body = 'Binnen- en buitenvocht liggen dicht bij elkaar; luchten verandert de luchtvochtigheid nu weinig.'
        if (co2High && diff > 0) {
          color = 'var(--ok)'
          title = 'Ventileer nu — ideaal moment'
          body = `CO₂ is verhoogd (${last.co2.toFixed(0)} ppm) én de buitenlucht is droger (${outdoorAbs.toFixed(1)} vs ${indoorAbs.toFixed(1)} g/kg). Luchten ververst de lucht én verlaagt de vochtigheid.`
        } else if (co2High) {
          color = 'var(--warn)'
          title = 'Lucht kort voor de CO₂'
          body = `CO₂ is verhoogd (${last.co2.toFixed(0)} ppm). Buiten is iets vochtiger, dus lucht gericht en kort — genoeg om de CO₂ te verversen.`
        } else if (diff > 0.7) {
          color = 'var(--ok)'
          title = 'Goed moment om te luchten'
          body = `Buitenlucht is droger dan binnen (${outdoorAbs.toFixed(1)} vs ${indoorAbs.toFixed(1)} g/kg) — een raam open verlaagt nu de luchtvochtigheid.`
        } else if (diff < -0.7) {
          color = 'var(--warn)'
          title = 'Liever nu niet luchten voor vocht'
          body = `Buiten is vochtiger dan binnen (${outdoorAbs.toFixed(1)} vs ${indoorAbs.toFixed(1)} g/kg). Voor CO₂ luchten mag, maar het voert nu geen vocht af.`
        }
        return (
          <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start', background: 'var(--surface)', border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`, borderLeft: `3px solid ${color}`, borderRadius: 'var(--r-md)', padding: '12px 15px', marginBottom: 14, boxShadow: 'var(--shadow-xs)' }}>
            <Wind size={17} color={color} style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text)' }}>{title}</div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', marginTop: 2, lineHeight: 1.45 }}>{body}</div>
            </div>
          </div>
        )
      })()}

      {/* Night ventilation outlook + ML prediction */}
      <NightOutlookCard />
      <MLPredictionCard />

      {/* Chart tabs — now a real ARIA tablist (D3) */}
      <div style={{ marginBottom: 14 }}>
        <SegmentedControl
          ariaLabel="Grafiekweergave"
          fill
          options={TABS.map((t) => ({ label: t.label, value: t.key }))}
          value={tab}
          onChange={setTab}
        />
      </div>

      {/* Afvlakking (was "Smoothing", H1). The slider value is a number of data
          points; the label converts it to real time using the server's bucket size,
          so it stays honest across every period. Capped at a quarter of the visible
          series — smoothing over more than that flattens the trend you came to look at. */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '10px 16px', marginBottom: 14, boxShadow: 'var(--shadow-xs)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label htmlFor="wz-afvlakking" style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
          Afvlakking
        </label>
        <input
          id="wz-afvlakking"
          type="range"
          min={0}
          max={maxPoints}
          step={1}
          value={Math.min(maPoints, maxPoints)}
          disabled={maxPoints < 2}
          onChange={(e) => setMaPoints(+e.target.value)}
          style={{ flex: 1, minWidth: 120, accentColor: 'var(--brand)', opacity: maxPoints < 2 ? 0.4 : 1 }}
        />
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', minWidth: 118, textAlign: 'right', whiteSpace: 'nowrap' }}>
          {maxPoints < 2
            ? 'Te weinig data'
            : maPoints < 2
              ? 'Uit'
              : `${formatWindow(windowMinutes(maPoints, bucketMinutes))} · ${maPoints} punten`}
        </span>
        <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--subtle)', flexBasis: '100%', textAlign: 'right' }}>
          Alleen de grafieken — de waarden bovenaan blijven ongewijzigde metingen.
          {rows.length > 0 && ` 1 punt = ${formatWindow(bucketMinutes)}.`}
        </span>
      </div>

      {tab === 'metingen' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <ChartCard label="CO₂ (ppm)">
            <SensorChart data={displayed} dataKey="co2" syncId="wz-dash" color={chartC.co2} fillColor={alpha(chartC.co2, 0.1)} unit="ppm" refLines={[{ value: 1000, label: '1000 ppm', color: chartC.warn }, { value: 1500, label: '1500 ppm', color: chartC.crit }]} />
            <ChartTable caption="CO₂ (ppm) per meetpunt" columns={[{ key: 't', label: 'Tijd' }, { key: 'v', label: 'CO₂ (ppm)' }]} rows={displayed.map((r) => ({ t: fmtTs(r.ts), v: r.co2.toFixed(0) }))} />
          </ChartCard>
          <ChartCard label="Temperatuur (°C)">
            <SensorChart data={displayed} dataKey="temp" syncId="wz-dash" color={chartC.temp} fillColor={alpha(chartC.temp, 0.09)} unit="°C" />
            <ChartTable caption="Temperatuur (°C) per meetpunt" columns={[{ key: 't', label: 'Tijd' }, { key: 'v', label: 'Temp (°C)' }]} rows={displayed.map((r) => ({ t: fmtTs(r.ts), v: r.temp.toFixed(1) }))} />
          </ChartCard>
          <ChartCard label="Relatieve vochtigheid (%)">
            <SensorChart data={displayed} dataKey="rh" syncId="wz-dash" color={chartC.rh} fillColor={alpha(chartC.rh, 0.1)} unit="%" refLines={[{ value: 60, label: '60%', color: chartC.warn }, { value: 70, label: '70%', color: chartC.crit }]} />
            <ChartTable caption="Relatieve vochtigheid (%) per meetpunt" columns={[{ key: 't', label: 'Tijd' }, { key: 'v', label: 'RV (%)' }]} rows={displayed.map((r) => ({ t: fmtTs(r.ts), v: r.rh.toFixed(1) }))} />
          </ChartCard>
        </div>
      )}
      {tab === 'schimmel' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <ChartCard label="Schimmelrisico (0–100)">
            <SensorChart data={displayed} dataKey="mr" color={chartC.mould} fillColor={alpha(chartC.mould, 0.12)} unit="" height={220} refLines={[{ value: 60, label: 'Verhoogd', color: chartC.warn }]} />
            <ChartTable caption="Schimmelrisico per meetpunt" columns={[{ key: 't', label: 'Tijd' }, { key: 'v', label: 'Risico / 100' }]} rows={displayed.map((r) => ({ t: fmtTs(r.ts), v: r.mr.toFixed(0) }))} />
          </ChartCard>
          <ChartCard label="Dauwpunt (°C)">
            <SensorChart data={displayed} dataKey="dp" color={chartC.dew} fillColor={alpha(chartC.dew, 0.1)} unit="°C" />
            <ChartTable caption="Dauwpunt (°C) per meetpunt" columns={[{ key: 't', label: 'Tijd' }, { key: 'v', label: 'Dauwpunt (°C)' }]} rows={displayed.map((r) => ({ t: fmtTs(r.ts), v: r.dp.toFixed(1) }))} />
          </ChartCard>
        </div>
      )}

      {/* Diagnose & advies — real diagnostics (replaces the empty Ventilatie tab,
          insight banner and ad-hoc Diagnose tab; reuses the report engine). */}
      <DiagnoseCard diag={diag} loading={loading} />

      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--subtle)', marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <ContinuityChip />
        <span>{rows.length} meetpunten · {stale ? fresh.offlineMessage.toLowerCase() : `laatste meting ${fresh.ago}`}</span>
      </div>
      </>
      )}

      <ChatWidget />
    </AppShell>
  )
}

function DiagnoseCard({ diag, loading }: { diag: ReturnType<typeof buildDiagnosis> | null; loading: boolean }) {
  const wrap: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '16px 18px', boxShadow: 'var(--shadow-xs)', marginTop: 14 }
  const head = <SectionHeading>Diagnose &amp; advies</SectionHeading>
  if (loading && !diag)
    return (
      <div style={wrap}>
        {head}
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>Analyseren…</div>
      </div>
    )
  if (!diag)
    return (
      <div style={wrap}>
        {head}
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>Te weinig data voor diagnose. Kies een langere periode.</div>
      </div>
    )

  return (
    <div style={wrap}>
      {head}
      {/* Conclusion banner */}
      <div style={{ display: 'flex', borderRadius: 'var(--r-md)', overflow: 'hidden', background: 'var(--surface-2)', marginBottom: 14 }}>
        <div style={{ width: 4, background: diag.conclusieKleur }} />
        <div style={{ padding: '9px 13px' }}>
          <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: diag.conclusieKleur, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{diag.sevLabel}</div>
          <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text)', marginTop: 2 }}>{diag.conclusieTxt}</div>
        </div>
      </div>

      {/* Derived metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8, marginBottom: 14 }}>
        {diag.ach && <Stat label="Ventilatie (ACH)" value={`${diag.ach.achGem} /h`} color={diag.ach.voldoet ? 'var(--ok)' : 'var(--crit)'} />}
        {diag.nacht && <Stat label="Nacht / dag CO₂" value={`${diag.nacht.gemNacht} / ${diag.nacht.gemDag}`} color={diag.nacht.probleem ? 'var(--crit)' : 'var(--ok)'} />}
        <Stat label="Schimmel > 60" value={`${diag.pctMr60.toFixed(0)}% v/d tijd`} color={diag.pctMr60 > 20 ? 'var(--crit)' : diag.pctMr60 > 5 ? 'var(--warn)' : 'var(--ok)'} />
        {diag.cv && <Stat label="Vocht-profiel" value={diag.cv.interpretatie.split(' — ')[0]} color={diag.cv.kleur} />}
      </div>

      {/* Findings */}
      {diag.findings.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {diag.findings.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '8px 11px', background: `color-mix(in srgb, ${f.color} 6%, transparent)`, border: `1px solid color-mix(in srgb, ${f.color} 24%, transparent)`, borderRadius: 'var(--r-sm)' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: f.color, flexShrink: 0, marginTop: 5 }} />
              <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', lineHeight: 1.4 }}>{f.text}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ok)' }}>Geen afwijkingen gevonden in deze periode.</div>
      )}

      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--subtle)', marginTop: 12 }}>
        Volledige onderbouwing met grafieken staat in het <Link href="/report" style={{ color: 'var(--brand)', fontWeight: 600 }}>Rapport →</Link>
      </div>
    </div>
  )
}
