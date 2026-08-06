-- Device provisioning — corporatie beheert apparaten, QR-koppeling door de bewoner,
-- huisprofiel + plaatsingsfoto's. Ontwerp: docs/device-provisioning-design.md.
--
-- Additief en veilig: bestaande owner-RLS op devices blijft; org-leden krijgen er een
-- OR-tak bij. user_id wordt nullable zodat een geprovisioned-maar-ongeclaimd apparaat kan
-- bestaan (onzichtbaar voor bewoners, want auth.uid() = NULL matcht nooit).

-- ----------------------------------------------------------------------------
-- devices: koppeling aan een corporatie + huisprofiel; user_id nullable.
-- ----------------------------------------------------------------------------
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS build_year integer;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS house_type text;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS placement_note text;
ALTER TABLE public.devices ALTER COLUMN user_id DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.devices
    ADD CONSTRAINT devices_org_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_devices_org ON public.devices USING btree (org_id);

-- Helper: is p_device_id een apparaat van een org waar ik lid van ben? SECURITY DEFINER
-- zodat policy-subqueries niet zelf door devices-RLS hoeven (geen recursie).
CREATE OR REPLACE FUNCTION public.device_in_my_org(p_device_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.devices d
    JOIN public.org_members m ON m.org_id = d.org_id
    WHERE d.id = p_device_id AND d.org_id IS NOT NULL AND m.user_id = auth.uid()
  );
$function$;
REVOKE EXECUTE ON FUNCTION public.device_in_my_org(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.device_in_my_org(uuid) TO authenticated;

-- devices RLS — org-leden beheren de apparaten van hun org (additief naast owner-policies).
DROP POLICY IF EXISTS "devices_select_org" ON public.devices;
CREATE POLICY "devices_select_org" ON public.devices AS PERMISSIVE FOR SELECT TO authenticated
  USING (org_id IS NOT NULL AND public.is_org_member(org_id));

DROP POLICY IF EXISTS "devices_insert_org" ON public.devices;
CREATE POLICY "devices_insert_org" ON public.devices AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (org_id IS NOT NULL AND public.is_org_member(org_id));

DROP POLICY IF EXISTS "devices_update_org" ON public.devices;
CREATE POLICY "devices_update_org" ON public.devices AS PERMISSIVE FOR UPDATE TO authenticated
  USING (org_id IS NOT NULL AND public.is_org_member(org_id))
  WITH CHECK (org_id IS NOT NULL AND public.is_org_member(org_id));

-- ----------------------------------------------------------------------------
-- Koppelcodes (QR / handmatig). Spiegelt org_invites.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_claim_codes (
  id          uuid DEFAULT gen_random_uuid() NOT NULL,
  device_id   uuid NOT NULL,
  code        text NOT NULL,
  expires_at  timestamp with time zone,
  used_at     timestamp with time zone,
  redeemed_by uuid,
  created_at  timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT device_claim_codes_pkey PRIMARY KEY (id),
  CONSTRAINT device_claim_codes_device_fkey   FOREIGN KEY (device_id)   REFERENCES public.devices(id)  ON DELETE CASCADE,
  CONSTRAINT device_claim_codes_redeemer_fkey FOREIGN KEY (redeemed_by) REFERENCES auth.users(id)      ON DELETE SET NULL,
  CONSTRAINT device_claim_codes_code_unique   UNIQUE (code)
);
CREATE INDEX IF NOT EXISTS idx_device_claim_codes_device ON public.device_claim_codes USING btree (device_id);
ALTER TABLE public.device_claim_codes ENABLE ROW LEVEL SECURITY;

-- Alleen org-leden van het apparaat beheren de codes. Bewoners koppelen via redeem_device_claim.
DROP POLICY IF EXISTS "claim_codes_org_all" ON public.device_claim_codes;
CREATE POLICY "claim_codes_org_all" ON public.device_claim_codes AS PERMISSIVE FOR ALL TO authenticated
  USING (public.device_in_my_org(device_id))
  WITH CHECK (public.device_in_my_org(device_id));

-- ----------------------------------------------------------------------------
-- Foto's (plaatsing nu; grond-waarheid/observatie later — B1).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_photos (
  id           uuid DEFAULT gen_random_uuid() NOT NULL,
  device_id    uuid NOT NULL,
  storage_path text NOT NULL,
  caption      text,
  kind         text DEFAULT 'placement'::text NOT NULL,
  created_by   uuid,
  created_at   timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT device_photos_pkey PRIMARY KEY (id),
  CONSTRAINT device_photos_device_fkey  FOREIGN KEY (device_id)  REFERENCES public.devices(id) ON DELETE CASCADE,
  CONSTRAINT device_photos_creator_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)     ON DELETE SET NULL,
  CONSTRAINT device_photos_kind_chk     CHECK (kind IN ('placement', 'observation'))
);
CREATE INDEX IF NOT EXISTS idx_device_photos_device ON public.device_photos USING btree (device_id);
ALTER TABLE public.device_photos ENABLE ROW LEVEL SECURITY;

