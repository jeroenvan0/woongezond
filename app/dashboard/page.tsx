'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
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
import { ProcessedRow, SensorRow } from '@/lib/types'
import { dewpoint, mouldRisk, co2Status, rhStatus, tempStatus, mouldStatus, movingAverage, healthScore, healthLabel, absHumidityGkg } from '@/lib/calculations'
import { toSeries, buildDiagnosis } from '@/lib/reportAnalytics'
import { useStickyState } from '@/lib/useStickyState'
import { Wind, Thermometer, Droplets, Bug, Droplet, Activity } from 'lucide-react'

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

function applyMA(rows: ProcessedRow[], windowMin: number): ProcessedRow[] {
  if (windowMin <= 0) return rows
  const n = Math.max(2, Math.round(windowMin))
  const co2 = movingAverage(rows.map((x) => x.co2), n)
  const temp = movingAverage(rows.map((x) => x.temp), n)
  const rh = movingAverage(rows.map((x) => x.rh), n)
  const mr = movingAverage(rows.map((x) => x.mr), n)
  return rows.map((r, i) => ({ ...r, co2: co2[i], temp: temp[i], rh: rh[i], mr: mr[i] }))
}

const AQI_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: 'Goed', color: '#16A34A' },
  2: { label: 'Redelijk', color: '#65A30D' },
  3: { label: 'Matig', color: '#D97706' },
  4: { label: 'Slecht', color: '#EA580C' },
  5: { label: 'Zeer slecht', color: '#DC2626' },
}

