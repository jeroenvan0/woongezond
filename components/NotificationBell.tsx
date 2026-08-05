'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { withBase } from '@/lib/basePath'
import { createClient } from '@/lib/supabase/client'

interface Notif {
  id: string
  type: string
  message: string
  read: boolean
  created_at: string
  metadata: { severity?: string } | null
}

const DEFAULTS = {
  co2: { warning: 1000, critical: 1500 },
  humidity: { warning: 65, critical: 75 },
}

const METRICS: { key: 'co2' | 'humidity'; label: string; unit: string; color: string }[] = [
  { key: 'co2', label: 'CO₂', unit: 'ppm', color: '#3B82F6' },
  { key: 'humidity', label: 'Luchtvochtigheid', unit: '%', color: '#10B981' },
]

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'zojuist'
  if (m < 60) return `${m} min geleden`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} uur geleden`
  return `${Math.floor(h / 24)} dag(en) geleden`
}

/**
 * Where the panel flies out from. This component renders in two very different
 * places and a single set of coordinates cannot serve both:
 *
 *   'side' — the desktop sidebar footer, bottom-LEFT of the viewport. The panel must
 *            open rightwards out of the rail and upwards from the button.
 *   'top'  — the mobile top bar, top-RIGHT. The panel opens downwards and leftwards.
 *
 * Before this was a prop, both used the 'top' coordinates, so on desktop the panel
 * was positioned 263px off the left edge of the screen and 61px below the fold —
 * only 57px of a 320px panel was visible. See docs/known-issues.md KI-2.
 */
type Placement = 'side' | 'top'

export default function NotificationBell({ placement = 'top' }: { placement?: Placement }) {
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [notifs, setNotifs] = useState<Notif[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [thresholds, setThresholds] = useState(DEFAULTS)
  const [saveMsg, setSaveMsg] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  // Viewport coordinates for the 'top' placement, measured when the panel opens.
  const [topCoords, setTopCoords] = useState<{ top: number; right: number } | null>(null)

  const unread = notifs.filter((n) => !n.read).length

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)
    const { data } = await supabase
      .from('notifications')
      .select('id,type,message,read,created_at,metadata')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)
    setNotifs((data as Notif[]) ?? [])

    const { data: thr } = await supabase
      .from('thresholds')
      .select('metric,warning_value,critical_value')
      .eq('user_id', user.id)
    if (thr?.length) {
      setThresholds((prev) => {
        const next = { co2: { ...prev.co2 }, humidity: { ...prev.humidity } }
        for (const r of thr) {
          const m = r.metric as 'co2' | 'humidity'
          if (next[m]) {
            if (r.warning_value != null) next[m].warning = +r.warning_value
            if (r.critical_value != null) next[m].critical = +r.critical_value
          }
        }
        return next
      })
    }
  }, [supabase])

  // Initial load + run threshold check + poll
  useEffect(() => {
    load()
    fetch(withBase('/api/notifications/check'), { method: 'POST' })
      .then(() => load())
      .catch(() => {})
    const id = setInterval(() => {
      fetch(withBase('/api/notifications/check'), { method: 'POST' })
        .then(() => load())
        .catch(() => {})
    }, 120000)
    return () => clearInterval(id)
  }, [load])

  // Close on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  // In the top bar the bell is not the last item — the theme and logout buttons sit
  // to its right — so anchoring the panel to the button's right edge pushed 320px of
  // panel off the left of a 390px phone. Pin it to the viewport instead, which is the
  // only frame of reference that guarantees it stays on screen.
  useEffect(() => {
    if (!open || placement !== 'top') return
    const measure = () => {
      const r = btnRef.current?.getBoundingClientRect()
      if (r) setTopCoords({ top: r.bottom + 8, right: 12 })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open, placement])

  // Close on Escape — the panel can cover most of a phone screen.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  async function markAll() {
    if (!userId) return
    await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false)
    setNotifs((ns) => ns.map((n) => ({ ...n, read: true })))
  }

  async function markRead(id: string) {
    await supabase.from('notifications').update({ read: true }).eq('id', id)
    setNotifs((ns) => ns.map((n) => (n.id === id ? { ...n, read: true } : n)))
  }

  async function saveThresholds() {
    if (!userId) return
    for (const m of METRICS) {
      const t = thresholds[m.key]
      const { data: existing } = await supabase
        .from('thresholds')
        .select('id')
        .eq('user_id', userId)
        .eq('metric', m.key)
        .limit(1)
      const payload = { user_id: userId, metric: m.key, warning_value: t.warning, critical_value: t.critical }
      if (existing?.length) await supabase.from('thresholds').update(payload).eq('id', existing[0].id)
      else await supabase.from('thresholds').insert(payload)
    }
    setSaveMsg('Opgeslagen ✓')
    setTimeout(() => setSaveMsg(''), 2500)
  }

  const sevColor = (n: Notif) =>
    n.metadata?.severity === 'critical' ? '#DC2626' : n.metadata?.severity === 'warning' ? '#D97706' : '#3B82F6'

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        title="Meldingen"
        aria-expanded={open}
        style={{
          padding: '6px 10px',
          fontSize: 15,
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--surface)',
          cursor: 'pointer',
          position: 'relative',
          lineHeight: 1,
        }}
      >
        🔔
        {unread > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -5,
              right: -5,
              background: '#DC2626',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              minWidth: 16,
              height: 16,
              borderRadius: 99,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
            }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            // 'side': the rail is a fixed 230px (74px collapsed) at the left edge, so
            // flying out rightwards and upwards from the button is always on screen and
            // absolute positioning is enough.
            // 'top': pinned to the viewport, because the button's own right edge is not
            // the screen's right edge.
            ...(placement === 'side'
              ? { position: 'absolute' as const, bottom: 0, left: 'calc(100% + 8px)' }
              : {
                  position: 'fixed' as const,
                  top: topCoords?.top ?? 56,
                  right: topCoords?.right ?? 12,
                }),
            // Never wider than the viewport on a narrow phone, and never taller than
            // the space actually available — the settings section used to sit below
            // the fold. 'side' grows upward from a button near the bottom of the
            // screen, so its ceiling is the room above that button; 'top' grows
            // downward from just under the header.
            width: 'min(320px, calc(100vw - 24px))',
            maxHeight: placement === 'side' ? 'min(460px, calc(100vh - 120px))' : 'min(460px, calc(100vh - 90px))',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            boxShadow: 'var(--shadow-lg)',
            zIndex: 1000,
            padding: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>Meldingen</span>
            {unread > 0 && (
              <button
                onClick={markAll}
                style={{ background: 'none', border: 'none', color: '#3B82F6', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
              >
                Alles gelezen
              </button>
            )}
          </div>

          {notifs.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: '16px 4px', textAlign: 'center' }}>
              Geen meldingen. Alles ziet er goed uit. ✓
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {notifs.map((n) => (
                <div
                  key={n.id}
                  onClick={() => !n.read && markRead(n.id)}
                  style={{
                    display: 'flex',
                    gap: 9,
                    padding: '9px 10px',
                    borderRadius: 9,
                    background: n.read ? 'transparent' : `${sevColor(n)}0f`,
                    border: `1px solid ${n.read ? 'var(--border-soft)' : sevColor(n) + '33'}`,
                    cursor: n.read ? 'default' : 'pointer',
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: sevColor(n), marginTop: 5, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.4 }}>{n.message}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--subtle)', marginTop: 2 }}>{timeAgo(n.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Threshold settings */}
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 8 }}>
            <button
              onClick={() => setShowSettings((s) => !s)}
              style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}
            >
              {showSettings ? '▴' : '⚙'}  Drempelwaarden
            </button>
            {showSettings && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {METRICS.map((m) => (
                  <div key={m.key}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: m.color, marginBottom: 5 }}>
                      {m.label} ({m.unit})
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {(['warning', 'critical'] as const).map((lvl) => (
                        <label key={lvl} style={{ flex: 1, fontSize: 10.5, color: 'var(--muted)' }}>
                          {lvl === 'warning' ? 'Attentie' : 'Kritiek'}
                          <input
                            type="number"
                            value={thresholds[m.key][lvl]}
                            onChange={(e) =>
                              setThresholds((prev) => ({
                                ...prev,
                                [m.key]: { ...prev[m.key], [lvl]: +e.target.value },
                              }))
                            }
                            style={{
                              width: '100%',
                              marginTop: 3,
                              padding: '5px 7px',
                              border: '1px solid var(--border)',
                              borderRadius: 6,
                              background: 'var(--surface-2)',
                              color: 'var(--text)',
                              fontSize: 12,
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    onClick={saveThresholds}
                    style={{ padding: '7px 14px', background: '#3B82F6', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Opslaan
                  </button>
                  {saveMsg && <span style={{ fontSize: 11.5, color: '#16A34A', fontWeight: 600 }}>{saveMsg}</span>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
