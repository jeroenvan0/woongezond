'use client'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import Card from '@/components/ui/Card'
import SectionHeading from '@/components/ui/SectionHeading'
import SegmentedControl from '@/components/ui/SegmentedControl'
import Button from '@/components/ui/Button'
import DataBanner, { DataError, describeError } from '@/components/DataBanner'
import { MetricCardSkeleton } from '@/components/ui/Skeleton'
import { withBase } from '@/lib/basePath'
import { Building2, ShieldAlert, Inbox, AlertTriangle, Mail, Check, X, Send, FileText, ChevronDown, ChevronUp, RotateCcw, Search, Bot, MailQuestion } from 'lucide-react'

// Inbox van de klantenservice voor org-ADMINS (docs/support-assistant.md). Leest
// /api/cockpit/inbox: per sensor / bewoner / organisatie wat er binnenkwam (mails met het
// voorstel of het verstuurde antwoord) en wat er is gestuurd (rapporten). Acties gaan via
// POST /api/cockpit (support_send / support_close / support_reopen).

type MsgStatus = 'received' | 'draft' | 'stored' | 'error' | 'send_failed' | 'answered' | 'closed'
type Verdict = 'ok' | 'warning' | 'critical' | 'nodata'
type StatusFilter = 'open' | 'done' | 'all'
type SupportMode = 'draft' | 'auto' | 'off'
/** 'all' · 'unknown' (mails zonder sensor, client-side) · een device-uuid. */
type DeviceSel = string

interface Org { id: string; name: string }
interface Device {
  id: string
  device_number: number | null
  name: string | null
  active: boolean
  room: string | null
  contact_name: string | null
  contact_email: string | null
  report_consent: boolean
  report_frequency: string
}
interface Msg {
  id: number
  created_at: string
  handled_at: string | null
  from_addr: string
  to_addr: string | null
  subject: string | null
  body: string | null
  reply: string | null
  escalate: boolean | null
  reason: string | null
  status: MsgStatus
  model: string | null
  device_id: string | null
  device_number: number | null
  room: string | null
  contact_name: string | null
  open: boolean
}
interface Report {
  id: number
  device_id: string
  device_number: number | null
  contact_name: string | null
  sent_at: string
  period_start: string
  period_end: string
  verdict: Verdict
  status: string
  trigger: string
  readings: number | null
}
interface Counts { open: number; escalated: number; total: number; per_device: Record<string, { open: number; total: number }> }
interface Payload { orgs: Org[]; org: Org | null; devices: Device[]; messages: Msg[]; reports: Report[]; counts: Counts; support_mode: string }

const UUID_RE = /^[0-9a-f-]{36}$/i
const LONG_BODY = 320
const STATUS_LABEL: Record<MsgStatus, string> = {
  received: 'ontvangen', draft: 'voorstel', stored: 'opgeslagen', error: 'fout', send_failed: 'versturen mislukt', answered: 'beantwoord', closed: 'afgehandeld',
}
const STATUS_NOTE: Partial<Record<MsgStatus, string>> = {
  error: 'De assistent kon niet antwoorden. Schrijf zelf een antwoord of handel de vraag af.',
  send_failed: 'Versturen is mislukt. Probeer het nog eens.',
  stored: 'Alleen opgeslagen (stand off): de bewoner heeft nog niets gekregen.',
  received: 'Ontvangen; er is nog geen voorstel van de assistent.',
}
const VERDICT_LABEL: Record<Verdict, string> = { ok: 'In orde', warning: 'Aandachtspunten', critical: 'Actie', nodata: 'Geen metingen' }
const VERDICT_COLOR: Record<Verdict, string> = { ok: 'var(--ok)', warning: 'var(--warn)', critical: 'var(--crit)', nodata: 'var(--muted)' }
const SEND_LABEL: Record<string, string> = { sent: 'verstuurd', failed: 'mislukt', dry: 'niet verstuurd (proefstand)', duplicate: 'al verstuurd', inactive: 'sensor staat uit' }
const MODE_SHORT: Record<SupportMode, string> = { draft: 'voorstellen gaan naar jou', auto: 'automatisch beantwoord, escalaties naar jou', off: 'alleen opgeslagen, niemand krijgt antwoord' }
const STATUS_OPTIONS: { label: string; value: StatusFilter }[] = [{ label: 'Open', value: 'open' }, { label: 'Afgehandeld', value: 'done' }, { label: 'Alles', value: 'all' }]

