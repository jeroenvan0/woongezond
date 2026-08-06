import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

// C1 (vervolg) — the resident's control over who sees their home.
//
//   GET   → list this resident's consents (org name + label + granted/revoked state).
//   POST  → redeem an invite code → creates/re-activates a consent (redeem_org_invite RPC).
//   PATCH → revoke / re-grant an existing consent (direct update; RLS restricts to own rows).
//
// Runs as the caller (anon-key SSR client + auth cookies). All writes are scoped to
// auth.uid() by RLS / the SECURITY DEFINER RPC. Design: docs/corporatie-fleet-design.md §5.

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function client() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: (c) => { try { c.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} } } },
  )
}

export async function GET() {
  const supabase = await client()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const { data, error } = await supabase
    .from('household_consents')
    .select('id, org_id, label, granted_at, revoked_at, organizations(name)')
    .order('granted_at', { ascending: false })

  // Tables may not be deployed yet (migration 20260806120000/120200) — treat as empty.
  if (error) return NextResponse.json({ consents: [] })

  const consents = (data ?? []).map((c: any) => ({
    id: c.id,
    org_id: c.org_id,
    org_name: c.organizations?.name ?? 'Corporatie',
    label: c.label,
    granted_at: c.granted_at,
    revoked_at: c.revoked_at,
    active: c.revoked_at == null,
  }))
  return NextResponse.json({ consents }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const supabase = await client()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const code = typeof body.code === 'string' ? body.code.trim() : ''
  if (!code) return NextResponse.json({ error: 'code_required' }, { status: 400 })

  const { data, error } = await supabase.rpc('redeem_org_invite', { p_code: code })
  if (error) {
    // Map the RPC's raise-exception messages to something the UI can show in Dutch.
    const msg = error.message || ''
    const code = /invite_invalid/.test(msg) ? 'invite_invalid'
      : /not_authenticated/.test(msg) ? 'unauthenticated'
      : /function|does not exist/i.test(msg) ? 'not_deployed'
      : 'error'
    return NextResponse.json({ error: code }, { status: code === 'invite_invalid' ? 404 : 400 })
  }
  const row = Array.isArray(data) ? data[0] : data
  return NextResponse.json({ ok: true, org_name: row?.org_name ?? null, label: row?.label ?? null })
}

export async function PATCH(req: NextRequest) {
  const supabase = await client()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const id = typeof body.id === 'string' && UUID_RE.test(body.id) ? body.id : null
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })
  const revoke = body.revoke !== false // default: revoke; pass revoke:false to re-grant

  const { error } = await supabase
    .from('household_consents')
    .update({ revoked_at: revoke ? new Date().toISOString() : null })
    .eq('id', id) // RLS additionally scopes this to resident_id = auth.uid()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
