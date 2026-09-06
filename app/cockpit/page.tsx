'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import Card from '@/components/ui/Card'
import SectionHeading from '@/components/ui/SectionHeading'
import SegmentedControl from '@/components/ui/SegmentedControl'
import Button from '@/components/ui/Button'
import DataBanner, { DataError, describeError } from '@/components/DataBanner'
import { MetricCardSkeleton } from '@/components/ui/Skeleton'
import { withBase } from '@/lib/basePath'
import Link from 'next/link'
import { Building2, ShieldAlert, Wifi, WifiOff, CircleDashed, Mail, Send, Check, FileText, Inbox, AlertTriangle, ArrowRight } from 'lucide-react'

// Pilot-cockpit voor org-ADMINS (docs/pilot-cockpit-plan.md §2c fase 2, docs/support-assistant.md).
// Leest /api/cockpit: sensoren van de org mét contact (laag B), laatste rapport en een
// samenvatting van de klantenservice-inbox (de inbox zelf leeft op /cockpit/inbox).
// Viewers krijgen 403 en zien alleen /vloot (zonder namen).

type Frequency = 'daily' | 'weekly' | 'monthly'
const FREQ_LABEL: Record<Frequency, string> = { daily: 'elke dag', weekly: 'elke week', monthly: 'elke maand' }
interface Contact { name: string | null; email: string | null; address_note: string | null; report_consent: boolean; report_frequency: Frequency }
type Verdict = 'ok' | 'warning' | 'critical' | 'nodata'
interface LastReport { sent_at: string; period_start: string; period_end: string; verdict: Verdict; status: string; trigger: string }
interface Device {
  id: string
  device_number: number | null
  name: string | null
  active: boolean
  room: string | null
  registered_at: string | null
  online: boolean
  minutes_since: number | null
  fw_version: string | null
  boot_count: number | null
  rssi: number | null
  contact: Contact | null
  last_report: LastReport | null
}
type InboxStatus = 'received' | 'draft' | 'answered' | 'closed' | 'send_failed' | 'error' | 'stored'
interface InboxItem {
  id: number
  escalate: boolean | null
  status: InboxStatus
  device_number: number | null
}
interface Org { id: string; name: string }
type SupportMode = 'draft' | 'auto' | 'off'

// Open = wacht op een mens. 'stored' (stand off: alleen opgeslagen) telt ook als open,
// want niemand heeft de bewoner geantwoord.
const OPEN_STATUS: ReadonlySet<InboxStatus> = new Set(['received', 'draft', 'error', 'send_failed', 'stored'])
const VERDICT_LABEL: Record<Verdict, string> = { ok: 'In orde', warning: 'Aandachtspunten', critical: 'Actie', nodata: 'Geen metingen' }
const SWEEP_LABEL: Record<string, string> = { sent: 'verstuurd', failed: 'mislukt', dry: 'niet verstuurd (proefstand)', duplicate: 'al verstuurd voor deze periode', inactive: 'sensor staat uit' }
const MODE_TEXT: Record<SupportMode, string> = {
  draft: 'Stand: draft — voorstellen gaan naar jou, bewoners krijgen niets.',
  auto: 'Stand: auto — niet-geëscaleerde vragen worden automatisch beantwoord; escalaties komen bij jou.',
  off: 'Stand: off — binnenkomende mails worden alleen opgeslagen, niemand krijgt een antwoord.',
}
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

const nr = (n: number | null) => (n == null ? '—' : String(n).padStart(2, '0'))
const fmtDate = (s: string) => new Date(s).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })

function ago(mins: number | null): string {
  if (mins == null) return 'nooit gezien'
  if (mins < 60) return `${mins} min`
  if (mins < 1440) return `${Math.floor(mins / 60)} uur`
  return `${Math.floor(mins / 1440)} dagen`
}

function presence(d: Device) {
  if (d.online) return { symbol: '●', color: 'var(--ok)', Icon: Wifi, label: 'online', detail: d.minutes_since != null ? `${ago(d.minutes_since)} geleden` : '' }
  if (d.minutes_since != null) return { symbol: '◐', color: 'var(--warn)', Icon: WifiOff, label: `stil ${ago(d.minutes_since)}`, detail: `laatst gezien ${ago(d.minutes_since)} geleden` }
  return { symbol: '○', color: 'var(--muted)', Icon: CircleDashed, label: 'nooit gezien', detail: 'nog geen enkele meting' }
}

