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
import { Building2, ShieldAlert, Wifi, WifiOff, CircleDashed, Mail, Send, Check, X, FileText, Inbox, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'

// Pilot-cockpit voor org-ADMINS (docs/pilot-cockpit-plan.md §2c fase 2, docs/support-assistant.md).
// Leest /api/cockpit: sensoren van de org mét contact (laag B), laatste rapport en de
// klantenservice-inbox. Viewers krijgen 403 en zien alleen /vloot (zonder namen).

interface Contact { name: string | null; email: string | null; address_note: string | null; report_consent: boolean }
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
  created_at: string
  handled_at: string | null
  from_addr: string
  subject: string | null
  body: string | null
  reply: string | null
  escalate: boolean | null
  reason: string | null
  status: InboxStatus
  model: string | null
  device_number: number | null
}
interface Org { id: string; name: string }
type SupportMode = 'draft' | 'auto' | 'off'

// Open = wacht op een mens. 'stored' (stand off: alleen opgeslagen) telt ook als open,
// want niemand heeft de bewoner geantwoord.
const OPEN_STATUS: ReadonlySet<InboxStatus> = new Set(['received', 'draft', 'error', 'send_failed', 'stored'])
const STATUS_LABEL: Record<InboxStatus, string> = {
  received: 'ontvangen', draft: 'voorstel', answered: 'beantwoord', closed: 'afgehandeld',
  send_failed: 'versturen mislukt', error: 'fout', stored: 'opgeslagen',
}
const VERDICT_LABEL: Record<Verdict, string> = { ok: 'In orde', warning: 'Aandachtspunten', critical: 'Actie', nodata: 'Geen metingen' }
const SWEEP_LABEL: Record<string, string> = { sent: 'verstuurd', failed: 'mislukt', dry: 'niet verstuurd (proefstand)', duplicate: 'al verstuurd voor deze periode', inactive: 'sensor staat uit' }
const MODE_TEXT: Record<SupportMode, string> = {
  draft: 'Stand: draft — voorstellen gaan naar jou, bewoners krijgen niets.',
  auto: 'Stand: auto — niet-geëscaleerde vragen worden automatisch beantwoord; escalaties komen bij jou.',
  off: 'Stand: off — binnenkomende mails worden alleen opgeslagen, niemand krijgt een antwoord.',
}
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const LONG_BODY = 320

