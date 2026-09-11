-- Pilot-cockpit (docs/pilot-cockpit-plan.md §4): org-ADMINS zien de metingen van alle
-- apparaten in hun org, ook nadat een bewoner de sensor heeft geclaimd. Tot nu toe gold
-- alleen "select own" op air_quality, waardoor het admin-dashboard en de cockpit een
-- gekoppelde sensor wel in de lijst zagen maar geen enkele meting.
--
-- Alleen admins (org_members.role = 'admin'); gewone org-leden (corporatie-view /vloot)
-- blijven op aggregaten + consent. De serie-RPC's hadden een eigen user_id-filter
-- (redundant naast RLS); die krijgen dezelfde admin-uitzondering, maar ALLEEN als er een
-- device is gekozen — zonder device blijft "alle eigen sensoren" bedoeld, niet de hele org.

CREATE OR REPLACE FUNCTION public.device_in_my_admin_org(p_device_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.devices d
    JOIN public.org_members m ON m.org_id = d.org_id
    WHERE d.id = p_device_id AND d.org_id IS NOT NULL AND m.user_id = auth.uid() AND m.role = 'admin'
  );
$function$;
REVOKE EXECUTE ON FUNCTION public.device_in_my_admin_org(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.device_in_my_admin_org(uuid) TO authenticated;

DROP POLICY IF EXISTS "air_quality_select_org_admin" ON public.air_quality;
CREATE POLICY "air_quality_select_org_admin" ON public.air_quality AS PERMISSIVE FOR SELECT TO authenticated
  USING (device_id IS NOT NULL AND public.device_in_my_admin_org(device_id));

-- Per-apparaat venster-queries (admin-pad) lopen op device_id + tijd.
CREATE INDEX IF NOT EXISTS idx_air_quality_device_created ON public.air_quality USING btree (device_id, created_at DESC);

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
    and (p_device_id is null or a.device_id = p_device_id)   -- B3: kamer-scoping
    and (a.user_id = auth.uid()
         or (p_device_id is not null and public.device_in_my_admin_org(p_device_id)))  -- pilot: org-admin
  group by 1, p.bucket_seconds
  order by 1;
$function$;

CREATE OR REPLACE FUNCTION public.air_quality_raw_count(minutes integer, p_device_id uuid DEFAULT NULL)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select count(*)
  from public.air_quality a
  where a.created_at >= (now() - make_interval(mins => minutes))
    and (p_device_id is null or a.device_id = p_device_id)
    and (a.user_id = auth.uid()
         or (p_device_id is not null and public.device_in_my_admin_org(p_device_id)));
$function$;

REVOKE EXECUTE ON FUNCTION public.air_quality_bucketed(integer, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.air_quality_bucketed(integer, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.air_quality_raw_count(integer, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.air_quality_raw_count(integer, uuid) TO authenticated;