export default function DashboardPage() {
  const router = useRouter()
  const supabase = createClient()
  const [rawRows, setRawRows] = useState<SensorRow[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useStickyState('wz-dash-period', 1440)
  const [tab, setTab] = useState('metingen')
  const [maMin, setMaMin] = useState(0)
  const [weather, setWeather] = useState<any>(null)
  const [poll, setPoll] = useState<any>(null)

  const fetchData = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }
    const r = await fetch(withBase(`/api/data?minutes=${period}`))
    if (!r.ok) return
    const d = await r.json()
    setRawRows(d.rows ?? [])
    setLoading(false)
  }, [period, supabase, router])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 60000)
    return () => clearInterval(id)
  }, [fetchData])

  useEffect(() => {
    fetch(withBase('/api/weather'))
      .then((r) => r.json())
      .then((d) => {
        setWeather(d.weather)
        setPoll(d.pollution)
      })
      .catch(() => {})
  }, [])

  const rows = useMemo(() => processRows(rawRows), [rawRows])
  const diag = useMemo(() => (rawRows.length >= 12 ? buildDiagnosis(toSeries(rawRows)) : null), [rawRows])
  const displayed = useMemo(() => applyMA(rows, maMin), [rows, maMin])
  const last = displayed[displayed.length - 1]

  const co2s = last ? co2Status(last.co2) : null
  const rhs = last ? rhStatus(last.rh) : null
  const temps = last ? tempStatus(last.temp) : null
  const moulds = last ? mouldStatus(last.mr) : null
  const hs = last ? healthScore(last.co2, last.rh, last.mr) : null
  const hl = hs != null ? healthLabel(hs) : null

  const card = (title: string, value: string, unit: string, status: any, accent: string, icon: React.ReactNode, progress?: number) => (
    <MetricCard title={title} value={loading ? '—' : value} unit={unit} label={status?.label} labelColor={status?.color} accent={accent} icon={icon} progress={progress} />
  )

  const periodSelect = (
    <select
      value={period}
      onChange={(e) => {
        setPeriod(+e.target.value)
        setLoading(true)
      }}
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
      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, marginBottom: 14 }}>
        {card('CO₂', last?.co2.toFixed(0) ?? '—', 'ppm', co2s, '#3B82F6', <Wind size={14} />, last ? Math.min(100, last.co2 / 20) : 0)}
        {card('Temperatuur', last?.temp.toFixed(1) ?? '—', '°C', temps, '#EF4444', <Thermometer size={14} />)}
        {card('Vochtigheid', last?.rh.toFixed(1) ?? '—', '% RV', rhs, '#10B981', <Droplets size={14} />, last?.rh)}
        {card('Schimmel', last?.mr.toFixed(0) ?? '—', '/ 100', moulds, '#F97316', <Bug size={14} />, last?.mr)}
        {card('Dauwpunt', last?.dp.toFixed(1) ?? '—', '°C', null, '#8B5CF6', <Droplet size={14} />)}
        {hs != null && <MetricCard title="Gezondheid" value={`${hs}`} unit="/ 100" label={hl?.label} labelColor={hl?.color} accent={hl?.color} progress={hs} icon={<Activity size={14} />} />}
      </div>

      {/* Weather */}
      {weather && (
        <div className="wz-weather" style={{ borderRadius: 14, padding: '12px 16px', marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src={`https://openweathermap.org/img/wn/${weather.iconCode}@2x.png`} style={{ width: 40, height: 40 }} alt="" />
            <div>
              <div className="wx-ttl" style={{ fontWeight: 700, fontSize: 13 }}>📍 {weather.cityName || 'Buiten'}</div>
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
            <div style={{ padding: '4px 12px', borderRadius: 99, background: AQI_LABELS[poll.aqi]?.color + '24', color: AQI_LABELS[poll.aqi]?.color, fontWeight: 700, fontSize: 12 }}>
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
        let color = '#3B82F6',
          title = 'Neutraal ventilatiemoment',
          body = 'Binnen- en buitenvocht liggen dicht bij elkaar; luchten verandert de luchtvochtigheid nu weinig.'
        if (co2High && diff > 0) {
          color = '#16A34A'
          title = 'Ventileer nu — ideaal moment'
          body = `CO₂ is verhoogd (${last.co2.toFixed(0)} ppm) én de buitenlucht is droger (${outdoorAbs.toFixed(1)} vs ${indoorAbs.toFixed(1)} g/kg). Luchten ververst de lucht én verlaagt de vochtigheid.`
        } else if (co2High) {
          color = '#D97706'
          title = 'Lucht kort voor de CO₂'
          body = `CO₂ is verhoogd (${last.co2.toFixed(0)} ppm). Buiten is iets vochtiger, dus lucht gericht en kort — genoeg om de CO₂ te verversen.`
        } else if (diff > 0.7) {
          color = '#16A34A'
          title = 'Goed moment om te luchten'
          body = `Buitenlucht is droger dan binnen (${outdoorAbs.toFixed(1)} vs ${indoorAbs.toFixed(1)} g/kg) — een raam open verlaagt nu de luchtvochtigheid.`
        } else if (diff < -0.7) {
          color = '#D97706'
          title = 'Liever nu niet luchten voor vocht'
          body = `Buiten is vochtiger dan binnen (${outdoorAbs.toFixed(1)} vs ${indoorAbs.toFixed(1)} g/kg). Voor CO₂ luchten mag, maar het voert nu geen vocht af.`
        }
        return (
          <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start', background: 'var(--surface)', border: `1px solid ${color}33`, borderLeft: `3px solid ${color}`, borderRadius: 12, padding: '12px 15px', marginBottom: 14, boxShadow: 'var(--shadow-xs)' }}>
            <Wind size={17} color={color} style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, lineHeight: 1.45 }}>{body}</div>
            </div>
          </div>
        )
      })()}

      {/* Night ventilation outlook + ML prediction */}
      <NightOutlookCard />
      <MLPredictionCard />

      {/* Chart tabs */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--surface-tint)', borderRadius: 10, padding: 4, marginBottom: 14 }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t.key ? 600 : 500, background: tab === t.key ? 'var(--surface)' : 'transparent', color: tab === t.key ? 'var(--text)' : 'var(--muted)', boxShadow: tab === t.key ? 'var(--shadow-xs)' : 'none', transition: 'all 0.15s', whiteSpace: 'nowrap' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* MA slider — compact, only useful with charts visible */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '10px 16px', marginBottom: 14, boxShadow: 'var(--shadow-xs)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Smoothing</span>
        <input type="range" min={0} max={180} step={5} value={maMin} onChange={(e) => setMaMin(+e.target.value)} style={{ flex: 1, accentColor: '#3B82F6' }} />
        <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 48, textAlign: 'right' }}>{maMin === 0 ? 'Uit' : `${maMin} min`}</span>
      </div>

      {tab === 'metingen' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <ChartCard label="CO₂ (ppm)">
            <SensorChart data={displayed} dataKey="co2" color="#3B82F6" fillColor="rgba(59,130,246,0.1)" unit="ppm" refLines={[{ value: 1000, label: '1000 ppm', color: '#D97706' }, { value: 1500, label: '1500 ppm', color: '#DC2626' }]} />
          </ChartCard>
          <ChartCard label="Temperatuur (°C)">
            <SensorChart data={displayed} dataKey="temp" color="#EF4444" fillColor="rgba(239,68,68,0.09)" unit="°C" />
          </ChartCard>
          <ChartCard label="Relatieve vochtigheid (%)">
            <SensorChart data={displayed} dataKey="rh" color="#10B981" fillColor="rgba(16,185,129,0.10)" unit="%" refLines={[{ value: 60, label: '60%', color: '#D97706' }, { value: 70, label: '70%', color: '#DC2626' }]} />
          </ChartCard>
        </div>
      )}
      {tab === 'schimmel' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <ChartCard label="Schimmelrisico (0–100)">
            <SensorChart data={displayed} dataKey="mr" color="#F97316" fillColor="rgba(249,115,22,0.12)" unit="" height={220} refLines={[{ value: 60, label: 'Verhoogd', color: '#EA580C' }]} />
          </ChartCard>
          <ChartCard label="Dauwpunt (°C)">
            <SensorChart data={displayed} dataKey="dp" color="#8B5CF6" fillColor="rgba(139,92,246,0.10)" unit="°C" />
          </ChartCard>
        </div>
      )}

      {/* Diagnose & advies — real diagnostics (replaces the empty Ventilatie tab,
          insight banner and ad-hoc Diagnose tab; reuses the report engine). */}
      <DiagnoseCard diag={diag} loading={loading} />

      <div style={{ fontSize: 11, color: 'var(--subtle)', marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <ContinuityChip />
        <span>{rows.length} meetpunten · bijgewerkt elke 60s</span>
      </div>

      <ChatWidget />
    </AppShell>
  )
}

