-- B3 + A3 — per-device scoping voor grafiekdata, en een EERLIJKE ruwe telling.
--
-- Ontwerp: docs/b3-a3-device-scoping.md
--
-- B3: air_quality_bucketed krijgt een optionele device_id-param zodat de bewoner-app
--     per kamer (device) kan tonen i.p.v. alle devices door elkaar te mengen.
-- A3: air_quality_raw_count geeft de ECHTE ruwe rij-telling voor het venster. Vandaag
--     rapporteert /api/data rawCount = aantal buckets (tot 360x te laag) — een
--     UI-zichtbare onwaarheid (KI-1's open staart). Dit sluit die.
--
-- Beide functies draaien als de AANROEPER (geen SECURITY DEFINER), dus de bestaande
-- air_quality RLS ("select own") blijft de grens; de user_id-filter is redundant-veilig.

-- Vervang de één-arg versie door een versie met optionele device-param. De defaulted
-- param laat bestaande aanroepen — air_quality_bucketed(minutes := N) — ongewijzigd werken.
DROP FUNCTION IF EXISTS public.air_quality_bucketed(integer);

CREATE OR REPLACE FUNCTION public.air_quality_bucketed(minutes integer, p_device_id uuid DEFAULT NULL)
 RETURNS TABLE(created_at timestamp with time zone, co2 numeric, temperature numeric, humidity numeric, bucket_seconds integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with params as (
    select
      case
        when minutes <= 360    then 60      -- ≤6h   → 1 min
        when minutes <= 1440   then 120     -- ≤24h  → 2 min
        when minutes <= 4320   then 300     -- ≤3d   → 5 min
        when minutes <= 10080  then 900     -- ≤7d   → 15 min
        when minutes <= 43200  then 3600    -- ≤30d  → 1 h
        when minutes <= 129600 then 10800   -- ≤90d  → 3 h
        when minutes <= 525600 then 43200   -- ≤1yr  → 12 h
        else 86400                          -- >1yr  → 1 d
      end as bucket_seconds,
      (now() - make_interval(mins => minutes)) as since
  )
  select
    to_timestamp(floor(extract(epoch from a.created_at) / p.bucket_seconds) * p.bucket_seconds) as created_at,
    avg(a.co2)::numeric         as co2,
    avg(a.temperature)::numeric as temperature,
    avg(a.humidity)::numeric    as humidity,
    p.bucket_seconds
  from public.air_quality a
  cross join params p
  where a.created_at >= p.since
    and a.user_id = auth.uid()
    and (p_device_id is null or a.device_id = p_device_id)   -- B3: kamer-scoping
  group by 1, p.bucket_seconds
  order by 1;
$function$;

-- A3: echte ruwe telling voor hetzelfde venster (en optioneel device). Lichtgewicht:
-- één count over de (user_id, created_at) index; geen rijen terug, alleen het getal.
CREATE OR REPLACE FUNCTION public.air_quality_raw_count(minutes integer, p_device_id uuid DEFAULT NULL)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select count(*)
  from public.air_quality a
  where a.created_at >= (now() - make_interval(mins => minutes))
    and a.user_id = auth.uid()
    and (p_device_id is null or a.device_id = p_device_id);
$function$;

-- Grants gelijk aan de rest van de client-RPC's.
REVOKE EXECUTE ON FUNCTION public.air_quality_bucketed(integer, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.air_quality_bucketed(integer, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.air_quality_raw_count(integer, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.air_quality_raw_count(integer, uuid) TO authenticated;
