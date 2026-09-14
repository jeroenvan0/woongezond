-- Grafiekreeks: blokgrootte op basis van de data die er ÉCHT is, plus laagste/hoogste per blok.
--
-- Probleem: de blokgrootte hing alleen aan de gevraagde periode. "1 jaar" gaf altijd
-- 12-uursblokken, ook voor een sensor die drie dagen meet — dan bleven er twee punten over.
-- En een gemiddelde per blok vlakt precies de pieken en dalen weg waar het om gaat.
--
-- Nu: de periode is alleen het PLAFOND (nooit grover dan vroeger); de spanne van de
-- aanwezige metingen kiest het kleinste blok uit de ladder dat in ≤1000 punten past. Vult
-- de data de hele periode, dan komt de oude ladder er precies uit. Elk blok krijgt naast
-- het gemiddelde ook min en max (band in de grafiek) en het aantal metingen.
-- Spiegel in TypeScript: lib/bucketing.ts (fallback-pad + tests). Houd ze gelijk.
--
-- Het return-type verandert, dus DROP + CREATE (CREATE OR REPLACE kan dat niet). De app
-- leest alleen benoemde kolommen, dus een oudere build blijft werken op de nieuwe functie.

DROP FUNCTION IF EXISTS public.air_quality_bucketed(integer, uuid);

CREATE FUNCTION public.air_quality_bucketed(minutes integer, p_device_id uuid DEFAULT NULL)
 RETURNS TABLE(
   created_at timestamp with time zone,
   co2 numeric, temperature numeric, humidity numeric,
   bucket_seconds integer,
   co2_min numeric, co2_max numeric,
   temperature_min numeric, temperature_max numeric,
   humidity_min numeric, humidity_max numeric,
   n integer
 )
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with params as (
    select
      (now() - make_interval(mins => minutes)) as since,
      auth.uid() as uid,
      (p_device_id is not null and public.device_in_my_admin_org(p_device_id)) as admin_ok,
      case                                    -- plafond: de oude vaste ladder
        when minutes <= 360    then 60
        when minutes <= 1440   then 120
        when minutes <= 4320   then 300
        when minutes <= 10080  then 900
        when minutes <= 43200  then 3600
        when minutes <= 129600 then 10800
        when minutes <= 525600 then 43200
        else 86400
      end as cap_seconds
  ),
  span as (
    select extract(epoch from (max(a.created_at) - min(a.created_at))) as span_s
    from public.air_quality a
    cross join params p
    where a.created_at >= p.since
      and (p_device_id is null or a.device_id = p_device_id)
      and (a.user_id = p.uid or p.admin_ok)
  ),
  bucket as (
    select least(
      p.cap_seconds,
      coalesce(
        (select min(s) from unnest(array[60,120,300,600,900,1800,3600,7200,10800,21600,43200,86400]) as s
          where s >= coalesce(sp.span_s, 0) / 1000.0),     -- ladderstap voor ≤1000 punten
        86400)
    )::int as bucket_seconds
    from params p cross join span sp
  )
  select
    to_timestamp(floor(extract(epoch from a.created_at) / b.bucket_seconds) * b.bucket_seconds) as created_at,
    avg(a.co2)::numeric         as co2,
    avg(a.temperature)::numeric as temperature,
    avg(a.humidity)::numeric    as humidity,
    b.bucket_seconds,
    min(a.co2)::numeric         as co2_min,
    max(a.co2)::numeric         as co2_max,
    min(a.temperature)::numeric as temperature_min,
    max(a.temperature)::numeric as temperature_max,
    min(a.humidity)::numeric    as humidity_min,
    max(a.humidity)::numeric    as humidity_max,
    count(*)::int               as n
  from public.air_quality a
  cross join params p
  cross join bucket b
  where a.created_at >= p.since
    and (p_device_id is null or a.device_id = p_device_id)   -- B3: kamer-scoping
    and (a.user_id = p.uid or p.admin_ok)                     -- pilot: org-admin
  group by 1, b.bucket_seconds
  order by 1;
$function$;

REVOKE EXECUTE ON FUNCTION public.air_quality_bucketed(integer, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.air_quality_bucketed(integer, uuid) TO authenticated;
