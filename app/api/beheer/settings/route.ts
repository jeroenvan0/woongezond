import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { adminOrgs } from '@/lib/cockpit/auth'
import { SETTINGS, EMAIL_RE, describeSettings, invalidateSettings, type SettingKey } from '@/lib/settings'
import { log, errText } from '@/lib/logger'

// GET  /api/beheer/settings          de instelbare adressen + waar de werkende waarde vandaan komt
// POST /api/beheer/settings {key, value}   opslaan (lege waarde = terug naar de env-waarde)
//
// Alleen org-admins. Schrijven gaat via de service-role ná die check; app_settings heeft
// bewust geen insert/update-policy, zodat een browser er nooit rechtstreeks bij kan.
// Elke wijziging komt in app_settings_log, met wie het deed — een verkeerd afzenderadres
// is stil en vervelend, dus je wilt terug kunnen kijken.

export const dynamic = 'force-dynamic'

export async function GET() {
  const orgs = await adminOrgs()
  if (orgs === 'unauthenticated') return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (!orgs.length) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const settings = await describeSettings()

  let recent: unknown[] = []
  try {
    const s = createServiceClient()
    const { data } = await s
      .from('app_settings_log')
      .select('key, old_value, new_value, changed_at, changed_by_email')
      .order('changed_at', { ascending: false })
      .limit(10)
    recent = data ?? []
  } catch (e) {
    log.warn('beheer', 'wijzigingslog niet leesbaar', { detail: errText(e) })
  }

  return NextResponse.json({ settings, recent }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const orgs = await adminOrgs()
  if (orgs === 'unauthenticated') return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (!orgs.length) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const key = String(body?.key ?? '') as SettingKey
  const def = SETTINGS.find((d) => d.key === key)
  if (!def) return NextResponse.json({ error: 'unknown_key' }, { status: 400 })

  // Leeg opslaan is een geldige actie: het betekent "gebruik weer de env-waarde".
  const raw = typeof body?.value === 'string' ? body.value.trim().slice(0, 200) : ''
  const value = raw || null

  // "Naam <adres@domein>" is een geldige afzender voor Resend, dus valideer het adres
  // binnen de punthaken en niet de hele string.
  if (value && def.kind === 'email') {
    const bare = value.includes('<') ? (value.match(/<([^>]+)>/)?.[1] ?? '') : value
    if (!EMAIL_RE.test(bare.trim())) return NextResponse.json({ error: 'email_invalid' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let s
  try {
    s = createServiceClient()
  } catch (e) {
    log.error('beheer', 'service client niet beschikbaar', { detail: errText(e) })
    return NextResponse.json({ error: 'unconfigured' }, { status: 503 })
  }

  const { data: before } = await s.from('app_settings').select('value').eq('key', key).maybeSingle()
  const oldValue = before?.value ?? null
  if (oldValue === value) return NextResponse.json({ ok: true, unchanged: true })

  const { error } = await s
    .from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString(), updated_by: user?.id ?? null }, { onConflict: 'key' })
  if (error) {
    log.error('beheer', 'instelling opslaan mislukt', { key, detail: error.message })
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }

  const { error: logErr } = await s.from('app_settings_log').insert({
    key, old_value: oldValue, new_value: value, changed_by: user?.id ?? null, changed_by_email: user?.email ?? null,
  })
  if (logErr) log.warn('beheer', 'wijziging niet gelogd', { key, detail: logErr.message })

  invalidateSettings()
  log.info('beheer', 'instelling gewijzigd', { key, by: user?.email ?? null })
  return NextResponse.json({ ok: true })
}
