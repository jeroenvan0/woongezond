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
import { Skeleton } from '@/components/ui/Skeleton'
import { withBase } from '@/lib/basePath'
import { ShieldAlert, AlertTriangle, Check, X, Send, FileText, RotateCcw, Search, Bot, RefreshCw, Hand, Inbox } from 'lucide-react'

// Inbox van de klantenservice voor org-ADMINS (docs/support-assistant.md, "Volgende stap").
// Eén Outlook-achtige lijst: één regel per mail, nieuwste bovenaan, klik = uitklappen in
// de lijst. Leest /api/cockpit/inbox; acties gaan via POST /api/cockpit
// (support_send / support_hold / support_close / support_reopen).

type MsgStatus = 'received' | 'draft' | 'scheduled' | 'stored' | 'error' | 'send_failed' | 'answered' | 'closed'
type Verdict = 'ok' | 'warning' | 'critical' | 'nodata'
type StatusFilter = 'open' | 'done' | 'all'
type SupportMode = 'draft' | 'delayed' | 'auto' | 'off'
type Action = 'support_send' | 'support_hold' | 'support_close' | 'support_reopen'
/** 'all' · 'unknown' (mails zonder sensor, client-side) · een device-uuid. */
type DeviceSel = string

interface Org { id: string; name: string }
interface Device { id: string; device_number: number | null; room: string | null; contact_name: string | null; contact_email: string | null; active: boolean }
interface Msg {
  id: number
  created_at: string
  handled_at: string | null
  send_at: string | null
  from_addr: string
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
interface Report { id: number; device_id: string; device_number: number | null; sent_at: string; period_start: string; period_end: string; verdict: Verdict; status: string; trigger: string }
interface Counts { open: number; escalated: number; total: number; per_device: Record<string, { open: number; total: number }> }
interface Payload { orgs: Org[]; org: Org | null; devices: Device[]; messages: Msg[]; reports: Report[]; counts: Counts; support_mode: string }
interface Note { ok: boolean; text: string }

const UUID_RE = /^[0-9a-f-]{36}$/i
const TZ = 'Europe/Amsterdam'
const PREVIEW_LEN = 80
const REFRESH_MS = 60_000
const REPORTS_MAX = 15
const STATUS_OPTIONS: { label: string; value: StatusFilter }[] = [{ label: 'Open', value: 'open' }, { label: 'Afgehandeld', value: 'done' }, { label: 'Alles', value: 'all' }]
const MODE_TEXT: Record<SupportMode, string> = { draft: 'voorstellen wachten op jou', delayed: 'gaat na 2 uur automatisch', auto: 'assistent antwoordt direct', off: 'alleen opslaan' }
const VERDICT_LABEL: Record<Verdict, string> = { ok: 'In orde', warning: 'Aandachtspunten', critical: 'Actie', nodata: 'Geen metingen' }
const VERDICT_COLOR: Record<Verdict, string> = { ok: 'var(--ok)', warning: 'var(--warn)', critical: 'var(--crit)', nodata: 'var(--muted)' }
const OPEN_NOTE: Partial<Record<MsgStatus, { text: string; bad: boolean }>> = {
  error: { text: 'De assistent kon niet antwoorden. Schrijf zelf een antwoord of handel de vraag af.', bad: true },
  send_failed: { text: 'Versturen is mislukt. Probeer het nog eens.', bad: true },
  stored: { text: 'Alleen opgeslagen (stand off): de bewoner heeft nog niets gekregen.', bad: false },
  received: { text: 'Nog geen voorstel van de assistent.', bad: false },
}

// ── Tijd (Europe/Amsterdam) ──────────────────────────────────────────────────

const dayKey = (d: Date) => d.toLocaleDateString('nl-NL', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
const yearOf = (d: Date) => d.toLocaleDateString('nl-NL', { timeZone: TZ, year: 'numeric' })
const fmtTime = (s: string) => new Date(s).toLocaleTimeString('nl-NL', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
/** "3 sep" of, in een ander jaar, "3 sep 2025". */
function fmtDay(s: string, now = new Date()): string {
  const d = new Date(s)
  return d.toLocaleDateString('nl-NL', { timeZone: TZ, day: 'numeric', month: 'short', ...(yearOf(d) === yearOf(now) ? {} : { year: 'numeric' }) }).replace(/\./g, '')
}
/** Vandaag "14:31", anders "3 sep" / "3 sep 2025". */
const fmtWhen = (s: string, now = new Date()) => (dayKey(new Date(s)) === dayKey(now) ? fmtTime(s) : fmtDay(s, now))
/** Vandaag "om 16:31", anders "7 sep 08:00". */
const fmtMoment = (s: string, now = new Date()) => (dayKey(new Date(s)) === dayKey(now) ? `om ${fmtTime(s)}` : `${fmtDay(s, now)} ${fmtTime(s)}`)
const fmtDateTime = (s: string) => `${fmtDay(s)} ${fmtTime(s)}`
const ts = (s: string | null) => (s ? new Date(s).getTime() : 0)

const ymd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
function fmtPeriod(start: string, end: string): string {
  const a = ymd(start), b = ymd(end)
  const short = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('nl-NL', o).replace(/\./g, '')
  if (a.getTime() === b.getTime()) return short(a, { day: 'numeric', month: 'short' })
  return `${short(a, a.getMonth() === b.getMonth() ? { day: 'numeric' } : { day: 'numeric', month: 'short' })} – ${short(b, { day: 'numeric', month: 'short' })}`
}
function reportKind(start: string, end: string): string {
  const days = Math.round((ymd(end).getTime() - ymd(start).getTime()) / 86400000) + 1
  return days <= 1 ? 'Dagrapport' : days <= 8 ? 'Weekrapport' : 'Maandrapport'
}

// ── Weergave per bericht ─────────────────────────────────────────────────────

const nr = (n: number | null) => (n == null ? '—' : String(n).padStart(2, '0'))
const sensorLabel = (m: { device_id: string | null; device_number: number | null; room: string | null }) => (m.device_id ? `sensor ${nr(m.device_number)}${m.room ? ` · ${m.room}` : ''}` : 'onbekend')
const who = (m: Msg) => m.contact_name || m.from_addr
const preview = (body: string | null) => { const t = (body ?? '').replace(/\s+/g, ' ').trim(); return t.length > PREVIEW_LEN ? t.slice(0, PREVIEW_LEN).trimEnd() + '…' : t }
const failed = (m: Msg) => m.status === 'error' || m.status === 'send_failed'

/** Status-icoon links in de regel. */
function glyph(m: Msg): { char: string; color: string; label: string } {
  if (failed(m)) return { char: '!', color: 'var(--crit)', label: 'fout' }
  if (m.open && m.escalate) return { char: '⚠', color: 'var(--crit)', label: 'escalatie' }
  if (m.status === 'scheduled') return { char: '⏳', color: 'var(--warn)', label: 'gepland' }
  if (m.open) return { char: '●', color: 'var(--brand)', label: 'open' }
  if (m.status === 'answered') return { char: '✓', color: 'var(--ok)', label: 'beantwoord' }
  return { char: '✕', color: 'var(--muted)', label: 'afgehandeld' }
}

/** De stand rechts in de regel. */
function stand(m: Msg, now: Date): { text: string; color: string } {
  if (m.status === 'send_failed') return { text: 'versturen mislukt', color: 'var(--crit)' }
  if (m.status === 'error') return { text: 'fout', color: 'var(--crit)' }
  if (m.open && m.escalate) return { text: 'escalatie', color: 'var(--crit)' }
  if (m.status === 'scheduled' && m.send_at) return { text: `gaat ${fmtMoment(m.send_at, now)} automatisch`, color: 'var(--warn)' }
  if (m.open) return { text: 'wacht op jou', color: 'var(--text)' }
  if (m.status === 'answered') return { text: `beantwoord${m.handled_at ? ` ${fmtWhen(m.handled_at, now)}` : ''}`, color: 'var(--ok)' }
  return { text: 'afgehandeld', color: 'var(--muted)' }
}

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
    <Suspense fallback={<AppShell title="Inbox"><ListSkeleton /></AppShell>}>
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
  const [refreshing, setRefreshing] = useState(false)
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState<DataError>(null)
  // Uitgeklapte regel: nooit vanzelf — alleen door klikken of via ?open=<id>.
  const [openId, setOpenId] = useState<number | null>(() => { const n = Number(params.get('open')); return Number.isInteger(n) && n > 0 ? n : null })
  // Antwoordtekst per bericht-id, zodat verversen niets weggooit.
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState<{ id: number; action: Action } | null>(null)
  const [flash, setFlash] = useState<(Note & { id: number }) | null>(null)
  // Eerdere mails van hetzelfde adres (ook buiten het huidige filter), per adres.
  const [history, setHistory] = useState<Record<string, Msg[]>>({})
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

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const my = ++seq.current
    if (!opts?.silent) setRefreshing(true)
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
      if (my === seq.current) { setLoading(false); setRefreshing(false) }
    }
  }, [orgId, device, status, q, router])

  useEffect(() => { load() }, [load])

  // Elke 60 s stil verversen, alleen als het tabblad zichtbaar is; en meteen bij terugkeer.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') load({ silent: true }) }
    const t = setInterval(tick, REFRESH_MS)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick) }
  }, [load])

  // Flash-melding na een actie verdwijnt vanzelf.
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 8000)
    return () => clearTimeout(t)
  }, [flash])

  const syncUrl = useCallback((dev: DeviceSel, open: number | null) => {
    const sp = new URLSearchParams()
    if (dev !== 'all') sp.set('device', dev)
    if (open != null) sp.set('open', String(open))
    const qs = sp.toString()
    router.replace(qs ? `/cockpit/inbox?${qs}` : '/cockpit/inbox', { scroll: false })
  }, [router])

  function pickDevice(id: DeviceSel) {
    if (id === device) return
    setDevice(id)
    syncUrl(id, openId)
  }
  function pickOrg(id: string) {
    setOrgId(id)
    setDevice('all')
    setOpenId(null)
    syncUrl('all', null)
  }
  function toggleOpen(id: number) {
    const next = openId === id ? null : id
    setOpenId(next)
    syncUrl(device, next)
  }

  const devices = data?.devices ?? []
  const orgs = data?.orgs ?? []
  const org = data?.org ?? null
  const counts = data?.counts ?? { open: 0, escalated: 0, total: 0, per_device: {} }
  const mode: SupportMode = data?.support_mode === 'auto' || data?.support_mode === 'off' || data?.support_mode === 'delayed' ? data.support_mode : 'draft'
  const roomOf = useMemo(() => new Map(devices.map((d) => [d.id, d.room])), [devices])
  const messages = useMemo(() => {
    const all = data?.messages ?? []
    const list = device === 'unknown' ? all.filter((m) => !m.device_id) : all
    return [...list].sort((a, b) => ts(b.created_at) - ts(a.created_at))
  }, [data, device])
  const reports = useMemo(() => {
    const all = data?.reports ?? []
    const list = UUID_RE.test(device) ? all.filter((r) => r.device_id === device) : device === 'unknown' ? [] : all
    return [...list].sort((a, b) => ts(b.sent_at) - ts(a.sent_at)).slice(0, REPORTS_MAX)
  }, [data, device])
  const openMsg = useMemo(() => messages.find((m) => m.id === openId) ?? null, [messages, openId])

  // Eerdere mails van dezelfde bewoner: het huidige filter laat afgehandelde mails vaak niet
  // zien, dus bij uitklappen halen we het hele adres eenmalig op (q zoekt ook in from_addr).
  useEffect(() => {
    if (!openMsg) return
    const addr = openMsg.from_addr.toLowerCase()
    if (history[addr]) return
    let alive = true
    fetchInbox({ org: orgId, device: null, status: 'all', q: openMsg.from_addr }).then(({ data: d }) => {
      if (!alive) return
      const same = (d?.messages ?? []).filter((m) => m.from_addr.toLowerCase() === addr)
      setHistory((h) => ({ ...h, [addr]: same }))
    }).catch(() => { /* alleen de lijst zelf blijft dan over */ })
    return () => { alive = false }
  }, [openMsg, orgId, history])

  function priorOf(m: Msg): Msg[] {
    const addr = m.from_addr.toLowerCase()
    const byId = new Map<number, Msg>()
    for (const x of [...(history[addr] ?? []), ...messages]) if (x.from_addr.toLowerCase() === addr && x.id !== m.id) byId.set(x.id, x)
    return [...byId.values()].sort((a, b) => ts(b.created_at) - ts(a.created_at))
  }
  function jumpTo(target: Msg) {
    if (!messages.some((m) => m.id === target.id)) {
      setStatus('all')
      if (device === 'unknown' && target.device_id) setDevice('all')
    }
    setOpenId(target.id)
    syncUrl(device, target.id)
  }

  async function act(m: Msg, action: Action) {
    setBusy({ id: m.id, action })
    setFlash(null)
    const text = drafts[m.id] ?? m.reply ?? ''
    const labels: Record<Action, [string, string]> = {
      support_send: [`Verstuurd naar ${who(m)}.`, 'Versturen is mislukt. Probeer het nog eens.'],
      support_hold: ['Tegengehouden; het voorstel wacht nu op jou.', 'Tegenhouden is mislukt.'],
      support_close: ['Afgehandeld zonder antwoord.', 'Afhandelen is mislukt.'],
      support_reopen: ['Heropend.', 'Heropenen is mislukt.'],
    }
    try {
      const { status: code, data: d } = await post(action === 'support_send' ? { action, id: m.id, text } : { action, id: m.id })
      if (code === 400 && d?.error === 'empty') setFlash({ id: m.id, ok: false, text: 'Het antwoord is leeg.' })
      else if (code === 401) { router.push('/login'); return }
      else if (code === 403) setFlash({ id: m.id, ok: false, text: 'Dit bericht hoort niet bij jouw organisatie.' })
      else if (!d?.ok) setFlash({ id: m.id, ok: false, text: labels[action][1] })
      else {
        setFlash({ id: m.id, ok: true, text: labels[action][0] })
        if (action === 'support_send') setDrafts((x) => { const { [m.id]: _gone, ...rest } = x; return rest })
      }
      // Ook na een mislukte verzending is de status server-side veranderd (send_failed).
      setHistory((h) => { const { [m.from_addr.toLowerCase()]: _gone, ...rest } = h; return rest })
      await load({ silent: true })
    } catch {
      setFlash({ id: m.id, ok: false, text: 'Geen verbinding met de server.' })
    } finally {
      setBusy(null)
    }
  }

  const now = new Date()
  const empty = q || status !== 'open' ? 'Niets gevonden.' : 'Geen open vragen. Mooi zo.'
  const inputStyle: React.CSSProperties = { boxSizing: 'border-box', fontSize: 'var(--fs-sm)', fontFamily: 'inherit', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface)', color: 'var(--text)' }

  return (
    <AppShell title="Inbox">
      {error && <DataBanner error={error} onRetry={() => load()} />}

      {forbidden && (
        <Card style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
          <ShieldAlert style={{ color: 'var(--muted)', flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Alleen voor beheerders van de pilot</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>De inbox toont mails en contactgegevens van bewoners en is daarom alleen voor beheerders.</div>
          </div>
        </Card>
      )}

      {!forbidden && (
        <>
          {orgs.length > 1 && org && (
            <div style={{ marginBottom: 'var(--sp-3)' }}>
              <SegmentedControl ariaLabel="Kies organisatie" value={org.id} onChange={(v) => pickOrg(String(v))} options={orgs.map((o) => ({ label: o.name, value: o.id }))} />
            </div>
          )}

          {/* Balk: filter, zoeken, sensor · tellers, stand, vernieuwen. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap', marginBottom: 'var(--sp-3)' }}>
            <SegmentedControl ariaLabel="Welke berichten" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
            <label style={{ position: 'relative', flex: '1 1 180px', minWidth: 0 }}>
              <span className="wz-sr-only">Zoeken in berichten</span>
              <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
              <input type="search" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Zoek op onderwerp, tekst of adres" style={{ ...inputStyle, width: '100%', padding: '8px 12px 8px 32px' }} />
            </label>
            <select aria-label="Welke sensor" value={device} onChange={(e) => pickDevice(e.target.value)} style={{ ...inputStyle, padding: '8px 10px', maxWidth: '100%', flex: '0 1 auto', minWidth: 0 }}>
              <option value="all">Alle sensoren</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>{nr(d.device_number)} · {d.room ?? 'kamer onbekend'} · {d.contact_name ?? 'geen contact'}{d.active ? '' : ' (uit)'}</option>
              ))}
              <option value="unknown">Onbekend adres</option>
            </select>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)', marginLeft: 'auto', fontSize: 'var(--fs-xs)', color: 'var(--muted)', flexWrap: 'wrap', minWidth: 0 }}>
              <span>
                <b style={{ color: counts.open ? 'var(--text)' : 'var(--muted)' }}>{counts.open} open</b>
                {' · '}
                <b style={{ color: counts.escalated ? 'var(--crit)' : 'var(--muted)' }}>{counts.escalated} escalatie{counts.escalated === 1 ? '' : 's'}</b>
                {' · '}
                <span title={`stand ${mode}`}><Bot size={12} style={{ verticalAlign: -2 }} /> {MODE_TEXT[mode]}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => load()} disabled={refreshing} icon={<RefreshCw size={13} className={refreshing ? 'wz-spin' : undefined} />} aria-label="Vernieuwen">Vernieuwen</Button>
            </span>
          </div>

          {flash && (
            <div role={flash.ok ? 'status' : 'alert'} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 'var(--sp-3)', fontSize: 'var(--fs-sm)', fontWeight: 600, color: flash.ok ? 'var(--ok)' : 'var(--crit)' }}>
              {flash.ok ? <Check size={14} /> : <AlertTriangle size={14} />} {flash.text}
            </div>
          )}

          {/* De lijst. */}
          {loading ? (
            <ListSkeleton />
          ) : messages.length === 0 ? (
            <Card style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
              <Inbox style={{ color: 'var(--muted)', flexShrink: 0 }} />
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>{empty}</div>
            </Card>
          ) : (
            <Card pad={0} style={{ overflow: 'hidden' }}>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {messages.map((m) => {
                  const expanded = m.id === openId
                  return (
                    <li key={m.id} style={{ borderTop: '1px solid var(--border-soft)' }}>
                      <Row m={m} now={now} expanded={expanded} onClick={() => toggleOpen(m.id)} />
                      {expanded && (
                        <Expanded
                          m={m}
                          now={now}
                          text={drafts[m.id] ?? m.reply ?? ''}
                          onText={(v) => setDrafts((x) => ({ ...x, [m.id]: v }))}
                          busy={busy?.id === m.id ? busy.action : null}
                          note={flash?.id === m.id ? flash : null}
                          prior={priorOf(m)}
                          onAct={(a) => act(m, a)}
                          onJump={jumpTo}
                        />
                      )}
                    </li>
                  )
                })}
              </ul>
            </Card>
          )}

          {/* Rapporten. */}
          {!loading && reports.length > 0 && (
            <div style={{ marginTop: 'var(--sp-5)' }}>
              <SectionHeading>Verstuurde rapporten</SectionHeading>
              <Card pad="var(--sp-1) var(--sp-3)">
                {reports.map((r) => {
                  const bad = r.status !== 'sent'
                  const color = bad ? 'var(--crit)' : VERDICT_COLOR[r.verdict] ?? 'var(--muted)'
                  return (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-2)', padding: '6px 0', fontSize: 'var(--fs-xs)', color: 'var(--muted)', borderTop: '1px solid var(--border-soft)' }}>
                      <FileText size={14} style={{ color, flexShrink: 0, marginTop: 1 }} />
                      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                        <span style={{ color: 'var(--text)' }}>{fmtDay(r.sent_at, now)}</span>
                        {' · '}sensor {nr(r.device_number)}{roomOf.get(r.device_id) ? ` · ${roomOf.get(r.device_id)}` : ''}
                        {' · '}<span style={{ color: bad ? 'var(--crit)' : 'var(--text)', fontWeight: 600 }}>{reportKind(r.period_start, r.period_end)} {fmtPeriod(r.period_start, r.period_end)}</span>
                        {' · '}<span style={{ color, fontWeight: 600 }}>{bad ? 'versturen mislukt' : VERDICT_LABEL[r.verdict] ?? r.verdict}</span>
                        {' · '}{r.trigger === 'manual' ? 'handmatig' : 'automatisch'}
                      </span>
                    </div>
                  )
                })}
              </Card>
            </div>
          )}
        </>
      )}
    </AppShell>
  )
}

