-- Admin-leesregel op air_quality: de apparaatlijst één keer per query, niet de check per rij.
--
-- 20260907200000 gaf org-admins leesrecht met USING (device_in_my_admin_org(device_id)). Postgres
-- voert RLS-voorwaarden uit vóór de eigen filters van een query, dus die functie liep voor élke
-- rij in het venster die niet van de gebruiker zelf is — ook bij een bewoner die geen admin is.
-- Bij 90 dagen zonder device-filter waren dat ~110 000 aanroepen: 2,5–2,9 s voor een telling van
-- 12 600 eigen metingen, en elke dag trager omdat er meer sensoren per minuut meten.
--
-- Nu: de apparaten waarvan je org-admin bent als één array, in een scalaire subquery (InitPlan,
-- één keer uitgevoerd), en per rij alleen een array-vergelijking. Wie wat mag lezen verandert niet.

CREATE OR REPLACE FUNCTION public.my_admin_device_ids()
 RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce(array_agg(d.id), '{}'::uuid[])
  FROM public.devices d
  JOIN public.org_members m ON m.org_id = d.org_id
  WHERE d.org_id IS NOT NULL AND m.user_id = auth.uid() AND m.role = 'admin';
$function$;
REVOKE EXECUTE ON FUNCTION public.my_admin_device_ids() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.my_admin_device_ids() TO authenticated;

DROP POLICY IF EXISTS "air_quality_select_org_admin" ON public.air_quality;
CREATE POLICY "air_quality_select_org_admin" ON public.air_quality AS PERMISSIVE FOR SELECT TO authenticated
  -- De cast is nodig: zonder leest Postgres "= ANY ((SELECT …))" als subquery (uuid = uuid[]).
  USING (device_id = ANY ((SELECT public.my_admin_device_ids())::uuid[]));

-- Terugdraaien:
--   DROP POLICY "air_quality_select_org_admin" ON public.air_quality;
--   CREATE POLICY "air_quality_select_org_admin" ON public.air_quality AS PERMISSIVE FOR SELECT TO authenticated
--     USING (device_id IS NOT NULL AND public.device_in_my_admin_org(device_id));
