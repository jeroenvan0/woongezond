import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

// C1 (vervolg) — the corporation side of consent: create and manage invite codes.
//
//   GET    → the caller's orgs + the invite codes of the selected org (RLS-gated to member orgs).
//   POST   → mint a new invite { org_id, label, expires_days? } → returns the generated code.
//   DELETE → remove an unused invite by id.
//
// Runs as the caller. RLS on org_invites (is_org_member) is the boundary: a non-member
// cannot list or create codes for an org. Design: docs/corporatie-fleet-design.md §5.1.

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

async function callerOrgs(supabase: Awaited<ReturnType<typeof client>>) {
  const { data, error } = await supabase
    .from('org_members')
    .select('org_id, role, organizations(name)')
    .order('created_at', { ascending: true })
  if (error) return null
  return (data ?? []).map((m: any) => ({ id: m.org_id, name: m.organizations?.name ?? 'Corporatie', role: m.role }))
}

// Readable, unambiguous code: no 0/O/1/I. e.g. WONING-7F3A.
function genCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]
  return `WONING-${s}`
}

export async function GET(req: NextRequest) {
  const supabase = await client()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const orgs = await callerOrgs(supabase)
  if (!orgs) return NextResponse.json({ orgs: [], org: null, invites: [] }) // tables not deployed yet
  if (!orgs.length) return NextResponse.json({ orgs: [], org: null, invites: [] })

  const requested = req.nextUrl.searchParams.get('org')
  const org = requested && UUID_RE.test(requested) && orgs.some((o) => o.id === requested) ? requested : orgs[0].id

  const { data, error } = await supabase
    .from('org_invites')
    .select('id, code, label, expires_at, used_at, created_at')
    .eq('org_id', org)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ orgs, org, invites: [] })

  return NextResponse.json({ orgs, org, invites: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const supabase = await client()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const orgs = await callerOrgs(supabase)
  if (!orgs?.length) return NextResponse.json({ error: 'no_org' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const orgId = typeof body.org_id === 'string' && UUID_RE.test(body.org_id) && orgs.some((o) => o.id === body.org_id)
    ? body.org_id
    : orgs[0].id
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 120) || null : null
  const expiresDays = Number.isFinite(body.expires_days) && body.expires_days > 0 ? Math.min(365, body.expires_days) : null
  const expiresAt = expiresDays ? new Date(Date.now() + expiresDays * 86400000).toISOString() : null

  // Retry on the tiny chance of a code collision (unique constraint).
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = genCode()
    const { data, error } = await supabase
      .from('org_invites')
      .insert({ org_id: orgId, code, label, expires_at: expiresAt })
      .select('id, code, label, expires_at, used_at, created_at')
      .single()
    if (!error) return NextResponse.json({ ok: true, invite: data })
    if (!/duplicate|unique/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
  }
  return NextResponse.json({ error: 'code_collision' }, { status: 500 })
}

export async function DELETE(req: NextRequest) {
  const supabase = await client()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id || !UUID_RE.test(id)) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  // RLS scopes this to invites of orgs the caller belongs to. Only remove unused ones.
  const { error } = await supabase.from('org_invites').delete().eq('id', id).is('used_at', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
