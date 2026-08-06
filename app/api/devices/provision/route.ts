import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

// Device provisioning — corporation side.
//
//   GET  → the caller's orgs + the devices of the selected org, each with its open claim
//          code (if any) and whether it's been claimed by a resident.
//   POST → create a device for an org (name, room, house profile) + mint a claim code.
//
// Runs as the caller; RLS on devices/device_claim_codes (is_org_member / device_in_my_org)
// is the boundary. Design: docs/device-provisioning-design.md.

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
  const { data, error } = await supabase.from('org_members').select('org_id, role, organizations(name)').order('created_at', { ascending: true })
  if (error) return null
  return (data ?? []).map((m: any) => ({ id: m.org_id, name: m.organizations?.name ?? 'Corporatie', role: m.role }))
}

function genCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]
  return `DEVICE-${s}`
}

export async function GET(req: NextRequest) {
  const supabase = await client()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const orgs = await callerOrgs(supabase)
  if (!orgs?.length) return NextResponse.json({ orgs: [], org: null, devices: [] })

  const requested = req.nextUrl.searchParams.get('org')
  const org = requested && UUID_RE.test(requested) && orgs.some((o) => o.id === requested) ? requested : orgs[0].id

  const { data: devices, error } = await supabase
    .from('devices')
    .select('id, name, location, insulation, build_year, house_type, placement_note, user_id, active, device_claim_codes(code, used_at, expires_at)')
    .eq('org_id', org)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ orgs, org, devices: [] })

  const shaped = (devices ?? []).map((d: any) => {
    const openCode = (d.device_claim_codes ?? []).find((c: any) => !c.used_at) ?? null
    return {
      id: d.id, name: d.name, location: d.location, insulation: d.insulation,
      build_year: d.build_year, house_type: d.house_type, placement_note: d.placement_note,
      claimed: d.user_id != null, active: d.active,
      claim_code: openCode?.code ?? null,
    }
  })
  return NextResponse.json({ orgs, org, devices: shaped }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const supabase = await client()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const orgs = await callerOrgs(supabase)
  if (!orgs?.length) return NextResponse.json({ error: 'no_org' }, { status: 403 })

  const b = await req.json().catch(() => ({}))
  const orgId = typeof b.org_id === 'string' && UUID_RE.test(b.org_id) && orgs.some((o) => o.id === b.org_id) ? b.org_id : orgs[0].id
  const name = (typeof b.name === 'string' && b.name.trim()) || 'Nieuwe sensor'
  const insulation = ['poor', 'moderate', 'good', 'excellent'].includes(b.insulation) ? b.insulation : 'poor'
  const buildYear = Number.isFinite(b.build_year) && b.build_year > 1800 && b.build_year <= 2100 ? Math.trunc(b.build_year) : null

  // Create the device owned by no resident yet (user_id null); the resident claims it later.
  const { data: dev, error: devErr } = await supabase
    .from('devices')
    .insert({
      org_id: orgId, name: name.slice(0, 120),
      location: typeof b.location === 'string' ? b.location.trim().slice(0, 120) || null : null,
      insulation, build_year: buildYear,
      house_type: typeof b.house_type === 'string' ? b.house_type.trim().slice(0, 60) || null : null,
      placement_note: typeof b.placement_note === 'string' ? b.placement_note.trim().slice(0, 300) || null : null,
    })
    .select('id, name')
    .single()
  if (devErr) return NextResponse.json({ error: devErr.message }, { status: 400 })

  // Mint a claim code (retry on the rare collision).
  let code: string | null = null
  for (let i = 0; i < 5; i++) {
    const c = genCode()
    const { error } = await supabase.from('device_claim_codes').insert({ device_id: dev.id, code: c })
    if (!error) { code = c; break }
    if (!/duplicate|unique/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 })
  }
  return NextResponse.json({ ok: true, device: dev, claim_code: code })
}
