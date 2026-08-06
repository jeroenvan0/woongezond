-- C1 — Corporatie-rol & vlootoverzicht: org/lidmaatschap/toestemming + aggregatie-RPC.
--
-- Ontwerp: docs/corporatie-fleet-design.md
--
-- Kern: een corporatie-gebruiker leest NOOIT ruwe bewonersrijen. De hot-path RLS op
-- air_quality (zescijferig, groeit ~10x in de pilot) blijft onaangeraakt. In plaats
-- daarvan levert fleet_overview() — SECURITY DEFINER — per-woning AGGREGATEN voor alleen
-- woningen die expliciet toestemming gaven. Dit spiegelt de /api/health publiek-vs-detail
-- split en DECISIONS D1 (apparaatnamen zijn voornamen van bewoners; nooit lekken).

-- ----------------------------------------------------------------------------
-- Tabellen
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organizations (
  id         uuid DEFAULT gen_random_uuid() NOT NULL,
  name       text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT organizations_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.org_members (
  id         uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id     uuid NOT NULL,
  user_id    uuid NOT NULL,
  role       text DEFAULT 'viewer'::text NOT NULL,   -- 'admin' | 'viewer'
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT org_members_pkey PRIMARY KEY (id),
  CONSTRAINT org_members_org_fkey  FOREIGN KEY (org_id)  REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT org_members_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)          ON DELETE CASCADE,
  CONSTRAINT org_members_role_chk  CHECK (role IN ('admin', 'viewer')),
  CONSTRAINT org_members_unique     UNIQUE (org_id, user_id)
);

-- De kern van het toestemmingsmodel: de bewoner (resident_id = household) geeft ÉÉN
-- corporatie inzage. De corporatie kan deze rij niet zelf aanmaken (zie RLS).
CREATE TABLE IF NOT EXISTS public.household_consents (
  id          uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id      uuid NOT NULL,
  resident_id uuid NOT NULL,
  label       text,                                   -- gepseudonimiseerd; NOOIT de device-naam
  granted_at  timestamp with time zone DEFAULT now() NOT NULL,
  revoked_at  timestamp with time zone,               -- null = actief
  CONSTRAINT household_consents_pkey PRIMARY KEY (id),
  CONSTRAINT household_consents_org_fkey      FOREIGN KEY (org_id)      REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT household_consents_resident_fkey FOREIGN KEY (resident_id) REFERENCES auth.users(id)           ON DELETE CASCADE,
  CONSTRAINT household_consents_unique         UNIQUE (org_id, resident_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user            ON public.org_members        USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org             ON public.org_members        USING btree (org_id);
CREATE INDEX IF NOT EXISTS idx_household_consents_org      ON public.household_consents USING btree (org_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_household_consents_resident ON public.household_consents USING btree (resident_id);

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
ALTER TABLE public.organizations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_consents  ENABLE ROW LEVEL SECURITY;

-- Helper: is de aanroeper lid van deze org? SECURITY DEFINER zodat de policy-subquery
-- niet zelf door org_members-RLS hoeft (voorkomt recursie) en één InitPlan blijft.
CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.org_id = p_org_id AND m.user_id = auth.uid()
  );
$function$;
REVOKE EXECUTE ON FUNCTION public.is_org_member(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated;

-- organizations: leden zien hun eigen org(s). Aanmaken/wijzigen gaat via service_role
-- (seed/admin), niet via de client — de pilot heeft één corporatie.
DROP POLICY IF EXISTS "organizations_select_member" ON public.organizations;
CREATE POLICY "organizations_select_member" ON public.organizations AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_org_member(id));

-- org_members: een lid ziet de ledenlijst van zijn eigen org(s).
DROP POLICY IF EXISTS "org_members_select_same_org" ON public.org_members;
CREATE POLICY "org_members_select_same_org" ON public.org_members AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

-- household_consents:
--   * de BEWONER beheert zijn eigen toestemmingen (zien / geven / intrekken).
--   * een ORG-LID ziet de (label-)rijen van zijn eigen org, om het vlootoverzicht te labelen.
-- De corporatie kan GEEN toestemming aanmaken of resident_id wijzigen — alleen de bewoner.
DROP POLICY IF EXISTS "consents_resident_select" ON public.household_consents;
CREATE POLICY "consents_resident_select" ON public.household_consents AS PERMISSIVE FOR SELECT TO authenticated
  USING (((select auth.uid()) = resident_id) OR public.is_org_member(org_id));

DROP POLICY IF EXISTS "consents_resident_insert" ON public.household_consents;
CREATE POLICY "consents_resident_insert" ON public.household_consents AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((select auth.uid()) = resident_id));

DROP POLICY IF EXISTS "consents_resident_update" ON public.household_consents;
CREATE POLICY "consents_resident_update" ON public.household_consents AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((select auth.uid()) = resident_id))
  WITH CHECK (((select auth.uid()) = resident_id));

