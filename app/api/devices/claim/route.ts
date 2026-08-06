import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

// Device provisioning — resident side. Redeem a claim code (from the device QR or typed)
// to link the sensor to this household. redeem_device_claim (SECURITY DEFINER) sets
// devices.user_id = auth.uid(). Design: docs/device-provisioning-design.md.

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: (c) => { try { c.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} } } },
  )
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const code = typeof body.code === 'string' ? body.code.trim() : ''
  if (!code) return NextResponse.json({ error: 'code_required' }, { status: 400 })

  const { data, error } = await supabase.rpc('redeem_device_claim', { p_code: code })
  if (error) {
    const msg = error.message || ''
    const mapped = /claim_invalid/.test(msg) ? 'claim_invalid'
      : /not_authenticated/.test(msg) ? 'unauthenticated'
      : /function|does not exist/i.test(msg) ? 'not_deployed'
      : 'error'
    return NextResponse.json({ error: mapped }, { status: mapped === 'claim_invalid' ? 404 : 400 })
  }
  const row = Array.isArray(data) ? data[0] : data
  return NextResponse.json({ ok: true, device_name: row?.device_name ?? null })
}
