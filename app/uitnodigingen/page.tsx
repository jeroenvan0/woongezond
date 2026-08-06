'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import Card from '@/components/ui/Card'
import SectionHeading from '@/components/ui/SectionHeading'
import SegmentedControl from '@/components/ui/SegmentedControl'
import Button from '@/components/ui/Button'
import { MetricCardSkeleton } from '@/components/ui/Skeleton'
import { withBase } from '@/lib/basePath'
import { Building2, Ticket, Copy, Check, Trash2, Plus } from 'lucide-react'

// C1 (vervolg) — corporation-side invite management. An org member mints readable codes
// (with a pre-set pseudonymous label) that residents redeem on /delen to start sharing.
// RLS on org_invites (is_org_member) is the boundary. Design: docs/corporatie-fleet-design.md §5.1.

interface Invite {
  id: string
  code: string
  label: string | null
  expires_at: string | null
  used_at: string | null
  created_at: string
}
interface Org { id: string; name: string; role: string }

function fmt(iso: string | null): string {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) } catch { return '' }
}

function status(inv: Invite): { text: string; color: string } {
  if (inv.used_at) return { text: 'Gebruikt', color: 'var(--ok)' }
  if (inv.expires_at && new Date(inv.expires_at) < new Date()) return { text: 'Verlopen', color: 'var(--crit)' }
  return { text: 'Open', color: 'var(--accent)' }
}

export default function UitnodigingenPage() {
  const router = useRouter()
  const supabase = createClient()
  const [orgs, setOrgs] = useState<Org[]>([])
  const [org, setOrg] = useState<string | null>(null)
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { if (!data.user) router.push('/login') })
  }, [supabase, router])

  const load = useCallback(async (orgId?: string | null) => {
    try {
      const q = orgId ? `/api/invites?org=${encodeURIComponent(orgId)}` : '/api/invites'
      const r = await fetch(withBase(q))
      const d = await r.json()
      setOrgs(d.orgs ?? [])
      setOrg(d.org ?? null)
      setInvites(d.invites ?? [])
    } catch { /* keep prior */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function create() {
    setBusy(true)
    try {
      const r = await fetch(withBase('/api/invites'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: org, label: label.trim() || null }),
      })
      if (r.ok) { setLabel(''); await load(org) }
    } finally { setBusy(false) }
  }

  async function remove(id: string) {
    setBusy(true)
    try {
      const r = await fetch(withBase(`/api/invites?id=${encodeURIComponent(id)}`), { method: 'DELETE' })
      if (r.ok) await load(org)
    } finally { setBusy(false) }
  }

  async function copy(code: string) {
    try { await navigator.clipboard.writeText(code); setCopied(code); setTimeout(() => setCopied(null), 1500) } catch {}
  }

  const isMember = orgs.length > 0
  const orgName = orgs.find((o) => o.id === org)?.name ?? 'Corporatie'

  return (
    <AppShell title="Uitnodigingscodes">
      {!loading && !isMember && (
        <Card style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
          <Building2 style={{ color: 'var(--muted)', flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Geen corporatietoegang</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>
              Uitnodigingscodes zijn voor corporatie-medewerkers. Je account is nog niet aan een organisatie gekoppeld.
            </div>
          </div>
        </Card>
      )}

      {isMember && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-3)', flexWrap: 'wrap', marginBottom: 'var(--sp-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>
              <Building2 size={15} /> {orgName}
            </div>
            {orgs.length > 1 && (
              <SegmentedControl ariaLabel="Kies organisatie" value={org ?? orgs[0].id} onChange={(v) => { setLoading(true); load(String(v)) }} options={orgs.map((o) => ({ label: o.name, value: o.id }))} />
            )}
          </div>

          <Card style={{ marginBottom: 'var(--sp-5)' }}>
            <SectionHeading><Ticket size={14} style={{ marginRight: 4 }} /> Nieuwe code aanmaken</SectionHeading>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', marginBottom: 'var(--sp-3)' }}>
              Geef een woninglabel op (gepseudonimiseerd — geen namen). De bewoner ziet dit label en de code opent bij hem het delen.
            </div>
            <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && create()}
                placeholder="bijv. Woning 12, Da Costastraat"
                aria-label="Woninglabel"
                style={{ flex: 1, minWidth: 200, padding: '9px 12px', fontSize: 'var(--fs-md)', fontFamily: 'inherit', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface)', color: 'var(--text)' }}
              />
              <Button variant="primary" icon={<Plus size={15} />} onClick={create} disabled={busy}>Code aanmaken</Button>
            </div>
          </Card>

          <SectionHeading>Codes</SectionHeading>
          {loading ? (
            <MetricCardSkeleton />
          ) : invites.length === 0 ? (
            <Card><div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>Nog geen codes. Maak er hierboven één aan en deel die met de bewoner.</div></Card>
          ) : (
            <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              {invites.map((inv) => {
                const st = status(inv)
                return (
                  <Card key={inv.id} accent={st.color}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                          <code style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text)', fontFamily: 'ui-monospace, monospace', letterSpacing: '0.04em' }}>{inv.code}</code>
                          <button onClick={() => copy(inv.code)} className="wz-iconbtn" title="Kopieer code" aria-label="Kopieer code" style={{ width: 28, height: 28 }}>
                            {copied === inv.code ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                          <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: st.color }}>{st.text}</span>
                        </div>
                        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginTop: 2 }}>
                          {inv.label ? `${inv.label} · ` : ''}aangemaakt {fmt(inv.created_at)}
                          {inv.expires_at ? ` · verloopt ${fmt(inv.expires_at)}` : ''}
                        </div>
                      </div>
                      {!inv.used_at && (
                        <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={() => remove(inv.id)} disabled={busy}>Verwijderen</Button>
                      )}
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </>
      )}
    </AppShell>
  )
}