-- ----------------------------------------------------------------------------
-- Aggregatie-RPC — het enige venster dat de corporatie op bewonersdata heeft.
--
-- Geeft per WONING (consent) alleen aggregaten: versheid + laatste T/RH/CO2 + een
-- server-afgeleide severity voor de ranking. GEEN device-namen, coördinaten of ruwe
-- reeksen. Toegang: aanroeper moet lid van p_org_id zijn, anders lege set.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fleet_overview(p_org_id uuid)
 RETURNS TABLE(
   consent_id    uuid,
   label         text,
   device_count  integer,
   last_seen     timestamp with time zone,
   minutes_since integer,
   stale         boolean,
   co2_latest    numeric,
   rh_latest     numeric,
   temp_latest   numeric,
   severity      text
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH allowed AS (
    SELECT c.id AS consent_id, c.resident_id, c.label
    FROM public.household_consents c
    WHERE c.org_id = p_org_id
      AND c.revoked_at IS NULL
      -- Toegangspoort: lege set als de aanroeper geen lid is van deze org.
      AND public.is_org_member(p_org_id)
  ),
  latest AS (
    SELECT DISTINCT ON (a.user_id)
      a.user_id, a.created_at, a.co2, a.temperature, a.humidity
    FROM public.air_quality a
    JOIN allowed al ON al.resident_id = a.user_id
    ORDER BY a.user_id, a.created_at DESC
  ),
  dev AS (
    SELECT d.user_id, count(*)::int AS device_count
    FROM public.devices d
    JOIN allowed al ON al.resident_id = d.user_id
    WHERE d.active = true
    GROUP BY d.user_id
  )
  SELECT
    al.consent_id,
    al.label,
    COALESCE(dev.device_count, 0)                                              AS device_count,
    l.created_at                                                               AS last_seen,
    CASE WHEN l.created_at IS NULL THEN NULL
         ELSE floor(extract(epoch FROM (now() - l.created_at)) / 60)::int END  AS minutes_since,
    (l.created_at IS NULL
       OR (now() - l.created_at) > interval '30 minutes')                      AS stale,
    l.co2::numeric,
    l.humidity::numeric,
    l.temperature::numeric,
    -- Server-afgeleide severity zodat de ranking niet van de client afhangt.
    -- Drempels sluiten aan op de app-defaults (CO2 1200/1500, RV 70/80). Een stale
    -- woning is minstens 'warn' — hij vertelt niets meer.
    CASE
      WHEN l.created_at IS NULL
        OR (now() - l.created_at) > interval '30 minutes' THEN 'warn'
      WHEN l.co2 >= 1500 OR l.humidity >= 80 THEN 'crit'
      WHEN l.co2 >= 1200 OR l.humidity >= 70 THEN 'warn'
      ELSE 'ok'
    END                                                                        AS severity
  FROM allowed al
  LEFT JOIN latest l ON l.user_id = al.resident_id
  LEFT JOIN dev     ON dev.user_id = al.resident_id
  ORDER BY
    -- crit eerst, dan warn, dan ok; binnen gelijke severity de meest stale bovenaan.
    CASE
      WHEN l.created_at IS NULL OR (now() - l.created_at) > interval '30 minutes' THEN 1
      WHEN l.co2 >= 1500 OR l.humidity >= 80 THEN 0
      WHEN l.co2 >= 1200 OR l.humidity >= 70 THEN 1
      ELSE 2
    END,
    l.created_at ASC NULLS FIRST;
$function$;

REVOKE EXECUTE ON FUNCTION public.fleet_overview(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fleet_overview(uuid) TO authenticated;
