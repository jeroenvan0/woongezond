'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import Card from '@/components/ui/Card'
import SectionHeading from '@/components/ui/SectionHeading'
import Button from '@/components/ui/Button'
import { MetricCardSkeleton } from '@/components/ui/Skeleton'
import { withBase } from '@/lib/basePath'
import { Building2, ShieldCheck, ShieldOff, Ticket, Check } from 'lucide-react'

// C1 (vervolg) — the resident's consent controls. A household decides which corporation
// may see its (aggregated) data, via an invite code, and can stop sharing at any time.
// Reads/writes only the resident's own consents through /api/consents. Opt-in, revocable.
// Design: docs/corporatie-fleet-design.md §5.

interface Consent {
  id: string
  org_name: string
  label: string | null
  granted_at: string
  revoked_at: string | null
  active: boolean
}

const ERRORS: Record<string, string> = {
  invite_invalid: 'Deze code is ongeldig, verlopen of al gebruikt.',
  code_required: 'Vul eerst een code in.',
  not_deployed: 'Delen is nog niet beschikbaar op deze server.',
  unauthenticated: 'Je bent uitgelogd. Log opnieuw in.',
  error: 'Er ging iets mis. Probeer het later opnieuw.',
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }) } catch { return '' }
}

export default function DelenPage() {
  const router = useRouter()
  const supabase = createClient()
  const [consents, setConsents] = useState<Consent[]>([])
  const [loading, setLoading] = useState(true)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { if (!data.user) router.push('/login') })
  }, [supabase, router])

  const load = useCallback(async () => {
    try {
      const r = await fetch(withBase('/api/consents'))
      const d = await r.json()
      setConsents(d.consents ?? [])
    } catch { /* keep prior */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function redeem() {
    if (!code.trim()) { setMsg({ kind: 'err', text: ERRORS.code_required }); return }
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(withBase('/api/consents'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code.trim() }) })
      const d = await r.json()
      if (!r.ok) { setMsg({ kind: 'err', text: ERRORS[d.error] ?? ERRORS.error }); return }
      setMsg({ kind: 'ok', text: `Je deelt nu met ${d.org_name ?? 'de corporatie'}.` })
      setCode('')
      await load()
    } catch {
      setMsg({ kind: 'err', text: ERRORS.error })
    } finally { setBusy(false) }
  }

  async function toggle(c: Consent, revoke: boolean) {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(withBase('/api/consents'), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id, revoke }) })
      if (!r.ok) { setMsg({ kind: 'err', text: ERRORS.error }); return }
      setMsg({ kind: 'ok', text: revoke ? `Delen met ${c.org_name} gestopt.` : `Weer aan het delen met ${c.org_name}.` })
      await load()
    } catch {
      setMsg({ kind: 'err', text: ERRORS.error })
    } finally { setBusy(false) }
  }

  return (
    <AppShell title="Delen met je corporatie">
      {/* What sharing means — the privacy contract, up front. */}
      <Card style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-start', marginBottom: 'var(--sp-4)' }}>
        <ShieldCheck style={{ color: 'var(--brand)', flexShrink: 0 }} />
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', lineHeight: 1.5 }}>
          Je kunt je woningcorporatie meekijken geven met een <strong style={{ color: 'var(--text)' }}>samenvatting</strong> van
          je binnenklimaat — of het gezond is, of er actie nodig is. Ze zien <strong style={{ color: 'var(--text)' }}>geen
          ruwe metingen, geen namen en geen adressen</strong>, alleen een status per woning. Jij bepaalt dit, en je kunt het
          altijd stoppen. Delen begint pas als je hieronder een code van je corporatie invult.
        </div>
      </Card>

      {msg && (
        <div role="status" aria-live="polite" style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 'var(--sp-4)',
          borderRadius: 'var(--r-md)', fontSize: 'var(--fs-sm)', fontWeight: 600,
          background: msg.kind === 'ok' ? 'var(--ok-fill)' : 'var(--crit-fill)',
          color: msg.kind === 'ok' ? 'var(--ok)' : 'var(--crit)',
        }}>
          {msg.kind === 'ok' && <Check size={15} />} {msg.text}
        </div>
      )}

      {/* Redeem an invite code */}
      <Card style={{ marginBottom: 'var(--sp-5)' }}>
        <SectionHeading><Ticket size={14} style={{ marginRight: 4 }} /> Start met delen</SectionHeading>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', marginBottom: 'var(--sp-3)' }}>
          Heb je een uitnodigingscode van je corporatie gekregen? Vul die hier in.
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && redeem()}
            placeholder="bijv. WONING-7F3A"
            aria-label="Uitnodigingscode"
            autoComplete="off"
            style={{ flex: 1, minWidth: 180, padding: '9px 12px', fontSize: 'var(--fs-md)', fontFamily: 'inherit', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface)', color: 'var(--text)' }}
          />
          <Button variant="primary" onClick={redeem} disabled={busy}>Code inwisselen</Button>
        </div>
      </Card>

      <SectionHeading>Wie kan meekijken</SectionHeading>
      {loading ? (
        <MetricCardSkeleton />
      ) : consents.length === 0 ? (
        <Card>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>
            Je deelt op dit moment met niemand. Zolang je geen code invult, ziet geen enkele corporatie je gegevens.
          </div>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          {consents.map((c) => (
            <Card key={c.id} accent={c.active ? 'var(--ok)' : 'var(--border)'}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', minWidth: 0 }}>
                  <Building2 size={18} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: 'var(--text)' }}>{c.org_name}</div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>
                      {c.label ? `${c.label} · ` : ''}
                      {c.active ? `deelt sinds ${fmtDate(c.granted_at)}` : `gestopt${c.revoked_at ? ` op ${fmtDate(c.revoked_at)}` : ''}`}
                    </div>
                  </div>
                </div>
                {c.active ? (
                  <Button variant="danger" size="sm" icon={<ShieldOff size={14} />} onClick={() => toggle(c, true)} disabled={busy}>
                    Stop delen
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" icon={<ShieldCheck size={14} />} onClick={() => toggle(c, false)} disabled={busy}>
                    Opnieuw delen
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  )
}
