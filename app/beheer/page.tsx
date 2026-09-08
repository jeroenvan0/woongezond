'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import AppShell from '@/components/AppShell'
import Card from '@/components/ui/Card'
import SectionHeading from '@/components/ui/SectionHeading'
import Button from '@/components/ui/Button'
import { MetricCardSkeleton } from '@/components/ui/Skeleton'
import SettingsCard from '@/components/beheer/SettingsCard'
import MailCard from '@/components/beheer/MailCard'
import { withBase } from '@/lib/basePath'
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle, RotateCw, Database, Cpu, Rocket } from 'lucide-react'

// Adminportaal fase 1: systeemstatus. Alles op deze pagina moest tot nu toe via SSH worden
// opgezocht — en juist daardoor bleef de backup drie nachten achter elkaar stilletjes falen.
//
// Drie blokken: de nachtelijke backup naar de VPS, welke sensoren stil liggen, en of prod
// en dev dezelfde build draaien. Fase 2 (mail en instellingen) en fase 3 (gegevens
// bewerken) komen hier als extra secties bij.

interface Run {
  id: number
  started_at: string
  finished_at: string | null
  status: string
  rows_synced: number
  tables_ok: string[] | null
  tables_failed: string[] | null
  duration_s: number | null
  error_detail: string | null
}
interface Sensor {
  id: string
  device_number: number | null
  name: string
  fw_version: string | null
  last_reading: string | null
  minutes_since: number | null
  never: boolean
  stale: boolean
}
interface Deployment {
  key: string
  label: string
  reachable: boolean
  http: number | null
  status: string | null
  commit: string | null
  built_at: string | null
  took_ms: number
}
interface Status {
  generated_at: string
  backup: { runs: Run[]; last: Run | null; hours_since: number | null; verdict: string; stale_after_hours: number }
  sensors: { list: Sensor[]; stale: number; total: number }
  deployments: { list: Deployment[]; in_sync: boolean | null }
  stale_after_minutes: number
}

const TZ = 'Europe/Amsterdam'
const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '—'

/** "3 uur geleden" leest sneller dan een tijdstip als je wilt weten of iets nog leeft. */
function ago(minutes: number | null): string {
  if (minutes == null) return 'nooit'
  if (minutes < 1) return 'zojuist'
  if (minutes < 60) return `${minutes} min geleden`
  const h = Math.round(minutes / 60)
  if (h < 48) return `${h} uur geleden`
  return `${Math.round(h / 24)} dagen geleden`
}

const TONE = {
  ok: { color: 'var(--ok)', fill: 'var(--ok-fill)', Icon: CheckCircle2 },
  warn: { color: 'var(--warn)', fill: 'var(--warn-fill)', Icon: AlertTriangle },
  crit: { color: 'var(--crit)', fill: 'var(--crit-fill)', Icon: XCircle },
  unknown: { color: 'var(--muted)', fill: 'var(--surface-2)', Icon: HelpCircle },
} as const
type Tone = keyof typeof TONE

function Verdict({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const { color, fill, Icon } = TONE[tone]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: fill, color, padding: '4px 10px', borderRadius: 999, fontSize: 'var(--fs-xs)', fontWeight: 700 }}>
      <Icon size={13} /> {children}
    </span>
  )
}