function DiagnoseCard({ diag, loading }: { diag: ReturnType<typeof buildDiagnosis> | null; loading: boolean }) {
  const wrap: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px', boxShadow: 'var(--shadow-xs)', marginTop: 14 }
  const head = (
    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 3, height: 14, background: '#3B82F6', borderRadius: 2 }} /> Diagnose &amp; advies
    </div>
  )
  if (loading && !diag)
    return (
      <div style={wrap}>
        {head}
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Analyseren…</div>
      </div>
    )
  if (!diag)
    return (
      <div style={wrap}>
        {head}
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Te weinig data voor diagnose. Kies een langere periode.</div>
      </div>
    )

  const stat = (label: string, value: string, color?: string) => (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border-soft)', borderRadius: 10, padding: '8px 11px' }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: color ?? 'var(--text)', marginTop: 2 }}>{value}</div>
    </div>
  )

  return (
    <div style={wrap}>
      {head}
      {/* Conclusion banner */}
      <div style={{ display: 'flex', borderRadius: 10, overflow: 'hidden', background: 'var(--surface-2)', marginBottom: 14 }}>
        <div style={{ width: 4, background: diag.conclusieKleur }} />
        <div style={{ padding: '9px 13px' }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: diag.conclusieKleur, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{diag.sevLabel}</div>
          <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 2 }}>{diag.conclusieTxt}</div>
        </div>
      </div>

      {/* Derived metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8, marginBottom: 14 }}>
        {diag.ach && stat('Ventilatie (ACH)', `${diag.ach.achGem} /h`, diag.ach.voldoet ? '#16A34A' : '#DC2626')}
        {diag.nacht && stat('Nacht / dag CO₂', `${diag.nacht.gemNacht} / ${diag.nacht.gemDag}`, diag.nacht.probleem ? '#DC2626' : '#16A34A')}
        {stat('Schimmel > 60', `${diag.pctMr60.toFixed(0)}% v/d tijd`, diag.pctMr60 > 20 ? '#DC2626' : diag.pctMr60 > 5 ? '#D97706' : '#16A34A')}
        {diag.cv && stat('Vocht-profiel', diag.cv.interpretatie.split(' — ')[0], diag.cv.kleur)}
      </div>

      {/* Findings */}
      {diag.findings.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {diag.findings.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '8px 11px', background: `${f.color}0d`, border: `1px solid ${f.color}28`, borderRadius: 9 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: f.color, flexShrink: 0, marginTop: 5 }} />
              <span style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.4 }}>{f.text}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: '#16A34A' }}>Geen afwijkingen gevonden in deze periode. ✓</div>
      )}

      <div style={{ fontSize: 11, color: 'var(--subtle)', marginTop: 12 }}>
        Volledige onderbouwing met grafieken staat in het <a href={withBase('/report')} style={{ color: '#3B82F6', fontWeight: 600 }}>Rapport →</a>
      </div>
    </div>
  )
}