const nr = (n: number | null) => (n == null ? '—' : String(n).padStart(2, '0'))
const fmtDate = (s: string) => new Date(s).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
const fmtDateTime = (s: string) => new Date(s).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const ymd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
function fmtPeriod(start: string, end: string): string {
  const a = ymd(start), b = ymd(end)
  if (a.getTime() === b.getTime()) return a.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
  const aStr = a.toLocaleDateString('nl-NL', a.getMonth() === b.getMonth() ? { day: 'numeric' } : { day: 'numeric', month: 'short' })
  return `${aStr} – ${b.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}`
}
function reportKind(start: string, end: string): string {
  const days = Math.round((ymd(end).getTime() - ymd(start).getTime()) / 86400000) + 1
  return days <= 1 ? 'Dagrapport' : days <= 8 ? 'Weekrapport' : 'Maandrapport'
}
const ts = (s: string | null) => (s ? new Date(s).getTime() : 0)

// ── Data ─────────────────────────────────────────────────────────────────────

async function fetchInbox(p: { org: string | null; device: string | null; status: StatusFilter; q: string }): Promise<{ status: number; data: Payload | null }> {
  const sp = new URLSearchParams()
  if (p.org) sp.set('org', p.org)
  if (p.device) sp.set('device', p.device)
  sp.set('status', p.status)
  if (p.q) sp.set('q', p.q)
  const r = await fetch(withBase(`/api/cockpit/inbox?${sp.toString()}`))
  const data = r.ok ? await r.json().catch(() => null) : null
  return { status: r.status, data }
}

