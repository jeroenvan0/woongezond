-- Gecorrigeerde temperatuur en luchtvochtigheid naast de gemeten waarden.
--
-- De SCD41 zit in hetzelfde kastje als de ESP32-S3 en warmt mee: naast een thermostaat
-- leest hij ongeveer 1,5 °C te hoog. De ruwe kolommen `temperature` en `humidity` blijven
-- onaangeroerd; prod (main) blijft die lezen. Dev leest de gecorrigeerde kolommen
-- (TEMPERATURE_SOURCE=corrected, zie lib/readingSource.ts).
--
-- Vocht moet mee. De SCD41 meet de relatieve vochtigheid bij zijn eigen, opgewarmde
-- temperatuur. De hoeveelheid waterdamp (dampspanning e) is in de kamer en in het kastje
-- gelijk, alleen de verzadigingsdampspanning verschilt:
--   RH_kamer = RH_gemeten · e_s(T_gemeten) / e_s(T_kamer)
-- met Magnus (Sonntag 1990, Sensirion-applicatienota): e_s(T) ∝ exp(17,62·T / (243,12 + T)).
-- Bij 21,5 °C / 55 % → 20,0 °C / 60,3 %. Begrensd op 100 %.
--
-- Eén vaste offset voor alle sensoren (besluit 2026-10-01). Aanpassen kan zonder de
-- kolommen te verwijderen (PG17): ALTER TABLE public.air_quality ALTER COLUMN
-- temperature_corrected SET EXPRESSION AS (...) — let op: herschrijft de tabel.
-- Houd de offset gelijk aan TEMPERATURE_OFFSET_C in lib/readingSource.ts.
--
-- Backup naar de VPS: sync.py synchroniseert de doorsnede van kolommen, dus deze twee
-- worden daar overgeslagen (ze zijn uit de ruwe kolommen af te leiden).

ALTER TABLE public.air_quality
  ADD COLUMN temperature_corrected numeric
    GENERATED ALWAYS AS (temperature - 1.5) STORED,
  ADD COLUMN humidity_corrected numeric
    GENERATED ALWAYS AS (
      round(least(100, humidity * exp(
        17.62 * temperature / (243.12 + temperature)
        - 17.62 * (temperature - 1.5) / (243.12 + temperature - 1.5)
      )), 2)
    ) STORED;

COMMENT ON COLUMN public.air_quality.temperature_corrected IS
  'temperature − 1,5 °C (zelfopwarming kastje). Ruwe waarde blijft in temperature.';
COMMENT ON COLUMN public.air_quality.humidity_corrected IS
  'humidity omgerekend naar temperature_corrected bij gelijke dampspanning (Magnus).';

-- Grafiekreeks: dezelfde functie als 20260914120000, plus gemiddelde/min/max van de
-- gecorrigeerde kolommen. De bestaande kolommen houden hun naam en betekenis (ruw), dus
-- de prod-build merkt niets. Return-type verandert → DROP + CREATE.

DROP FUNCTION IF EXISTS public.air_quality_bucketed(integer, uuid);

CREATE FUNCTION public.air_quality_bucketed(minutes integer, p_device_id uuid DEFAULT NULL)
 RETURNS TABLE(
   created_at timestamp with time zone,
   co2 numeric, temperature numeric, humidity numeric,
   bucket_seconds integer,
   co2_min numeric, co2_max numeric,
   temperature_min numeric, temperature_max numeric,
   humidity_min numeric, humidity_max numeric,
   n integer,
   temperature_corrected numeric, humidity_corrected numeric,
   temperature_corrected_min numeric, temperature_corrected_max numeric,
   humidity_corrected_min numeric, humidity_corrected_max numeric
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
    count(*)::int               as n,
    avg(a.temperature_corrected)::numeric as temperature_corrected,
    avg(a.humidity_corrected)::numeric    as humidity_corrected,
    min(a.temperature_corrected)::numeric as temperature_corrected_min,
    max(a.temperature_corrected)::numeric as temperature_corrected_max,
    min(a.humidity_corrected)::numeric    as humidity_corrected_min,
    max(a.humidity_corrected)::numeric    as humidity_corrected_max
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
