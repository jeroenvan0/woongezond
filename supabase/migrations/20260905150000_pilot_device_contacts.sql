-- Who lives behind sensor N — kept OUT of the measurement tables (docs/pilot-cockpit-plan.md §2c).
-- devices/air_quality/house_profile stay pseudonymous (a number, a room, a house type);
-- the link to a person lives only here, readable by org ADMINS, never by viewers, never
-- by fleet_overview(). Deleting a row unlinks the household without touching any data.
CREATE OR REPLACE FUNCTION public.is_org_admin(p_org_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = p_org_id AND m.user_id = auth.uid() AND m.role = 'admin');
$function$;
REVOKE EXECUTE ON FUNCTION public.is_org_admin(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_org_admin(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.device_contacts (
  device_id         uuid NOT NULL,
  name              text,                -- "Fam. Jansen" / voornaam
  email             text,                -- voor het rapport
  address_note      text,                -- straat + huisnummer of "flat 3-hoog links"
  report_consent_at timestamp with time zone,   -- bewoner wil rapporten per e-mail
  source            text DEFAULT 'wizard'::text NOT NULL,  -- 'wizard' | 'admin'
  created_at        timestamp with time zone DEFAULT now() NOT NULL,
  updated_at        timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT device_contacts_pkey PRIMARY KEY (device_id),
  CONSTRAINT device_contacts_device_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE
);
ALTER TABLE public.device_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "device_contacts_admin_all" ON public.device_contacts;
CREATE POLICY "device_contacts_admin_all" ON public.device_contacts AS PERMISSIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.devices d WHERE d.id = device_id AND d.org_id IS NOT NULL AND public.is_org_admin(d.org_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.devices d WHERE d.id = device_id AND d.org_id IS NOT NULL AND public.is_org_admin(d.org_id)));
REVOKE ALL ON public.device_contacts FROM anon;