function ListSkeleton() {
  return (
    <Card pad={0} style={{ overflow: 'hidden' }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', padding: '12px 14px', borderTop: i ? '1px solid var(--border-soft)' : 0 }}>
          <Skeleton w={10} h={10} r={5} />
          <Skeleton w={140} h={10} />
          <Skeleton w="40%" h={10} />
          <Skeleton w={40} h={10} style={{ marginLeft: 'auto' }} />
        </div>
      ))}
    </Card>
  )
}

// ── Eén regel ────────────────────────────────────────────────────────────────

function Row({ m, now, expanded, onClick }: { m: Msg; now: Date; expanded: boolean; onClick: () => void }) {
  const g = glyph(m)
  const s = stand(m, now)
  const summary = preview(m.body)
  return (
    <button
      type="button"
      className="wz-inbox-row"
      onClick={onClick}
      aria-expanded={expanded}
      aria-controls={`inbox-msg-${m.id}`}
      style={{ width: '100%', textAlign: 'left', background: expanded ? 'var(--surface-2)' : 'transparent', border: 0, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text)', opacity: m.open ? 1 : 0.7 }}
    >
      <span aria-label={g.label} title={g.label} style={{ gridArea: 'icon', color: g.color, fontSize: 'var(--fs-md)', lineHeight: 1, textAlign: 'center' }}>{g.char}</span>
      <span style={{ gridArea: 'who', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--fs-sm)' }}>
        <span style={{ fontWeight: m.open ? 700 : 600 }}>{who(m)}</span>
        <span style={{ color: 'var(--muted)', fontSize: 'var(--fs-xs)' }}> · {sensorLabel(m)}</span>
      </span>
      <span style={{ gridArea: 'subj', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--fs-sm)' }}>
        <span style={{ fontWeight: 700 }}>{m.subject || '(geen onderwerp)'}</span>
        {summary && <span style={{ color: 'var(--muted)' }}> — {summary}</span>}
      </span>
      <span style={{ gridArea: 'when', fontSize: 'var(--fs-xs)', color: 'var(--muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{fmtWhen(m.created_at, now)}</span>
      <span style={{ gridArea: 'stand', fontSize: 'var(--fs-xs)', fontWeight: 600, color: s.color, whiteSpace: 'nowrap', textAlign: 'right' }}>{s.text}</span>
    </button>
  )
}

// ── Uitgeklapt ───────────────────────────────────────────────────────────────

interface ExpandedProps {
  m: Msg
  now: Date
  text: string
  onText: (v: string) => void
  busy: Action | null
  note: Note | null
  prior: Msg[]
  onAct: (a: Action) => void
  onJump: (m: Msg) => void
}

function Expanded({ m, now, text, onText, busy, note, prior, onAct, onJump }: ExpandedProps) {
  const openNote = m.open ? OPEN_NOTE[m.status] : undefined
  const small: React.CSSProperties = { fontSize: 'var(--fs-xs)', fontWeight: 600 }
  const noteRow = note && (
    <div role={note.ok ? 'status' : 'alert'} style={{ ...small, display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 'var(--sp-2)', color: note.ok ? 'var(--ok)' : 'var(--crit)' }}>
      {note.ok ? <Check size={13} /> : <AlertTriangle size={13} />} {note.text}
    </div>
  )

  return (
    <div id={`inbox-msg-${m.id}`} style={{ padding: '0 var(--sp-4) var(--sp-4)', background: 'var(--surface-2)', borderTop: '1px solid var(--border-soft)' }}>
      <div style={{ ...small, color: 'var(--muted)', padding: 'var(--sp-3) 0 var(--sp-2)', overflowWrap: 'anywhere' }}>
        {who(m)}{m.contact_name ? ` · ${m.from_addr}` : ''} · {sensorLabel(m)} · {fmtDateTime(m.created_at)}
      </div>

      {/* De vraag. */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border-soft)', borderRadius: 'var(--r-md)', padding: 'var(--sp-3)', fontSize: 'var(--fs-sm)', color: 'var(--text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {m.body || <span style={{ color: 'var(--muted)' }}>(lege mail)</span>}
      </div>

      {/* Oordeel van de assistent. */}
      <div style={{ ...small, display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 'var(--sp-2)', color: m.escalate == null ? 'var(--muted)' : m.escalate ? 'var(--crit)' : 'var(--ok)', overflowWrap: 'anywhere' }}>
        {m.escalate == null ? <><Bot size={13} style={{ flexShrink: 0, marginTop: 1 }} /> <span>nog geen oordeel van de assistent</span></>
          : m.escalate ? <><AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} /> <span>escalatie{m.reason ? `: ${m.reason}` : ''}</span></>
          : <><Check size={13} style={{ flexShrink: 0, marginTop: 1 }} /> <span>kan automatisch{m.reason ? ` — ${m.reason}` : ''}</span></>}
      </div>

      {/* Het antwoordblok. */}
      {m.open ? (
        <div style={{ marginTop: 'var(--sp-3)' }}>
          {m.status === 'scheduled' && m.send_at && (
            <div style={{ ...small, color: 'var(--warn)', marginBottom: 'var(--sp-2)' }}>⏳ Gaat {fmtMoment(m.send_at, now)} automatisch, tenzij je ingrijpt.</div>
          )}
          {openNote && <div role={openNote.bad ? 'alert' : undefined} style={{ ...small, color: openNote.bad ? 'var(--crit)' : 'var(--muted)', marginBottom: 'var(--sp-2)' }}>{openNote.text}</div>}
          <label htmlFor={`reply-${m.id}`} style={{ ...small, display: 'block', color: 'var(--muted)' }}>
            {m.reply ? `Voorgesteld antwoord${m.model ? ` (${m.model})` : ''}` : 'Jouw antwoord'}
          </label>
          <textarea
            id={`reply-${m.id}`}
            value={text}
            onChange={(e) => onText(e.target.value)}
            rows={Math.min(14, Math.max(4, text.split('\n').length + 1))}
            placeholder="Schrijf hier je antwoord aan de bewoner…"
            style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '9px 12px', fontSize: 'var(--fs-sm)', lineHeight: 1.5, fontFamily: 'inherit', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface)', color: 'var(--text)', resize: 'vertical' }}
          />
          {noteRow}
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', marginTop: 'var(--sp-3)' }}>
            <Button size="sm" variant="primary" icon={<Send size={13} />} onClick={() => onAct('support_send')} disabled={busy != null || !text.trim()}>
              {busy === 'support_send' ? 'Bezig…' : 'Verstuur nu'}
            </Button>
            {m.status === 'scheduled' && (
              <Button size="sm" icon={<Hand size={13} />} onClick={() => onAct('support_hold')} disabled={busy != null}>
                {busy === 'support_hold' ? 'Bezig…' : 'Tegenhouden'}
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => onAct('support_close')} disabled={busy != null}>
              {busy === 'support_close' ? 'Bezig…' : 'Afgehandeld zonder antwoord'}
            </Button>
          </div>
        </div>
      ) : m.status === 'answered' ? (
        <div style={{ marginTop: 'var(--sp-3)', borderLeft: '3px solid var(--ok)', paddingLeft: 'var(--sp-3)' }}>
          <div style={{ ...small, display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--muted)' }}>
            <Send size={12} /> verstuurd{m.handled_at ? ` op ${fmtDateTime(m.handled_at)}` : ''}
          </div>
          <div style={{ marginTop: 4, fontSize: 'var(--fs-sm)', color: 'var(--text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.reply}</div>
          {noteRow}
        </div>
      ) : (
        <div style={{ marginTop: 'var(--sp-3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <span style={{ ...small, color: 'var(--muted)' }}>afgehandeld zonder antwoord{m.handled_at ? ` op ${fmtDateTime(m.handled_at)}` : ''}</span>
            <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => onAct('support_reopen')} disabled={busy != null}>
              {busy === 'support_reopen' ? 'Bezig…' : 'Heropenen'}
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

      {/* Eerder van deze bewoner. */}
      {prior.length > 0 && (
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <div style={{ ...small, color: 'var(--muted)', marginBottom: 4 }}>Eerder van deze bewoner</div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
            {prior.map((p) => {
              const s = stand(p, now)
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onJump(p)}
                    style={{ display: 'flex', gap: 6, alignItems: 'baseline', width: '100%', minWidth: 0, textAlign: 'left', background: 'transparent', border: 0, padding: '2px 0', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}
                  >
                    <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtDay(p.created_at, now)}</span>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>{p.subject || '(geen onderwerp)'}</span>
                    <span style={{ whiteSpace: 'nowrap', marginLeft: 'auto', color: s.color === 'var(--text)' ? 'var(--muted)' : s.color }}>{s.text}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
