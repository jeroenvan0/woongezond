'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import Card from '@/components/ui/Card'
import SectionHeading from '@/components/ui/SectionHeading'
import SegmentedControl from '@/components/ui/SegmentedControl'
import DataBanner, { DataError, describeError } from '@/components/DataBanner'
import { MetricCardSkeleton } from '@/components/ui/Skeleton'
import { withBase } from '@/lib/basePath'
import Link from 'next/link'
import { Building2, AlertTriangle, Wind, CheckCircle2, WifiOff, Ticket } from 'lucide-react'

// C1 — corporation fleet overview. Reads only per-household AGGREGATES from /api/fleet
// (SECURITY DEFINER fleet_overview RPC): staleness + latest CO2/T/RH + a server-derived
// severity, for consented households only. No resident names, no raw series. Households
// are ranked by severity so "which home needs action" is the top of the list.
// Design: docs/corporatie-fleet-design.md.

interface Household {
  consent_id: string
  label: string | null
  device_count: number
  last_seen: string | null
  minutes_since: number | null
  stale: boolean
  co2_latest: number | null
  rh_latest: number | null
  temp_latest: number | null
  severity: 'ok' | 'warn' | 'crit'
}
interface Org { id: string; name: string; role: string }

const SEV = {
  crit: { color: 'var(--crit)', Icon: AlertTriangle, label: 'Actie nodig' },
  warn: { color: 'var(--warn)', Icon: Wind, label: 'Let op' },
  ok: { color: 'var(--ok)', Icon: CheckCircle2, label: 'In orde' },
} as const

function ago(mins: number | null): string {
  if (mins == null) return 'nooit gemeten'
  if (mins < 60) return `${mins} min geleden`
  if (mins < 1440) return `${Math.floor(mins / 60)} uur geleden`
  return `${Math.floor(mins / 1440)} dagen geleden`
}

export default function VlootPage() {
  const router = useRouter()
  const supabase = createClient()
  const [orgs, setOrgs] = useState<Org[]>([])
  const [org, setOrg] = useState<string | null>(null)
  const [households, setHouseholds] = useState<Household[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<DataError>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push('/login')
    })
  }, [supabase, router])

  const load = useCallback(async (orgId?: string | null) => {
    try {
      const q = orgId ? `/api/fleet?org=${encodeURIComponent(orgId)}` : '/api/fleet'
      const r = await fetch(withBase(q))
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status })
      const d = await r.json()
      setOrgs(d.orgs ?? [])
      setOrg(d.org ?? null)
      setHouseholds(d.households ?? [])
      setError(null)
    } catch (e) {
      const status = (e as { status?: number })?.status
      setError(describeError(status, status == null))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const counts = useMemo(() => {
    const c = { crit: 0, warn: 0, ok: 0 }
    for (const h of households) c[h.severity]++
    return c
  }, [households])

  const isMember = orgs.length > 0
  const orgName = orgs.find((o) => o.id === org)?.name ?? 'Vloot'

  return (
    <AppShell title="Vlootoverzicht">
      {error && <DataBanner error={error} onRetry={() => load(org)} />}

      {!loading && !isMember && (
        <Card style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
          <Building2 style={{ color: 'var(--muted)', flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Geen vloottoegang</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>
              Dit overzicht is voor corporatie-medewerkers. Je account is nog niet aan een
              organisatie gekoppeld. Neem contact op met de beheerder om toegang te krijgen.
            </div>
          </div>
        </Card>
      )}

      {isMember && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-3)', flexWrap: 'wrap', marginBottom: 'var(--sp-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', fontSize: 'var(--fs-sm)', color: 'var(--muted)', flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                <Building2 size={15} /> {orgName} · {households.length} woning{households.length === 1 ? '' : 'en'}
              </span>
              <Link href="/uitnodigingen" className="wz-navlink" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', fontSize: 'var(--fs-xs)', fontWeight: 600 }}>
                <Ticket size={14} /> Uitnodigingscodes
              </Link>
            </div>
            {orgs.length > 1 && (
              <SegmentedControl
                ariaLabel="Kies organisatie"
                value={org ?? orgs[0].id}
                onChange={(v) => { setLoading(true); load(String(v)) }}
                options={orgs.map((o) => ({ label: o.name, value: o.id }))}
              />
            )}
          </div>

          {/* Severity summary — the fleet at a glance. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--sp-3)', marginBottom: 'var(--sp-5)' }}>
            {(['crit', 'warn', 'ok'] as const).map((s) => {
              const { color, Icon, label } = SEV[s]
              return (
                <Card key={s} accent={color} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                  <Icon style={{ color }} />
                  <div>
                    <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--text)' }}>{counts[s]}</div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>{label}</div>
                  </div>
                </Card>
              )
            })}
          </div>

          <SectionHeading>Woningen — hoogste risico eerst</SectionHeading>

          {loading ? (
            <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              {[0, 1, 2].map((i) => <MetricCardSkeleton key={i} />)}
            </div>
          ) : households.length === 0 ? (
            <Card>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>
                Nog geen woningen met toestemming in deze organisatie. Woningen verschijnen hier
                zodra bewoners inzage geven.
              </div>
            </Card>
          ) : (
            <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              {households.map((h) => {
                const { color, Icon, label } = SEV[h.severity]
                return (
                  <Card key={h.consent_id} accent={color}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', minWidth: 0 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color, fontSize: 'var(--fs-xs)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                          <Icon size={14} /> {label}
                        </span>
                        <span style={{ fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {h.label || 'Woning zonder label'}
                        </span>
                      </div>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-xs)', color: h.stale ? 'var(--warn)' : 'var(--muted)' }}>
                        {h.stale && <WifiOff size={13} />} {ago(h.minutes_since)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--sp-5)', marginTop: 'var(--sp-3)', flexWrap: 'wrap' }}>
                      <Kpi label="CO₂" value={h.co2_latest} unit="ppm" digits={0} />
                      <Kpi label="Luchtvochtigheid" value={h.rh_latest} unit="%" digits={0} />
                      <Kpi label="Temperatuur" value={h.temp_latest} unit="°C" digits={1} />
                      <Kpi label="Sensoren" value={h.device_count} unit="" digits={0} />
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

function Kpi({ label, value, unit, digits }: { label: string; value: number | null; unit: string; digits: number }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text)' }}>
        {value == null ? '—' : Number(value).toFixed(digits)}{value != null && unit ? ` ${unit}` : ''}
      </div>
    </div>
  )
}