-- Zichtbaar/beheerbaar voor de apparaat-eigenaar (bewoner) én org-leden van het apparaat.
DROP POLICY IF EXISTS "device_photos_select" ON public.device_photos;
CREATE POLICY "device_photos_select" ON public.device_photos AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.device_in_my_org(device_id)
      OR EXISTS (SELECT 1 FROM public.devices d WHERE d.id = device_id AND d.user_id = (select auth.uid())));

DROP POLICY IF EXISTS "device_photos_insert" ON public.device_photos;
CREATE POLICY "device_photos_insert" ON public.device_photos AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (public.device_in_my_org(device_id)
      OR EXISTS (SELECT 1 FROM public.devices d WHERE d.id = device_id AND d.user_id = (select auth.uid())));

DROP POLICY IF EXISTS "device_photos_delete" ON public.device_photos;
CREATE POLICY "device_photos_delete" ON public.device_photos AS PERMISSIVE FOR DELETE TO authenticated
  USING (public.device_in_my_org(device_id)
      OR EXISTS (SELECT 1 FROM public.devices d WHERE d.id = device_id AND d.user_id = (select auth.uid())));

-- ----------------------------------------------------------------------------
-- Koppel-RPC — de bewoner claimt een apparaat via de code.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_device_claim(p_code text)
 RETURNS TABLE(device_id uuid, device_name text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_row  public.device_claim_codes%ROWTYPE;
  v_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_row FROM public.device_claim_codes c
  WHERE c.code = p_code AND c.used_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > now())
  LIMIT 1;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'claim_invalid'; END IF;

  UPDATE public.devices SET user_id = v_uid WHERE id = v_row.device_id;
  UPDATE public.device_claim_codes SET used_at = now(), redeemed_by = v_uid WHERE id = v_row.id;

  SELECT name INTO v_name FROM public.devices WHERE id = v_row.device_id;
  RETURN QUERY SELECT v_row.device_id, v_name;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.redeem_device_claim(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.redeem_device_claim(text) TO authenticated;

-- ----------------------------------------------------------------------------
-- Storage-bucket voor foto's + policies (pad = "<device_id>/<bestand>").
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('device-photos', 'device-photos', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "device_photos_obj_read" ON storage.objects;
CREATE POLICY "device_photos_obj_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'device-photos' AND (
    public.device_in_my_org(((storage.foldername(name))[1])::uuid)
    OR EXISTS (SELECT 1 FROM public.devices d WHERE d.id = ((storage.foldername(name))[1])::uuid AND d.user_id = (select auth.uid()))
  ));

DROP POLICY IF EXISTS "device_photos_obj_write" ON storage.objects;
CREATE POLICY "device_photos_obj_write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'device-photos' AND (
    public.device_in_my_org(((storage.foldername(name))[1])::uuid)
    OR EXISTS (SELECT 1 FROM public.devices d WHERE d.id = ((storage.foldername(name))[1])::uuid AND d.user_id = (select auth.uid()))
  ));

DROP POLICY IF EXISTS "device_photos_obj_delete" ON storage.objects;
CREATE POLICY "device_photos_obj_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'device-photos' AND (
    public.device_in_my_org(((storage.foldername(name))[1])::uuid)
    OR EXISTS (SELECT 1 FROM public.devices d WHERE d.id = ((storage.foldername(name))[1])::uuid AND d.user_id = (select auth.uid()))
  ));