async function post(body: Record<string, unknown>): Promise<{ status: number; data: any }> {
  const r = await fetch(withBase('/api/cockpit'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await r.json().catch(() => null)
  return { status: r.status, data }
}

// ── Pagina ───────────────────────────────────────────────────────────────────

export default function InboxPage() {
  // useSearchParams heeft in de app router een Suspense-grens nodig.
  return (
    <Suspense fallback={<AppShell title="Inbox"><MetricCardSkeleton /></AppShell>}>
      <InboxInner />
    </Suspense>
  )
}

function InboxInner() {
  const router = useRouter()
  const params = useSearchParams()
  const supabase = createClient()
  const [orgId, setOrgId] = useState<string | null>(null)
  const [device, setDevice] = useState<DeviceSel>(() => {
    const d = params.get('device')
    return d && (UUID_RE.test(d) || d === 'unknown') ? d : 'all'
  })
  const [status, setStatus] = useState<StatusFilter>('open')
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState<DataError>(null)
  const seq = useRef(0)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push('/login')
    })
  }, [supabase, router])

  // Zoekveld: pas 300 ms na de laatste toetsaanslag ophalen.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300)
    return () => clearTimeout(t)
  }, [qInput])

  const load = useCallback(async () => {
    const my = ++seq.current
    try {
      const { status: code, data: d } = await fetchInbox({ org: orgId, device: UUID_RE.test(device) ? device : null, status, q })
      if (my !== seq.current) return
      if (code === 401) { router.push('/login'); return }
      if (code === 403) { setForbidden(true); setError(null); return }
      if (!d) throw Object.assign(new Error(`HTTP ${code}`), { status: code })
      setData(d)
      if (!orgId && d.org) setOrgId(d.org.id)
      setForbidden(false)
      setError(null)
    } catch (e) {
      if (my !== seq.current) return
      const st = (e as { status?: number })?.status
      setError(describeError(st, st == null))
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [orgId, device, status, q, router])

  useEffect(() => { load() }, [load])

  function pickDevice(id: DeviceSel) {
    if (id === device) return
    setDevice(id)
    setLoading(true)
    router.replace(id === 'all' ? '/cockpit/inbox' : `/cockpit/inbox?device=${encodeURIComponent(id)}`, { scroll: false })
  }
  function pickOrg(id: string) {
    setOrgId(id)
    setDevice('all')
    setLoading(true)
    router.replace('/cockpit/inbox', { scroll: false })
  }
  function pickStatus(s: StatusFilter) {
    setStatus(s)
    setLoading(true)
  }

  const devices = data?.devices ?? []
  const orgs = data?.orgs ?? []
  const org = data?.org ?? null
  const counts = data?.counts ?? { open: 0, escalated: 0, total: 0, per_device: {} }
  const mode: SupportMode = data?.support_mode === 'auto' || data?.support_mode === 'off' ? data.support_mode : 'draft'
  const selected = useMemo(() => devices.find((d) => d.id === device) ?? null, [devices, device])
  const messages = useMemo(() => {
    const all = data?.messages ?? []
    return device === 'unknown' ? all.filter((m) => !m.device_id) : all
  }, [data, device])
  const reports = data?.reports ?? []
  const threads = useMemo(() => buildThreads(messages, selected ? reports : [], selected), [messages, reports, selected])
  const latestReports = useMemo(() => [...reports].sort((a, b) => ts(b.sent_at) - ts(a.sent_at)).slice(0, 10), [reports])
  const unknown = counts.per_device.unknown ?? { open: 0, total: 0 }

  let empty: string
  if (q) empty = `Niets gevonden voor “${q}”.`
  else if (status === 'open') empty = selected ? 'Geen open vragen van deze bewoner. Mooi zo.' : 'Geen open vragen. Mooi zo.'
  else if (status === 'done') empty = 'Nog niets afgehandeld.'
  else empty = 'Nog geen berichten. Alles wat op het hulpadres binnenkomt verschijnt hier.'

  return (
    <AppShell title="Inbox">
      {error && <DataBanner error={error} onRetry={load} />}

      {forbidden && (
        <Card style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
          <ShieldAlert style={{ color: 'var(--muted)', flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Alleen voor beheerders van de pilot</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>
              De inbox toont mails en contactgegevens van bewoners en is daarom alleen voor beheerders.
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
              <SegmentedControl ariaLabel="Kies organisatie" value={org.id} onChange={(v) => pickOrg(String(v))} options={orgs.map((o) => ({ label: o.name, value: o.id }))} />
            )}
          </div>

          {/* Bovenbalk: status, zoeken, tegels. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap', marginBottom: 'var(--sp-3)' }}>
            <SegmentedControl ariaLabel="Welke berichten" value={status} onChange={pickStatus} options={STATUS_OPTIONS} />
            <label style={{ position: 'relative', flex: '1 1 200px', minWidth: 0 }}>
              <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Zoeken in berichten</span>
              <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
              <input
                type="search"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="Zoek op onderwerp, tekst of adres"
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px 8px 32px', fontSize: 'var(--fs-sm)', fontFamily: 'inherit', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface)', color: 'var(--text)' }}
              />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--sp-3)', marginBottom: 'var(--sp-5)' }}>
            <Tile Icon={Inbox} color={counts.open ? 'var(--warn)' : 'var(--ok)'} value={counts.open} label="open" />
            <Tile Icon={AlertTriangle} color={counts.escalated ? 'var(--crit)' : 'var(--muted)'} value={counts.escalated} label="geëscaleerd" />
            <Tile Icon={Mail} color="var(--muted)" value={counts.total} label="totaal" />
            <Tile Icon={Bot} color="var(--brand)" value={mode} label={MODE_SHORT[mode]} />
          </div>

          <div className="wz-inbox-cols">
            {/* Linkerkolom: per sensor. */}
            <div className="wz-inbox-side">
              <SectionHeading>Per sensor</SectionHeading>
              <Card pad="var(--sp-2)">
                <SideRow active={device === 'all'} onClick={() => pickDevice('all')} title="Alle sensoren" sub={`${devices.length} sensor${devices.length === 1 ? '' : 'en'}`} open={counts.open} total={counts.total} />
                {devices.map((d) => {
                  const c = counts.per_device[d.id] ?? { open: 0, total: 0 }
                  return (
                    <SideRow
                      key={d.id}
                      active={device === d.id}
                      onClick={() => pickDevice(d.id)}
                      number={nr(d.device_number)}
                      title={d.room ?? d.name ?? 'kamer onbekend'}
                      sub={d.contact_name ?? 'geen contact'}
                      dim={!d.active}
                      open={c.open}
                      total={c.total}
                    />
                  )
                })}
                <SideRow active={device === 'unknown'} onClick={() => pickDevice('unknown')} title="Onbekend adres" sub="mails zonder sensor" open={unknown.open} total={unknown.total} />
              </Card>
            </div>

            {/* Rechterkolom: tijdlijn. */}
            <div style={{ minWidth: 0 }}>
              <SectionHeading right={<span style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', fontWeight: 600 }}>{selected ? `sensor ${nr(selected.device_number)}${selected.room ? ` · ${selected.room}` : ''}` : device === 'unknown' ? 'onbekend adres' : 'alle sensoren'}</span>}>
                Tijdlijn
              </SectionHeading>
              {loading ? (
                <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
                  {[0, 1].map((i) => <MetricCardSkeleton key={i} />)}
                </div>
              ) : (
                <>
                  {messages.length === 0 && (
                    <Card style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', marginBottom: 'var(--sp-3)' }}>
                      <MailQuestion style={{ color: 'var(--muted)', flexShrink: 0 }} />
                      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>{empty}</div>
                    </Card>
                  )}
                  {threads.length > 0 && (
                    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
                      {threads.map((t) => (
                        <ThreadView key={`${status}:${t.key}`} thread={t} defaultOpen={t.hasOpen || threads.length === 1} onChanged={load} />
                      ))}
                    </div>
                  )}
                  {!selected && device !== 'unknown' && latestReports.length > 0 && (
                    <div style={{ marginTop: 'var(--sp-5)' }}>
                      <SectionHeading>Laatste rapporten</SectionHeading>
                      <Card pad="var(--sp-2) var(--sp-3)">
                        <div style={{ display: 'grid' }}>
                          {latestReports.map((r) => <ReportLine key={r.id} report={r} showDevice />)}
                        </div>
                      </Card>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </AppShell>
  )
}

function Tile({ Icon, color, value, label }: { Icon: typeof Inbox; color: string; value: number | string; label: string }) {
  return (
    <Card accent={color} pad="var(--sp-3)" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', minWidth: 0 }}>
      <Icon style={{ color, flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--text)', lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', overflowWrap: 'anywhere' }}>{label}</div>
      </div>
    </Card>
  )
}

// ── Linkerkolom ──────────────────────────────────────────────────────────────

function SideRow({ active, onClick, number, title, sub, dim, open, total }: { active: boolean; onClick: () => void; number?: string; title: string; sub: string; dim?: boolean; open: number; total: number }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', width: '100%', textAlign: 'left', padding: '7px 9px', border: 0, borderRadius: 'var(--r-sm)', cursor: 'pointer', fontFamily: 'inherit',
        background: active ? 'var(--brand-fill)' : 'transparent', color: active ? 'var(--brand)' : 'var(--text)', opacity: dim ? 0.6 : 1,
      }}
    >
      {number && <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0, width: 22 }}>{number}</span>}
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: 'var(--fs-sm)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        <span style={{ display: 'block', fontSize: 'var(--fs-2xs)', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>
      </span>
      <span style={{ display: 'inline-flex', gap: 4, flexShrink: 0, fontSize: 'var(--fs-2xs)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {open > 0 && <span title={`${open} open`} style={{ padding: '1px 7px', borderRadius: 'var(--r-pill)', background: 'var(--warn-fill)', color: 'var(--warn)' }}>{open}</span>}
        <span title={`${total} in totaal`} style={{ padding: '1px 7px', borderRadius: 'var(--r-pill)', background: 'var(--surface-2)', color: 'var(--muted)' }}>{total}</span>
      </span>
    </button>
  )
}

// ── Tijdlijn ─────────────────────────────────────────────────────────────────

interface Thread {
  key: string
  addr: string
  name: string | null
  deviceNumber: number | null
  room: string | null
  msgs: Msg[]
  reports: Report[]
  last: number
  hasOpen: boolean
}

/** Gesprekken per afzenderadres; bij één gekozen sensor gaan de rapporten in de thread van het contactadres. */
function buildThreads(messages: Msg[], reports: Report[], selected: Device | null): Thread[] {
  const map = new Map<string, Thread>()
  for (const m of messages) {
    const key = m.from_addr.toLowerCase()
    let t = map.get(key)
    if (!t) {
      t = { key, addr: m.from_addr, name: null, deviceNumber: null, room: null, msgs: [], reports: [], last: 0, hasOpen: false }
      map.set(key, t)
    }
    t.msgs.push(m)
    if (m.contact_name && !t.name) t.name = m.contact_name
    if (m.device_number != null && t.deviceNumber == null) { t.deviceNumber = m.device_number; t.room = m.room }
    t.last = Math.max(t.last, ts(m.created_at), ts(m.handled_at))
    if (m.open) t.hasOpen = true
  }
  if (selected && reports.length) {
    const key = selected.contact_email?.toLowerCase()
    let t = key ? map.get(key) : undefined
    if (!t) {
      t = { key: 'reports', addr: selected.contact_email ?? '', name: selected.contact_name, deviceNumber: selected.device_number, room: selected.room, msgs: [], reports: [], last: 0, hasOpen: false }
      map.set(t.key, t)
    }
    t.reports = reports.filter((r) => r.device_id === selected.id)
    for (const r of t.reports) t.last = Math.max(t.last, ts(r.sent_at))
  }
  return [...map.values()].sort((a, b) => b.last - a.last)
}

function ThreadView({ thread: t, defaultOpen, onChanged }: { thread: Thread; defaultOpen: boolean; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(defaultOpen)
  const entries = useMemo(() => {
    const list: { at: number; msg?: Msg; rep?: Report }[] = [
      ...t.msgs.map((m) => ({ at: ts(m.created_at), msg: m })),
      ...t.reports.map((r) => ({ at: ts(r.sent_at), rep: r })),
    ]
    return list.sort((a, b) => a.at - b.at)
  }, [t])
  const openCount = t.msgs.filter((m) => m.open).length
  const escalated = t.msgs.some((m) => m.open && m.escalate)
  const accent = openCount ? (escalated ? 'var(--crit)' : 'var(--warn)') : 'var(--border)'
  const sensor = t.deviceNumber != null ? `sensor ${nr(t.deviceNumber)}${t.room ? ` · ${t.room}` : ''}` : 'onbekend adres'
  const count = [t.msgs.length ? `${t.msgs.length} bericht${t.msgs.length === 1 ? '' : 'en'}` : null, t.reports.length ? `${t.reports.length} rapport${t.reports.length === 1 ? '' : 'en'}` : null].filter(Boolean).join(' · ')

  return (
    <Card accent={accent} pad="var(--sp-3) var(--sp-4)">
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', width: '100%', textAlign: 'left', background: 'transparent', border: 0, padding: 0, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text)' }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{t.name || t.addr || 'geen contact'}</span>
            {openCount > 0 && (
              <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, padding: '1px 7px', borderRadius: 'var(--r-pill)', background: escalated ? 'var(--crit-fill)' : 'var(--warn-fill)', color: escalated ? 'var(--crit)' : 'var(--warn)' }}>
                {openCount} open{escalated ? ' · escalatie' : ''}
              </span>
            )}
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginTop: 2, overflowWrap: 'anywhere' }}>
            {sensor}{t.name && t.addr ? ` · ${t.addr}` : ''}{count ? ` · ${count}` : ''}{t.last ? ` · laatst ${fmtDate(new Date(t.last).toISOString())}` : ''}
          </div>
        </div>
        {expanded ? <ChevronUp size={16} style={{ color: 'var(--muted)', flexShrink: 0 }} /> : <ChevronDown size={16} style={{ color: 'var(--muted)', flexShrink: 0 }} />}
      </button>

      {expanded && (
        <div style={{ display: 'grid', gap: 'var(--sp-3)', marginTop: 'var(--sp-3)' }}>
          {entries.map((e) => (e.msg ? <MessageCard key={`m${e.msg.id}`} item={e.msg} onChanged={onChanged} /> : <ReportLine key={`r${e.rep!.id}`} report={e.rep!} />))}
        </div>
      )}
    </Card>
  )
}

