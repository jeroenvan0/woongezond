-- Vervolg op 20260907200000: de admin-check in de serie-RPC's één keer per query berekenen
-- (CTE) in plaats van per rij in de WHERE. Zelfde semantiek: eigen rijen altijd; een gekozen
-- device ook als de aanroeper admin is van de org van dat device. Zonder device blijft het
-- "alle eigen sensoren".

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
      (now() - make_interval(mins => minutes)) as since,
      auth.uid() as uid,
      (p_device_id is not null and public.device_in_my_admin_org(p_device_id)) as admin_ok
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
    and (p_device_id is null or a.device_id = p_device_id)   -- B3: kamer-scoping
    and (a.user_id = p.uid or p.admin_ok)                     -- pilot: org-admin
  group by 1, p.bucket_seconds
  order by 1;
$function$;

CREATE OR REPLACE FUNCTION public.air_quality_raw_count(minutes integer, p_device_id uuid DEFAULT NULL)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with params as (
    select (now() - make_interval(mins => minutes)) as since,
           auth.uid() as uid,
           (p_device_id is not null and public.device_in_my_admin_org(p_device_id)) as admin_ok
  )
  select count(*)
  from public.air_quality a
  cross join params p
  where a.created_at >= p.since
    and (p_device_id is null or a.device_id = p_device_id)
    and (a.user_id = p.uid or p.admin_ok);
$function$;

REVOKE EXECUTE ON FUNCTION public.air_quality_bucketed(integer, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.air_quality_bucketed(integer, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.air_quality_raw_count(integer, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.air_quality_raw_count(integer, uuid) TO authenticated;
