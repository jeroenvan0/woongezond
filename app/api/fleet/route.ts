import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

// C1 — the corporation's only window onto resident data.
//
// This never reads raw resident rows. It resolves which organisations the caller belongs
// to, then calls fleet_overview(org) — a SECURITY DEFINER RPC that returns per-household
// AGGREGATES (staleness + latest CO2/T/RH + a server-derived severity) for consented
// households only. See docs/corporatie-fleet-design.md.
//
// Runs as the caller (anon-key SSR client + auth cookies), so RLS and the RPC's own
// org-membership gate are the boundary. A non-member gets an empty fleet, not an error.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: (c) => { try { c.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} } } },
  )

  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  // Which orgs may this user view? RLS on org_members already restricts to own rows.
  const { data: memberships, error: memErr } = await supabase
    .from('org_members')
    .select('org_id, role, organizations(name)')
    .order('created_at', { ascending: true })

  // The tables may not be deployed yet (migration 20260806120000). Treat that as "no
  // orgs" rather than a 500, so the app is graceful before the migration is applied.
  if (memErr) return NextResponse.json({ orgs: [], org: null, households: [] })

  const orgs = (memberships ?? []).map((m: any) => ({
    id: m.org_id,
    name: m.organizations?.name ?? 'Corporatie',
    role: m.role,
  }))
  if (!orgs.length) return NextResponse.json({ orgs: [], org: null, households: [] })

  const requested = req.nextUrl.searchParams.get('org')
  const org = requested && UUID_RE.test(requested) && orgs.some((o) => o.id === requested)
    ? requested
    : orgs[0].id

  const { data: households, error: rpcErr } = await supabase.rpc('fleet_overview', { p_org_id: org })
  if (rpcErr) return NextResponse.json({ orgs, org, households: [], error: rpcErr.message }, { status: 200 })

  return NextResponse.json({ orgs, org, households: households ?? [] }, { headers: { 'Cache-Control': 'no-store' } })
}
