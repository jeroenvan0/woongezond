-- C1 (vervolg) — consent-beheer voor de bewoner: invite-codes + inwissel-RPC.
--
-- Ontwerp: docs/corporatie-fleet-design.md §5 (privacy & toestemming).
--
-- Probleem: een bewoner mag organizations NIET zien (RLS = alleen leden), dus kan geen
-- org kiezen om toestemming aan te geven. Oplossing, passend bij de firmware-provisioning
-- "claim via code"-filosofie: de corporatie geeft een INVITE-CODE uit met een vooraf
-- ingevuld (gepseudonimiseerd) label; de bewoner wisselt die in. De org-lijst blijft
-- verborgen voor bewoners; de corporatie bepaalt het label vooraf.

-- ----------------------------------------------------------------------------
-- Invite-tabel
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.org_invites (
  id          uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id      uuid NOT NULL,
  code        text NOT NULL,
  label       text,                                   -- vooraf ingevuld woninglabel (gepseudonimiseerd)
  expires_at  timestamp with time zone,               -- null = verloopt niet
  used_at     timestamp with time zone,               -- null = nog niet ingewisseld
  redeemed_by uuid,                                    -- de bewoner die inwisselde
  created_at  timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT org_invites_pkey PRIMARY KEY (id),
  CONSTRAINT org_invites_org_fkey      FOREIGN KEY (org_id)      REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT org_invites_redeemer_fkey FOREIGN KEY (redeemed_by) REFERENCES auth.users(id)           ON DELETE SET NULL,
  CONSTRAINT org_invites_code_unique   UNIQUE (code)
);
CREATE INDEX IF NOT EXISTS idx_org_invites_org ON public.org_invites USING btree (org_id);

ALTER TABLE public.org_invites ENABLE ROW LEVEL SECURITY;

-- Alleen org-leden beheren de invites van hun eigen org. Bewoners lezen invites NOOIT
-- direct — ze wisselen in via redeem_org_invite() (SECURITY DEFINER, hieronder).
DROP POLICY IF EXISTS "org_invites_member_select" ON public.org_invites;
CREATE POLICY "org_invites_member_select" ON public.org_invites AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS "org_invites_member_insert" ON public.org_invites;
CREATE POLICY "org_invites_member_insert" ON public.org_invites AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(org_id));

DROP POLICY IF EXISTS "org_invites_member_update" ON public.org_invites;
CREATE POLICY "org_invites_member_update" ON public.org_invites AS PERMISSIVE FOR UPDATE TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

-- ----------------------------------------------------------------------------
-- organizations: een bewoner mag de org(en) zien waarmee hij een ACTIEVE toestemming
-- heeft, puur om de naam in zijn deel-overzicht te tonen. (Additief naast de bestaande
-- member-policy; twee PERMISSIVE SELECT-policies = OR.) De subquery blijft binnen de
-- eigen household_consents-zichtbaarheid, dus geen recursie.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "organizations_select_consented" ON public.organizations;
CREATE POLICY "organizations_select_consented" ON public.organizations AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.household_consents c
    WHERE c.org_id = organizations.id
      AND c.resident_id = (select auth.uid())
      AND c.revoked_at IS NULL
  ));

-- ----------------------------------------------------------------------------
-- Inwissel-RPC — draait als de BEWONER (SECURITY DEFINER, maar schrijft alleen voor
-- auth.uid()). Valideert de code, maakt/heractiveert de toestemming, markeert de invite.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_org_invite(p_code text)
 RETURNS TABLE(org_id uuid, org_name text, label text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_invite public.org_invites%ROWTYPE;
  v_name   text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_invite
  FROM public.org_invites i
  WHERE i.code = p_code
    AND i.used_at IS NULL
    AND (i.expires_at IS NULL OR i.expires_at > now())
  LIMIT 1;

  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION 'invite_invalid';
  END IF;

  -- Toestemming aanmaken of — als de bewoner eerder introk — heractiveren.
  INSERT INTO public.household_consents (org_id, resident_id, label)
  VALUES (v_invite.org_id, v_uid, v_invite.label)
  ON CONFLICT (org_id, resident_id)
  DO UPDATE SET revoked_at = NULL,
                label = COALESCE(EXCLUDED.label, public.household_consents.label);

  UPDATE public.org_invites
  SET used_at = now(), redeemed_by = v_uid
  WHERE id = v_invite.id;

  SELECT o.name INTO v_name FROM public.organizations o WHERE o.id = v_invite.org_id;
  RETURN QUERY SELECT v_invite.org_id, v_name, v_invite.label;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.redeem_org_invite(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.redeem_org_invite(text) TO authenticated;