async function post(body: Record<string, unknown>): Promise<{ status: number; data: any }> {
  const r = await fetch(withBase('/api/cockpit'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await r.json().catch(() => null)
  return { status: r.status, data }
}

export default function CockpitPage() {
  const router = useRouter()
  const supabase = createClient()
  const [orgs, setOrgs] = useState<Org[]>([])
  const [org, setOrg] = useState<Org | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [inbox, setInbox] = useState<InboxItem[]>([])
  const [supportMode, setSupportMode] = useState<SupportMode>('draft')
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState<DataError>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push('/login')
    })
  }, [supabase, router])

  const load = useCallback(async (orgId?: string | null) => {
    try {
      const q = orgId ? `/api/cockpit?org=${encodeURIComponent(orgId)}` : '/api/cockpit'
      const r = await fetch(withBase(q))
      if (r.status === 401) { router.push('/login'); return }
      if (r.status === 403) { setForbidden(true); setError(null); return }
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status })
      const d = await r.json()
      setOrgs(d.orgs ?? [])
      setOrg(d.org ?? null)
      setDevices(d.devices ?? [])
      setInbox(d.inbox ?? [])
      setSupportMode(d.support_mode === 'auto' || d.support_mode === 'off' ? d.support_mode : 'draft')
      setForbidden(false)
      setError(null)
    } catch (e) {
      const status = (e as { status?: number })?.status
      setError(describeError(status, status == null))
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { load() }, [load])
  const reload = useCallback(() => load(org?.id), [load, org])

  const sortedDevices = useMemo(
    () => [...devices].sort((a, b) => (a.device_number ?? 1e9) - (b.device_number ?? 1e9)),
    [devices],
  )
  const counts = useMemo(() => {
    const c = { online: 0, quiet: 0, never: 0, reports: 0 }
    const since = Date.now() - WEEK_MS
    for (const d of devices) {
      if (d.online) c.online++
      else if (d.minutes_since != null) c.quiet++
      else c.never++
      if (d.last_report?.status === 'sent' && new Date(d.last_report.sent_at).getTime() >= since) c.reports++
    }
    return c
  }, [devices])

  // Inbox-samenvatting: open + geëscaleerd, en het aantal berichten per sensornummer
  // voor de link op de sensorkaart (/api/cockpit levert de laatste 50 mails).
  const inboxSummary = useMemo(() => {
    let open = 0, escalated = 0
    const perNumber = new Map<number, number>()
    for (const m of inbox) {
      if (OPEN_STATUS.has(m.status)) { open++; if (m.escalate) escalated++ }
      if (m.device_number != null) perNumber.set(m.device_number, (perNumber.get(m.device_number) ?? 0) + 1)
    }
    return { open, escalated, perNumber }
  }, [inbox])
  const openCount = inboxSummary.open

  return (
    <AppShell title="Cockpit">
      {error && <DataBanner error={error} onRetry={reload} />}

      {forbidden && (
        <Card style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
          <ShieldAlert style={{ color: 'var(--muted)', flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Alleen voor beheerders van de pilot</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>
              De cockpit toont contactgegevens van bewoners en is daarom alleen voor beheerders.
              Als corporatie-medewerker zie je de vloot zonder namen op het vlootoverzicht.
            </div>
          </div>
        </Card>
      )}

      {!forbidden && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-3)', flexWrap: 'wrap', marginBottom: 'var(--sp-4)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>
              <Building2 size={15} /> {org?.name ?? 'Pilot'} · {devices.length} sensor{devices.length === 1 ? '' : 'en'}
            </span>
            {orgs.length > 1 && org && (
              <SegmentedControl
                ariaLabel="Kies organisatie"
                value={org.id}
                onChange={(v) => { setLoading(true); load(String(v)) }}
                options={orgs.map((o) => ({ label: o.name, value: o.id }))}
              />
            )}
          </div>

          {/* Samenvatting: de vloot in één oogopslag. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--sp-3)', marginBottom: 'var(--sp-5)' }}>
            <Tile Icon={Wifi} color="var(--ok)" value={counts.online} label="online" />
            <Tile Icon={WifiOff} color="var(--warn)" value={counts.quiet} label="stil" />
            <Tile Icon={CircleDashed} color="var(--muted)" value={counts.never} label="nooit gezien" />
            <Tile Icon={FileText} color="var(--brand)" value={counts.reports} label="rapporten deze week" />
          </div>

          <SectionHeading>Sensoren</SectionHeading>
          {loading ? (
            <div style={{ display: 'grid', gap: 'var(--sp-3)', marginBottom: 'var(--sp-5)' }}>
              {[0, 1, 2].map((i) => <MetricCardSkeleton key={i} />)}
            </div>
          ) : sortedDevices.length === 0 ? (
            <Card style={{ marginBottom: 'var(--sp-5)' }}>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>
                Nog geen sensoren in deze organisatie. Koppel ze via het vlootoverzicht.
              </div>
            </Card>
          ) : (
            <div style={{ display: 'grid', gap: 'var(--sp-3)', marginBottom: 'var(--sp-5)' }}>
              {sortedDevices.map((d) => (
                <DeviceRow key={d.id} device={d} messages={d.device_number != null ? inboxSummary.perNumber.get(d.device_number) ?? 0 : 0} onChanged={reload} />
              ))}
            </div>
          )}

          <SectionHeading right={<span style={{ fontSize: 'var(--fs-xs)', color: openCount ? 'var(--warn)' : 'var(--muted)', fontWeight: 600 }}>{openCount} open</span>}>
            Inbox klantenservice
          </SectionHeading>
          {loading ? (
            <MetricCardSkeleton />
          ) : (
            <Card accent={inboxSummary.escalated ? 'var(--crit)' : openCount ? 'var(--warn)' : 'var(--ok)'}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--text)', lineHeight: 1.1 }}>{openCount}</div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>open</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: inboxSummary.escalated ? 'var(--crit)' : 'var(--text)', lineHeight: 1.1 }}>{inboxSummary.escalated}</div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>geëscaleerd</div>
                  </div>
                </div>
                <Link href="/cockpit/inbox" className="wz-navlink" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--brand)', background: 'var(--brand-fill)' }}>
                  <Inbox size={15} /> Open de inbox <ArrowRight size={14} />
                </Link>
              </div>
              <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-start', marginTop: 'var(--sp-3)', fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>
                <Mail size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>{openCount === 0 ? 'Geen open vragen. ' : ''}{MODE_TEXT[supportMode]}</span>
              </div>
            </Card>
          )}
        </>

      )}
    </AppShell>
  )
}

function Tile({ Icon, color, value, label }: { Icon: typeof Wifi; color: string; value: number; label: string }) {
  return (
    <Card accent={color} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', minWidth: 0 }}>
      <Icon style={{ color, flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--text)' }}>{value}</div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>{label}</div>
      </div>
    </Card>
  )
}

// ── Sectie A: één kaart per sensor ───────────────────────────────────────────

function DeviceRow({ device: d, messages, onChanged }: { device: Device; messages: number; onChanged: () => void }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [freqBusy, setFreqBusy] = useState(false)
  const p = presence(d)
  const canSend = !!d.contact?.report_consent

  async function setFrequency(frequency: Frequency) {
    setFreqBusy(true)
    setResult(null)
    try {
      const { data } = await post({ action: 'set_frequency', device_id: d.id, frequency })
      if (data?.ok) setResult({ ok: true, text: `Rapport nu ${FREQ_LABEL[frequency]}.` })
      else setResult({ ok: false, text: 'Frequentie opslaan mislukt.' })
    } catch {
      setResult({ ok: false, text: 'Mislukt: geen verbinding.' })
    } finally {
      setFreqBusy(false)
      onChanged()
    }
  }
  const rep = d.last_report

  let reportText: string
  let reportColor = 'var(--muted)'
  if (rep) {
    const failed = rep.status !== 'sent'
    reportText = `rapport ${failed ? 'mislukt' : 'verstuurd'} ${fmtDate(rep.sent_at)} (${VERDICT_LABEL[rep.verdict] ?? rep.verdict})`
    reportColor = failed ? 'var(--crit)' : 'var(--text)'
  } else if (!canSend) {
    reportText = 'geen toestemming'
  } else {
    reportText = 'nog geen rapport'
  }

  async function send() {
    setBusy(true)
    setResult(null)
    try {
      const { status, data } = await post({ action: 'send_report', device_id: d.id })
      if (status === 409) setResult({ ok: false, text: 'Mislukt: geen contact met toestemming.' })
      else if (!data || typeof data.ok !== 'boolean') setResult({ ok: false, text: 'Mislukt: de server gaf geen antwoord.' })
      else {
        const s = data.item?.status as string | undefined
        const v = data.item?.verdict as Verdict | undefined
        setResult({ ok: data.ok, text: data.ok ? `Verstuurd${v ? ` (${VERDICT_LABEL[v] ?? v})` : ''}.` : `Mislukt: ${SWEEP_LABEL[s ?? ''] ?? 'onbekende fout'}.` })
      }
    } catch {
      setResult({ ok: false, text: 'Mislukt: geen verbinding.' })
    } finally {
      setBusy(false)
      setAsking(false)
      onChanged()
    }
  }

  const meta = [d.fw_version ? `fw ${d.fw_version}` : null, d.boot_count != null ? `${d.boot_count}× gestart` : null, d.rssi != null ? `${d.rssi} dBm` : null].filter(Boolean).join(' · ')

  return (
    <Card accent={p.color} style={{ opacity: d.active ? 1 : 0.6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', minWidth: 0 }}>
          <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{nr(d.device_number)}</span>
          <span style={{ fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {d.room ?? d.name ?? 'kamer onbekend'}
          </span>
          {!d.active && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>uit</span>}
        </div>
        <span title={p.detail} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-xs)', fontWeight: 700, color: p.color, whiteSpace: 'nowrap' }}>
          <span aria-hidden>{p.symbol}</span> {p.label}
        </span>
      </div>
      {meta && <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--muted)', marginTop: 4 }}>{meta}{p.detail ? ` · ${p.detail}` : ''}</div>}

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--sp-3)', flexWrap: 'wrap', marginTop: 'var(--sp-3)' }}>
        <div style={{ minWidth: 0, flex: '1 1 220px', display: 'grid', gap: 3 }}>
          <div style={{ fontSize: 'var(--fs-sm)', color: d.contact ? 'var(--text)' : 'var(--muted)', overflowWrap: 'anywhere' }}>
            {d.contact
              ? [d.contact.name, d.contact.address_note, d.contact.email].filter(Boolean).join(' · ') || 'contact zonder gegevens'
              : 'geen contact'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap', fontSize: 'var(--fs-xs)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: reportColor }}>
              <FileText size={13} style={{ flexShrink: 0 }} /> {reportText}
            </span>
            <Link href={`/cockpit/inbox?device=${encodeURIComponent(d.id)}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--brand)', fontWeight: 600, textDecoration: 'none' }}>
              <Mail size={13} style={{ flexShrink: 0 }} /> Berichten{messages > 0 ? ` (${messages})` : ''}
            </Link>
          </div>
          {result && (
            <div role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-xs)', fontWeight: 600, color: result.ok ? 'var(--ok)' : 'var(--crit)' }}>
              {result.ok ? <Check size={13} /> : <AlertTriangle size={13} />} {result.text}
            </div>
          )}
        </div>
        {canSend && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>
              Rapport
              <select
                aria-label="Hoe vaak een rapport"
                value={d.contact?.report_frequency ?? 'weekly'}
                disabled={freqBusy || busy}
                onChange={(e) => setFrequency(e.target.value as Frequency)}
                style={{ padding: '5px 8px', fontSize: 'var(--fs-xs)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface)', color: 'var(--text)' }}
              >
                {(Object.keys(FREQ_LABEL) as Frequency[]).map((f) => <option key={f} value={f}>{FREQ_LABEL[f]}</option>)}
              </select>
            </label>
            {asking ? (
              <>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>Zeker?</span>
                <Button size="sm" variant="primary" icon={<Send size={13} />} onClick={send} disabled={busy}>{busy ? 'Bezig…' : 'Verstuur'}</Button>
                <Button size="sm" variant="ghost" onClick={() => setAsking(false)} disabled={busy}>Annuleer</Button>
              </>
            ) : (
              <Button size="sm" icon={<Send size={13} />} onClick={() => { setResult(null); setAsking(true) }} disabled={busy}>Nu versturen</Button>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}
