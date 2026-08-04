'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { withBase } from '@/lib/basePath'
import { createClient } from '@/lib/supabase/client'

interface Msg {
  role: 'user' | 'assistant'
  content: string
  dbId?: string | null
  feedback?: number | null
}

interface Session {
  id: string
  title: string
  message_count: number
  updated_at: string
}

// Minimal markdown: **bold**, "- " bullets, line breaks.
function renderMarkdown(text: string) {
  const lines = text.split('\n')
  const out: React.ReactNode[] = []
  let bullets: string[] = []
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        <span key={i}>{part}</span>
      ),
    )
  const flush = (key: string) => {
    if (bullets.length) {
      const items = bullets.slice()
      out.push(
        <ul key={key} style={{ margin: '4px 0', paddingLeft: 18 }}>
          {items.map((b, i) => (
            <li key={i} style={{ marginBottom: 2 }}>
              {inline(b)}
            </li>
          ))}
        </ul>,
      )
      bullets = []
    }
  }
  lines.forEach((line, i) => {
    const t = line.trim()
    if (t.startsWith('- ') || t.startsWith('• ')) {
      bullets.push(t.slice(2))
    } else {
      flush(`ul-${i}`)
      if (t) out.push(<div key={i} style={{ marginBottom: 4 }}>{inline(line)}</div>)
    }
  })
  flush('ul-end')
  return out
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'chat' | 'history'>('chat')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, loading])

  const loadSessions = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase
      .from('chat_sessions')
      .select('id,title,message_count,updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(30)
    setSessions((data as Session[]) ?? [])
  }, [supabase])

  async function openHistory() {
    await loadSessions()
    setView('history')
  }

  async function loadSession(id: string) {
    const { data } = await supabase
      .from('chat_messages')
      .select('id,role,content,feedback')
      .eq('session_id', id)
      .order('created_at', { ascending: true })
    setMsgs((data ?? []).map((r: any) => ({ role: r.role, content: r.content, dbId: r.id, feedback: r.feedback })))
    setSessionId(id)
    setView('chat')
  }

  function newChat() {
    setMsgs([])
    setSessionId(null)
    setView('chat')
  }

  async function ensureSession(firstMsg: string) {
    if (sessionId) return sessionId
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null
    const { data } = await supabase
      .from('chat_sessions')
      .insert({ user_id: user.id, title: firstMsg.slice(0, 60) || 'Gesprek' })
      .select('id')
      .single()
    if (data?.id) {
      setSessionId(data.id)
      return data.id
    }
    return null
  }

  async function send() {
    const text = input.trim()
    if (!text || loading) return
    const sid = await ensureSession(text)
    const newMsgs: Msg[] = [...msgs, { role: 'user', content: text }]
    setMsgs(newMsgs)
    setInput('')
    setLoading(true)
    try {
      const r = await fetch(withBase('/api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMsgs.map(({ role, content }) => ({ role, content })), sessionId: sid }),
      })
      const d = await r.json()
      setMsgs((m) => [...m, { role: 'assistant', content: d.reply, dbId: d.messageId, feedback: null }])
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', content: 'Er ging iets mis. Probeer het opnieuw.' }])
    } finally {
      setLoading(false)
    }
  }

  async function vote(idx: number, value: number) {
    const m = msgs[idx]
    if (!m.dbId) return
    const next = m.feedback === value ? null : value
    setMsgs((arr) => arr.map((x, i) => (i === idx ? { ...x, feedback: next } : x)))
    await supabase.from('chat_messages').update({ feedback: next, feedback_at: new Date().toISOString() }).eq('id', m.dbId)
  }

  const iconBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', color: 'var(--muted)', padding: 4 }

  return (
    <div className="wz-chat" style={{ position: 'fixed', right: 24, zIndex: 1000 }}>
      {open && (
        <div
          style={{
            width: 360,
            height: 520,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 16,
            boxShadow: 'var(--shadow-lg)',
            display: 'flex',
            flexDirection: 'column',
            marginBottom: 12,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>Luchtkwaliteit AI</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>Live data · weer · schimmel</div>
            </div>
            <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              <button onClick={newChat} title="Nieuw gesprek" style={iconBtn}>
                ✚
              </button>
              <button onClick={view === 'history' ? () => setView('chat') : openHistory} title="Geschiedenis" style={iconBtn}>
                🕘
              </button>
              <button onClick={() => setOpen(false)} title="Sluiten" style={{ ...iconBtn, fontSize: 16 }}>
                ✕
              </button>
            </div>
          </div>

          {view === 'history' ? (
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Gesprekken
              </div>
              {sessions.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--muted)', textAlign: 'center', marginTop: 30 }}>Nog geen gesprekken.</div>
              ) : (
                sessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => loadSession(s.id)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '9px 11px',
                      marginBottom: 6,
                      borderRadius: 9,
                      border: '1px solid var(--border)',
                      background: s.id === sessionId ? 'var(--surface-tint)' : 'var(--surface-2)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {s.title}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--subtle)', marginTop: 2 }}>
                      {s.message_count} berichten · {new Date(s.updated_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {msgs.length === 0 && (
                <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', marginTop: 30 }}>
                  Stel een vraag over je luchtkwaliteit, het buitenweer of een specifieke periode…
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div
                    style={{
                      maxWidth: '85%',
                      padding: '8px 12px',
                      borderRadius: m.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                      background: m.role === 'user' ? '#3B82F6' : 'var(--surface-tint)',
                      color: m.role === 'user' ? '#fff' : 'var(--text)',
                      fontSize: 13,
                      lineHeight: 1.5,
                    }}
                  >
                    {m.role === 'assistant' ? renderMarkdown(m.content) : m.content}
                  </div>
                  {m.role === 'assistant' && m.dbId && (
                    <div style={{ display: 'flex', gap: 4, marginTop: 3, marginLeft: 2 }}>
                      <button onClick={() => vote(i, 1)} title="Nuttig" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, opacity: m.feedback === 1 ? 1 : 0.4 }}>
                        👍
                      </button>
                      <button onClick={() => vote(i, -1)} title="Niet nuttig" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, opacity: m.feedback === -1 ? 1 : 0.4 }}>
                        👎
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {loading && <div style={{ color: 'var(--muted)', fontSize: 12 }}>Aan het typen…</div>}
              <div ref={bottomRef} />
            </div>
          )}

          {view === 'chat' && (
            <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
                placeholder="Vraag iets over de data…"
                style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--surface-2)', color: 'var(--text)', outline: 'none' }}
              />
              <button
                onClick={send}
                disabled={!input.trim() || loading}
                style={{ padding: '8px 12px', background: '#3B82F6', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: !input.trim() || loading ? 0.5 : 1 }}
              >
                ↑
              </button>
            </div>
          )}
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ width: 52, height: 52, borderRadius: '50%', background: 'linear-gradient(135deg,#3B82F6 0%,#2563EB 100%)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(59,130,246,0.4)', fontSize: 22 }}
      >
        {open ? '✕' : '💬'}
      </button>
    </div>
  )
}
