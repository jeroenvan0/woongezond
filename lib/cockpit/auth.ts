import { createClient } from '@/lib/supabase/server'

// Wie mag de cockpit zien: org-ADMINS. De aanroeper wordt via zijn eigen sessie
// gecontroleerd (org_members, RLS laat alleen eigen lidmaatschappen zien). Viewers zien
// alleen /vloot, zonder namen. Gedeeld door /api/cockpit en /api/cockpit/inbox.

export interface AdminOrg { id: string; name: string }

// LET OP: de RLS-policy op org_members is `is_org_member(org_id)` — "leden van dezelfde
// organisatie", niet "alleen je eigen rij". Zonder een expliciet filter op user_id ziet een
// gewone medewerker dus óók de adminrij van een collega, en dan zou `role = 'admin'` op een
// niet-admin waar worden. Filter altijd zelf op de eigen gebruiker.
export async function adminOrgs(): Promise<AdminOrg[] | 'unauthenticated'> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 'unauthenticated'
  const { data } = await supabase.from('org_members').select('org_id, role, organizations(name)').eq('user_id', user.id).eq('role', 'admin')
  return (data ?? []).map((m: any) => ({ id: m.org_id, name: m.organizations?.name ?? 'Organisatie' }))
}