export default function BeheerPage() {
  const router = useRouter()
  const [data, setData] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const r = await fetch(withBase('/api/beheer/status'), { cache: 'no-store' })
      if (r.status === 401) { router.push('/login'); return }
      if (r.status === 403) { setErr('Deze pagina is voor beheerders van een corporatie.'); return }
      if (!r.ok) { setErr('De status kon niet worden opgehaald.'); return }
      setData(await r.json())
    } catch {
      setErr('Geen verbinding met de server.')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { load() }, [load])

  async function runSync() {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const r = await fetch(withBase('/api/beheer/sync'), { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (r.status === 429) setSyncMsg('Te vaak achter elkaar gestart — probeer het over een uur opnieuw.')
      else if (!r.ok) setSyncMsg(`Starten mislukt: ${d.detail ?? d.error ?? 'onbekende fout'}`)
      else if (d.already_running) setSyncMsg('De backup liep al.')
      else setSyncMsg('Backup gestart. Een inhaalslag kan enkele minuten duren; ververs daarna deze pagina.')
    } catch {
      setSyncMsg('Starten mislukt: geen verbinding.')
    } finally {
      setSyncing(false)
    }
  }

  const actions = (
    <Button variant="secondary" size="sm" onClick={load} icon={<RotateCw size={14} />}>Verversen</Button>
  )

  if (loading) {
    return (
      <AppShell title="Beheer" actions={actions}>
        <MetricCardSkeleton />
      </AppShell>
    )
  }

  if (err || !data) {
    return (
      <AppShell title="Beheer" actions={actions}>
        <Card accent="var(--crit)">
          <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text)' }}>{err ?? 'Onbekende fout.'}</div>
        </Card>
      </AppShell>
    )
  }

  const b = data.backup
  const backupTone: Tone = b.verdict === 'ok' ? 'ok' : b.verdict === 'unknown' ? 'unknown' : b.verdict === 'stale' ? 'warn' : 'crit'
  const backupLabel =
    b.verdict === 'ok' ? 'Backup actueel'
    : b.verdict === 'error' ? 'Laatste run mislukt'
    : b.verdict === 'stale' ? `Geen run in ${b.hours_since} uur`
    : 'Nog geen runs bekend'

  return (
    <AppShell title="Beheer" actions={actions}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', maxWidth: 900 }}>

        {/* ── Backup ─────────────────────────────────────────────────────── */}
        <Card accent={TONE[backupTone].color}>
          <SectionHeading right={<Verdict tone={backupTone}>{backupLabel}</Verdict>}>
            <Database size={15} style={{ color: 'var(--brand)' }} /> Backup naar de VPS
          </SectionHeading>

          {b.verdict === 'unknown' ? (
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', lineHeight: 1.55, margin: 0 }}>
              Het syncscript op de VPS schrijft zijn resultaat nog niet naar de cloud, dus hier is nog niets te zien.
              Zodra de aangepaste <code>sync.py</code> geplaatst is, verschijnt elke nachtelijke run hier vanzelf.
            </p>
          ) : (
            <>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', marginBottom: 'var(--sp-3)' }}>
                Laatste run {fmt(b.last?.started_at ?? null)} · {b.last?.rows_synced ?? 0} rijen
                {b.last?.duration_s != null ? ` · ${b.last.duration_s}s` : ''}
                {b.last?.tables_failed?.length ? (
                  <span style={{ color: 'var(--crit)', fontWeight: 600 }}> · mislukt: {b.last.tables_failed.join(', ')}</span>
                ) : null}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {b.runs.map((r) => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-xs)', color: 'var(--muted)', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: r.status === 'success' ? 'var(--ok)' : r.status === 'running' ? 'var(--warn)' : 'var(--crit)' }} />
                    <span style={{ minWidth: 110 }}>{fmt(r.started_at)}</span>
                    <span style={{ minWidth: 70 }}>{r.rows_synced} rijen</span>
                    <span style={{ flex: 1, color: r.tables_failed?.length ? 'var(--crit)' : 'var(--subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.tables_failed?.length ? `mislukt: ${r.tables_failed.join(', ')}` : 'alle tabellen goed'}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginTop: 'var(--sp-4)', flexWrap: 'wrap' }}>
            <Button variant="primary" size="sm" onClick={runSync} disabled={syncing} icon={<RotateCw size={14} />}>
              {syncing ? 'Bezig…' : 'Sync nu draaien'}
            </Button>
            {syncMsg && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>{syncMsg}</span>}
          </div>
        </Card>

        {/* ── Sensoren ───────────────────────────────────────────────────── */}
        <Card accent={data.sensors.stale ? 'var(--warn)' : 'var(--ok)'}>
          <SectionHeading
            right={
              <Verdict tone={data.sensors.stale ? 'warn' : 'ok'}>
                {data.sensors.stale ? `${data.sensors.stale} van ${data.sensors.total} stil` : `${data.sensors.total} sensoren online`}
              </Verdict>
            }
          >
            <Cpu size={15} style={{ color: 'var(--brand)' }} /> Sensoren
          </SectionHeading>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {data.sensors.list.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-sm)', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: s.stale ? (s.never ? 'var(--subtle)' : 'var(--crit)') : 'var(--ok)' }} />
                <span style={{ fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.device_number != null ? `${s.device_number}. ` : ''}{s.name}
                </span>
                {s.fw_version && <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--subtle)' }}>fw {s.fw_version}</span>}
                <span style={{ color: s.stale ? 'var(--crit)' : 'var(--muted)', fontSize: 'var(--fs-xs)', minWidth: 110, textAlign: 'right' }}>
                  {ago(s.minutes_since)}
                </span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--subtle)', margin: 'var(--sp-2) 0 0' }}>
            Stil = langer dan {data.stale_after_minutes} minuten geen meting. Sensoren die nog nooit gemeten hebben, staan grijs.
          </p>
        </Card>

        {/* ── Deployments ────────────────────────────────────────────────── */}
        <Card accent={data.deployments.in_sync === false ? 'var(--warn)' : 'var(--brand)'}>
          <SectionHeading
            right={
              data.deployments.in_sync == null ? null : (
                <Verdict tone={data.deployments.in_sync ? 'ok' : 'warn'}>
                  {data.deployments.in_sync ? 'Zelfde versie' : 'Versies lopen uiteen'}
                </Verdict>
              )
            }
          >
            <Rocket size={15} style={{ color: 'var(--brand)' }} /> Deployments
          </SectionHeading>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {data.deployments.list.map((d) => (
              <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-sm)', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: !d.reachable ? 'var(--crit)' : d.status === 'degraded' ? 'var(--warn)' : 'var(--ok)' }} />
                <span style={{ fontWeight: 600, color: 'var(--text)', minWidth: 90 }}>{d.label}</span>
                <span style={{ flex: 1, color: 'var(--muted)', fontSize: 'var(--fs-xs)' }}>
                  {d.reachable ? `${d.status ?? 'onbekend'} · ${d.took_ms} ms` : 'onbereikbaar'}
                </span>
                <code style={{ fontSize: 'var(--fs-2xs)', color: 'var(--subtle)' }}>{d.commit ?? '—'}</code>
              </div>
            ))}
          </div>
          {data.deployments.in_sync === false && (
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', margin: 'var(--sp-2) 0 0', lineHeight: 1.55 }}>
              Er draait niet overal dezelfde build. Dat is precies hoe productie dagenlang een oud dashboard kon tonen:
              deploy met <code>ops/vps/deploy.sh prod</code>.
            </p>
          )}
        </Card>

        {/* ── Fase 2: e-mail ─────────────────────────────────────────────── */}
        <SettingsCard />
        <MailCard />

        <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--subtle)', margin: 0 }}>
          Bijgewerkt {fmt(data.generated_at)}
        </p>
      </div>
    </AppShell>
  )
}