function ReportLine({ report: r, showDevice }: { report: Report; showDevice?: boolean }) {
  const failed = r.status !== 'sent'
  const color = failed ? 'var(--crit)' : VERDICT_COLOR[r.verdict] ?? 'var(--muted)'
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-2)', padding: '6px 0', fontSize: 'var(--fs-xs)', color: 'var(--muted)', borderTop: showDevice ? '1px solid var(--border-soft)' : 0 }}>
      <FileText size={14} style={{ color, flexShrink: 0, marginTop: 1 }} />
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        {showDevice && <span style={{ fontWeight: 700, color: 'var(--text)' }}>{nr(r.device_number)}{r.contact_name ? ` ${r.contact_name}` : ''} · </span>}
        <span style={{ color: failed ? 'var(--crit)' : 'var(--text)', fontWeight: 600 }}>{reportKind(r.period_start, r.period_end)} {SEND_LABEL[r.status] ?? r.status}</span>
        {' · '}{fmtPeriod(r.period_start, r.period_end)}
        {' · '}<span style={{ color, fontWeight: 600 }}>{VERDICT_LABEL[r.verdict] ?? r.verdict}</span>
        {' · '}{r.trigger === 'manual' ? 'handmatig' : 'automatisch'}
        {' · '}{fmtDateTime(r.sent_at)}
      </span>
    </div>
  )
}

