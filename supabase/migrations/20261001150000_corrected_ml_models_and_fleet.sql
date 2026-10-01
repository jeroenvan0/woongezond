-- Gecorrigeerde temperatuur (20261001120000) ook voor het ML-model en het corporatieoverzicht.
--
-- ML: dev traint op temperature_corrected/humidity_corrected. Een tweede rij per gebruiker in
-- ml_models kan niet: prod leest daar `.eq('user_id', …).limit(1)` zonder bronfilter en zou
-- zo een gecorrigeerd model kunnen pakken. Daarom een eigen tabel met dezelfde vorm en
-- dezelfde RLS. Gaat prod ook over op gecorrigeerd, dan kan dit samen in ml_models met een
-- kolom temperature_source (WISHLIST §6).

CREATE TABLE public.ml_models_corrected (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  weights      jsonb,
  trained_at   timestamptz DEFAULT now(),
  sample_count integer,
  metrics      jsonb
);
COMMENT ON TABLE public.ml_models_corrected IS
  'ML-model getraind op temperature_corrected/humidity_corrected (dev). Zelfde vorm als ml_models.';

ALTER TABLE public.ml_models_corrected ENABLE ROW LEVEL SECURITY;
CREATE POLICY ml_models_corrected_own ON public.ml_models_corrected
  FOR ALL USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
REVOKE ALL ON public.ml_models_corrected FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ml_models_corrected TO authenticated, service_role;

-- Corporatieoverzicht: naast de laatste gemeten T/RV en de ernst daarop ook de gecorrigeerde
-- varianten. Bestaande kolommen houden naam en betekenis, dus de prod-build merkt niets.
-- Return-type verandert → DROP + CREATE.

DROP FUNCTION IF EXISTS public.fleet_overview(uuid);

CREATE FUNCTION public.fleet_overview(p_org_id uuid)
 RETURNS TABLE(
   consent_id uuid, label text, device_count integer, last_seen timestamp with time zone,
   minutes_since integer, stale boolean,
   co2_latest numeric, rh_latest numeric, temp_latest numeric, severity text,
   rh_latest_corrected numeric, temp_latest_corrected numeric, severity_corrected text
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH allowed AS (
    SELECT c.id AS consent_id, c.resident_id, c.label
    FROM public.household_consents c
    WHERE c.org_id = p_org_id
      AND c.revoked_at IS NULL
      AND public.is_org_member(p_org_id)
  ),
  latest AS (
    SELECT DISTINCT ON (a.user_id)
      a.user_id, a.created_at, a.co2, a.temperature, a.humidity,
      a.temperature_corrected, a.humidity_corrected
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
    CASE
      WHEN l.created_at IS NULL
        OR (now() - l.created_at) > interval '30 minutes' THEN 'warn'
      WHEN l.co2 >= 1500 OR l.humidity >= 80 THEN 'crit'
      WHEN l.co2 >= 1200 OR l.humidity >= 70 THEN 'warn'
      ELSE 'ok'
    END                                                                        AS severity,
    l.humidity_corrected::numeric,
    l.temperature_corrected::numeric,
    CASE
      WHEN l.created_at IS NULL
        OR (now() - l.created_at) > interval '30 minutes' THEN 'warn'
      WHEN l.co2 >= 1500 OR l.humidity_corrected >= 80 THEN 'crit'
      WHEN l.co2 >= 1200 OR l.humidity_corrected >= 70 THEN 'warn'
      ELSE 'ok'
    END                                                                        AS severity_corrected
  FROM allowed al
  LEFT JOIN latest l ON l.user_id = al.resident_id
  LEFT JOIN dev     ON dev.user_id = al.resident_id
  ORDER BY
    CASE
      WHEN l.created_at IS NULL OR (now() - l.created_at) > interval '30 minutes' THEN 1
      WHEN l.co2 >= 1500 OR l.humidity >= 80 THEN 0
      WHEN l.co2 >= 1200 OR l.humidity >= 70 THEN 1
      ELSE 2
    END,
    l.created_at ASC NULLS FIRST;
$function$;

REVOKE EXECUTE ON FUNCTION public.fleet_overview(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fleet_overview(uuid) TO authenticated, service_role;