const nr = (n: number | null) => (n == null ? '—' : String(n).padStart(2, '0'))
const fmtDate = (s: string) => new Date(s).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
const fmtDateTime = (s: string) => new Date(s).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

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

  const sortedInbox = useMemo(() => {
    const rank = (m: InboxItem) => (OPEN_STATUS.has(m.status) ? 0 : 1)
    return [...inbox].sort((a, b) => rank(a) - rank(b) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [inbox])
  const openCount = useMemo(() => inbox.filter((m) => OPEN_STATUS.has(m.status)).length, [inbox])

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
              {sortedDevices.map((d) => <DeviceRow key={d.id} device={d} onChanged={reload} />)}
            </div>
          )}

          <SectionHeading right={<span style={{ fontSize: 'var(--fs-xs)', color: openCount ? 'var(--warn)' : 'var(--muted)', fontWeight: 600 }}>{openCount} open</span>}>
            Inbox klantenservice
          </SectionHeading>
          <Card pad="10px 14px" style={{ marginBottom: 'var(--sp-3)', display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-start', fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>
            <Inbox size={15} style={{ color: 'var(--muted)', flexShrink: 0, marginTop: 2 }} />
            <span>{MODE_TEXT[supportMode]}</span>
          </Card>
          {loading ? (
            <MetricCardSkeleton />
          ) : sortedInbox.length === 0 ? (
            <Card>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>
                Nog geen vragen van bewoners. Alles wat op het hulpadres binnenkomt verschijnt hier.
              </div>
            </Card>
          ) : (
            <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              {sortedInbox.map((m) => <InboxRow key={m.id} item={m} onChanged={reload} />)}
            </div>
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

function DeviceRow({ device: d, onChanged }: { device: Device; onChanged: () => void }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const p = presence(d)
  const canSend = !!d.contact?.report_consent
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
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-xs)', color: reportColor }}>
            <FileText size={13} style={{ flexShrink: 0 }} /> {reportText}
          </div>
          {result && (
            <div role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-xs)', fontWeight: 600, color: result.ok ? 'var(--ok)' : 'var(--crit)' }}>
              {result.ok ? <Check size={13} /> : <AlertTriangle size={13} />} {result.text}
            </div>
          )}
        </div>
        {canSend && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
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

// ── Sectie B: klantenservice-inbox ───────────────────────────────────────────

function InboxRow({ item: m, onChanged }: { item: InboxItem; onChanged: () => void }) {
  const open = OPEN_STATUS.has(m.status)
  const [text, setText] = useState(m.reply ?? '')
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState<'send' | 'close' | null>(null)
  const [fail, setFail] = useState<string | null>(null)

  const body = m.body ?? ''
  const long = body.length > LONG_BODY
  const shownBody = long && !expanded ? body.slice(0, LONG_BODY).trimEnd() + '…' : body
  const accent = open ? (m.escalate ? 'var(--crit)' : 'var(--warn)') : 'var(--border)'
  const statusColor = m.status === 'send_failed' || m.status === 'error' ? 'var(--crit)' : open ? 'var(--warn)' : 'var(--muted)'

  async function act(action: 'support_send' | 'support_close') {
    setBusy(action === 'support_send' ? 'send' : 'close')
    setFail(null)
    try {
      const payload = action === 'support_send' ? { action, id: m.id, text } : { action, id: m.id }
      const { status, data } = await post(payload)
      if (status === 400 && data?.error === 'empty') setFail('Het antwoord is leeg.')
      else if (!data?.ok) {
        setFail(action === 'support_send' ? 'Versturen is mislukt. Probeer het nog eens.' : 'Afhandelen is mislukt.')
        // De server heeft de status dan al op send_failed gezet: label bijwerken, tekst blijft staan.
        if (status === 200) onChanged()
      } else onChanged()
    } catch {
      setFail('Geen verbinding met de server.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card accent={accent} style={{ opacity: open ? 1 : 0.7 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-xs)', color: 'var(--muted)', flexWrap: 'wrap' }}>
          <span>{fmtDateTime(m.created_at)}</span>
          <span>·</span>
          <span style={{ fontWeight: 600, color: 'var(--text)' }}>{m.device_number != null ? `sensor ${nr(m.device_number)}` : 'onbekend adres'}</span>
        </div>
        <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: statusColor, whiteSpace: 'nowrap' }}>{STATUS_LABEL[m.status] ?? m.status}</span>
      </div>

      <div style={{ marginTop: 'var(--sp-2)', display: 'grid', gap: 2 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', color: 'var(--muted)', overflowWrap: 'anywhere' }}>
          <Mail size={13} style={{ flexShrink: 0 }} /> {m.from_addr}
        </div>
        <div style={{ fontWeight: 700, color: 'var(--text)', overflowWrap: 'anywhere' }}>{m.subject || '(geen onderwerp)'}</div>
      </div>

      {body && (
        <div style={{ marginTop: 'var(--sp-2)', fontSize: 'var(--fs-sm)', color: 'var(--text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: 'var(--surface-2)', border: '1px solid var(--border-soft)', borderRadius: 'var(--r-md)', padding: '8px 11px' }}>
          {shownBody}
          {long && (
            <button onClick={() => setExpanded((v) => !v)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 8, background: 'transparent', border: 0, padding: 0, color: 'var(--brand)', fontSize: 'var(--fs-xs)', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              {expanded ? <><ChevronUp size={12} /> minder</> : <><ChevronDown size={12} /> meer</>}
            </button>
          )}
        </div>
      )}

      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 'var(--sp-2)', fontSize: 'var(--fs-xs)', fontWeight: 600, color: m.escalate ? 'var(--crit)' : 'var(--ok)', overflowWrap: 'anywhere' }}>
        {m.escalate ? <><AlertTriangle size={13} style={{ flexShrink: 0 }} /> escaleren{m.reason ? `: ${m.reason}` : ''}</> : <><Check size={13} style={{ flexShrink: 0 }} /> kan automatisch{m.reason ? ` — ${m.reason}` : ''}</>}
      </div>

      {open ? (
        <>
          <label htmlFor={`reply-${m.id}`} style={{ display: 'block', marginTop: 'var(--sp-3)', fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--muted)' }}>
            Voorgesteld antwoord{m.model ? ` (${m.model})` : ''}
          </label>
          <textarea
            id={`reply-${m.id}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.min(14, Math.max(5, text.split('\n').length + 1))}
            placeholder="Schrijf hier je antwoord aan de bewoner…"
            style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '9px 12px', fontSize: 'var(--fs-sm)', lineHeight: 1.5, fontFamily: 'inherit', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface)', color: 'var(--text)', resize: 'vertical' }}
          />
          {fail && (
            <div role="alert" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 'var(--sp-2)', fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--crit)' }}>
              <AlertTriangle size={13} /> {fail}
            </div>
          )}
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', marginTop: 'var(--sp-3)' }}>
            <Button size="sm" variant="primary" icon={<Send size={13} />} onClick={() => act('support_send')} disabled={busy != null || !text.trim()}>
              {busy === 'send' ? 'Bezig…' : 'Verstuur dit antwoord'}
            </Button>
            <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => act('support_close')} disabled={busy != null}>
              {busy === 'close' ? 'Bezig…' : 'Afgehandeld zonder antwoord'}
            </Button>
          </div>
        </>
      ) : (
        m.reply && (
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--muted)' }}>
              {m.status === 'answered' ? 'Verstuurd antwoord' : 'Voorstel (niet verstuurd)'}{m.handled_at ? ` · ${fmtDateTime(m.handled_at)}` : ''}
            </div>
            <div style={{ marginTop: 4, fontSize: 'var(--fs-sm)', color: 'var(--text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.reply}</div>
          </div>
        )
      )}
    </Card>
  )
}