function MessageCard({ item: m, onChanged }: { item: Msg; onChanged: () => void }) {
  const open = m.open
  const [text, setText] = useState(m.reply ?? '')
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState<'send' | 'close' | 'reopen' | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  const body = m.body ?? ''
  const long = body.length > LONG_BODY
  const shownBody = long && !expanded ? body.slice(0, LONG_BODY).trimEnd() + '…' : body
  const failedStatus = m.status === 'error' || m.status === 'send_failed'
  const statusColor = failedStatus ? 'var(--crit)' : open ? 'var(--warn)' : 'var(--muted)'

  async function act(action: 'support_send' | 'support_close' | 'support_reopen') {
    setBusy(action === 'support_send' ? 'send' : action === 'support_close' ? 'close' : 'reopen')
    setNote(null)
    try {
      const payload = action === 'support_send' ? { action, id: m.id, text } : { action, id: m.id }
      const { status, data } = await post(payload)
      if (status === 400 && data?.error === 'empty') setNote({ ok: false, text: 'Het antwoord is leeg.' })
      else if (status === 403) setNote({ ok: false, text: 'Dit bericht hoort niet bij jouw organisatie.' })
      else if (!data?.ok) {
        setNote({ ok: false, text: action === 'support_send' ? 'Versturen is mislukt. Probeer het nog eens.' : action === 'support_close' ? 'Afhandelen is mislukt.' : 'Heropenen is mislukt.' })
        // Bij send_failed heeft de server de status al aangepast: label bijwerken, tekst blijft staan.
        if (status === 200) onChanged()
      } else {
        setNote({ ok: true, text: action === 'support_send' ? 'Verstuurd.' : action === 'support_close' ? 'Afgehandeld.' : 'Heropend.' })
        onChanged()
      }
    } catch {
      setNote({ ok: false, text: 'Geen verbinding met de server.' })
    } finally {
      setBusy(null)
    }
  }

  const noteRow = note && (
    <div role={note.ok ? 'status' : 'alert'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 'var(--sp-2)', fontSize: 'var(--fs-xs)', fontWeight: 600, color: note.ok ? 'var(--ok)' : 'var(--crit)' }}>
      {note.ok ? <Check size={13} /> : <AlertTriangle size={13} />} {note.text}
    </div>
  )

  return (
    <div style={{ background: open ? 'var(--surface)' : 'var(--surface-2)', border: '1px solid var(--border-soft)', borderRadius: 'var(--r-md)', padding: 'var(--sp-3)', opacity: open ? 1 : 0.85 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>{fmtDateTime(m.created_at)}</span>
        <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: statusColor, whiteSpace: 'nowrap' }}>{STATUS_LABEL[m.status] ?? m.status}</span>
      </div>
      <div style={{ fontWeight: 700, color: 'var(--text)', marginTop: 2, overflowWrap: 'anywhere' }}>{m.subject || '(geen onderwerp)'}</div>

      {body && (
        <div style={{ marginTop: 'var(--sp-2)', fontSize: 'var(--fs-sm)', color: 'var(--text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {shownBody}
          {long && (
            <button onClick={() => setExpanded((v) => !v)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 8, background: 'transparent', border: 0, padding: 0, color: 'var(--brand)', fontSize: 'var(--fs-xs)', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              {expanded ? <><ChevronUp size={12} /> minder</> : <><ChevronDown size={12} /> meer</>}
            </button>
          )}
        </div>
      )}

      {m.escalate == null ? (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 'var(--sp-2)', fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--muted)' }}>
          <Bot size={13} style={{ flexShrink: 0 }} /> nog geen oordeel van de assistent
        </div>
      ) : (
        <div style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 6, marginTop: 'var(--sp-2)', fontSize: 'var(--fs-xs)', fontWeight: 600, color: m.escalate ? 'var(--crit)' : 'var(--ok)', overflowWrap: 'anywhere' }}>
          {m.escalate ? <><AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} /> <span>escaleren{m.reason ? `: ${m.reason}` : ''}</span></> : <><Check size={13} style={{ flexShrink: 0, marginTop: 1 }} /> <span>kan automatisch{m.reason ? ` — ${m.reason}` : ''}</span></>}
        </div>
      )}

      {open && STATUS_NOTE[m.status] && (
        <div role={failedStatus ? 'alert' : undefined} style={{ marginTop: 'var(--sp-2)', fontSize: 'var(--fs-xs)', fontWeight: 600, color: failedStatus ? 'var(--crit)' : 'var(--muted)' }}>
          {STATUS_NOTE[m.status]}
        </div>
      )}

      {open ? (
        <>
          <label htmlFor={`reply-${m.id}`} style={{ display: 'block', marginTop: 'var(--sp-3)', fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--muted)' }}>
            {m.reply ? `Voorgesteld antwoord${m.model ? ` (${m.model})` : ''}` : 'Jouw antwoord'}
          </label>
          <textarea
            id={`reply-${m.id}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.min(14, Math.max(5, text.split('\n').length + 1))}
            placeholder="Schrijf hier je antwoord aan de bewoner…"
            style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '9px 12px', fontSize: 'var(--fs-sm)', lineHeight: 1.5, fontFamily: 'inherit', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface)', color: 'var(--text)', resize: 'vertical' }}
          />
          {noteRow}
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', marginTop: 'var(--sp-3)' }}>
            <Button size="sm" variant="primary" icon={<Send size={13} />} onClick={() => act('support_send')} disabled={busy != null || !text.trim()}>
              {busy === 'send' ? 'Bezig…' : 'Verstuur dit antwoord'}
            </Button>
            <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => act('support_close')} disabled={busy != null}>
              {busy === 'close' ? 'Bezig…' : 'Afgehandeld zonder antwoord'}
            </Button>
          </div>
        </>
      ) : m.status === 'answered' ? (
        <div style={{ marginTop: 'var(--sp-3)', borderLeft: '3px solid var(--ok)', paddingLeft: 'var(--sp-3)' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--muted)' }}>
            <Send size={12} /> Antwoord verstuurd{m.handled_at ? ` op ${fmtDateTime(m.handled_at)}` : ''}
          </div>
          <div style={{ marginTop: 4, fontSize: 'var(--fs-sm)', color: 'var(--text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.reply}</div>
          {noteRow}
        </div>
      ) : (
        <div style={{ marginTop: 'var(--sp-3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--muted)' }}>
              Afgehandeld zonder antwoord{m.handled_at ? ` op ${fmtDateTime(m.handled_at)}` : ''}
            </span>
            <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => act('support_reopen')} disabled={busy != null}>
              {busy === 'reopen' ? 'Bezig…' : 'Heropenen'}
            </Button>
          </div>
          {m.reply && (
            <details style={{ marginTop: 4 }}>
              <summary style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', cursor: 'pointer' }}>Voorstel dat niet is verstuurd</summary>
              <div style={{ marginTop: 4, fontSize: 'var(--fs-sm)', color: 'var(--text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.reply}</div>
            </details>
          )}
          {noteRow}
        </div>
      )}
    </div>
  )
}
