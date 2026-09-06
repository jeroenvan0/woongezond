import { createClient } from '@/lib/supabase/server'

// Wie mag de cockpit zien: org-ADMINS. De aanroeper wordt via zijn eigen sessie
// gecontroleerd (org_members, RLS laat alleen eigen lidmaatschappen zien). Viewers zien
// alleen /vloot, zonder namen. Gedeeld door /api/cockpit en /api/cockpit/inbox.

export interface AdminOrg { id: string; name: string }

export async function adminOrgs(): Promise<AdminOrg[] | 'unauthenticated'> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 'unauthenticated'
  const { data } = await supabase.from('org_members').select('org_id, role, organizations(name)').eq('role', 'admin')
  return (data ?? []).map((m: any) => ({ id: m.org_id, name: m.organizations?.name ?? 'Organisatie' }))
}
