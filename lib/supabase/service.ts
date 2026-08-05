import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Service-role client — bypasses RLS. Only ever import this from a route handler
// that has already authenticated the caller (a session, or the CRON_SECRET header).
// Never import it into a 'use client' file: the key would end up in the bundle.
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

// Constant-time-ish comparison so a wrong secret can't be narrowed by timing.
// Not a hot path; correctness matters more than the microseconds.
export function cronSecretOk(header: string | null): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret || !header || header.length !== secret.length) return false
  let diff = 0
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ header.charCodeAt(i)
  return diff === 0
}
