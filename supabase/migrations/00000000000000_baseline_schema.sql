-- ============================================================================
-- BASELINE SCHEMA — Woongezond luchtkwaliteit
--
-- Milestone 1 (2026-08-04). Reconstructed by full introspection of the live
-- Supabase Cloud project (vciwibiiisobhotzxcyn) and squashed into one file.
--
-- WHY THIS EXISTS
-- Before this file, supabase/migrations/ held only three late patch migrations
-- that ALTERed an already-existing schema. The ~45 migrations that actually
-- CREATED the schema were never committed — they lived only in the live
-- database. A fresh Supabase instance could not be built from this repo at all,
-- which blocks the planned self-hosted migration (ROADMAP.md, Milestone 5).
--
-- WHAT STATE THIS DESCRIBES
-- This is the schema as it should be AFTER all of Milestone 1's fixes — not a
-- literal photograph of the pre-Milestone-1 database. Specifically it already:
--   * omits five dead quiz-app functions (they referenced dropped tables),
--   * pins search_path on every function,
--   * uses (select auth.uid()) in RLS policies (per-statement, not per-row),
--   * includes the foreign-key indexes added by Milestone 1,
--   * places pg_trgm in the extensions schema rather than public.
-- The separate 20260804* migrations bring the ALREADY-RUNNING database to this
-- same state. A fresh instance gets here directly from this file; the live one
-- gets here via those migrations. Both converge.
--
-- IDEMPOTENT BY DESIGN: every statement is guarded, so re-running this against
-- a database that already has the schema is a no-op rather than an error.
--
-- The pre-Milestone-1 state is preserved in
-- supabase/_snapshots/2026-08-04-pre-milestone-1.sql for rollback.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto   WITH SCHEMA extensions;
-- pg_trgm is currently unused (no trigram indexes exist). Retained because it
-- is already installed on the live database; kept out of `public` per the
-- Supabase database linter (lint 0014_extension_in_public).
CREATE EXTENSION IF NOT EXISTS pg_trgm    WITH SCHEMA extensions;

-- ----------------------------------------------------------------------------
-- Sequences owned by tables below
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.air_quality_id_seq;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

-- Sensor readings. The largest table by far (~115k rows as of 2026-08-04) and
-- the one the whole product is built on.
CREATE TABLE IF NOT EXISTS public.air_quality (
  id bigint DEFAULT nextval('public.air_quality_id_seq'::regclass) NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  co2 integer,
  temperature numeric,
  humidity numeric,
  voc_index integer,
  nox_index integer,
  location text DEFAULT 'feather_s3'::text,
  device_id uuid,
  user_id uuid
);
ALTER SEQUENCE public.air_quality_id_seq OWNED BY public.air_quality.id;

-- Physical sensor devices. Already models user_id -> many devices correctly,
-- even though most surrounding code still assumes one device per user.
CREATE TABLE IF NOT EXISTS public.devices (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  location text,
  type text DEFAULT 'air_quality_sensor'::text,
  active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  lat double precision,
  lon double precision,
  city text,
  city_id uuid,
  insulation text DEFAULT 'poor'::text NOT NULL
);
COMMENT ON COLUMN public.devices.lat IS 'Latitude for OpenWeather API';
COMMENT ON COLUMN public.devices.lon IS 'Longitude for OpenWeather API';
COMMENT ON COLUMN public.devices.city IS 'Human-readable city name (optional override)';
COMMENT ON COLUMN public.devices.insulation IS
  'Wall insulation class -> R_totaal (m2K/W): poor 0.35, moderate 0.90, good 2.50, excellent 4.00';

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid NOT NULL,
  first_name text,
  last_name text,
  email text,
  role text DEFAULT 'user'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cities (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.city_weather (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  city_id uuid NOT NULL,
  observed_at timestamp with time zone NOT NULL,
  temp double precision,
  humidity double precision,
  pressure double precision,
  wind_speed double precision,
  description text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.thresholds (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  device_id uuid,
  metric text NOT NULL,
  warning_value numeric,
  critical_value numeric,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  device_id uuid,
  type text NOT NULL,
  message text NOT NULL,
  read boolean DEFAULT false,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  device_id uuid,
  type text NOT NULL,
  description text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.interventions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  label text NOT NULL,
  notes text DEFAULT ''::text NOT NULL,
  intervention_date date NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.chat_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  title text DEFAULT 'Gesprek'::text NOT NULL,
  message_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  session_id uuid NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  feedback smallint,
  feedback_comment text,
  feedback_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.feedback (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  user_id uuid NOT NULL,
  page text NOT NULL,
  rating smallint NOT NULL,
  comment text,
  user_agent text,
  app_version text
);

CREATE TABLE IF NOT EXISTS public.scenario_snapshots (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  baseline jsonb NOT NULL,
  scenarios jsonb NOT NULL,
  best_scenario_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.scenario_recommendations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  scenario_hash text NOT NULL,
  recommendations jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.scenario_feedback (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  recommendation_id text NOT NULL,
  recommendation_title text,
  was_helpful boolean NOT NULL,
  scenario_snapshot jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.ml_models (
  user_id uuid NOT NULL,
  weights jsonb NOT NULL,
  trained_at timestamp with time zone DEFAULT now() NOT NULL,
  sample_count integer NOT NULL,
  metrics jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS public.ml_feedback (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  recommendation_id text NOT NULL,
  was_helpful boolean NOT NULL,
  scenario_values jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ----------------------------------------------------------------------------
-- Constraints (primary keys, foreign keys, unique, check)
-- Applied through a guarded loop because ALTER TABLE ... ADD CONSTRAINT has no
-- IF NOT EXISTS form.
-- ----------------------------------------------------------------------------
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('air_quality','air_quality_pkey','PRIMARY KEY (id)'),
      ('air_quality','air_quality_device_id_fkey','FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE SET NULL'),
      ('air_quality','air_quality_user_id_fkey','FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL'),

      ('devices','devices_pkey','PRIMARY KEY (id)'),
      ('devices','devices_user_id_fkey','FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
      ('devices','devices_city_id_fkey','FOREIGN KEY (city_id) REFERENCES public.cities(id)'),
      ('devices','devices_insulation_check','CHECK ((insulation = ANY (ARRAY[''poor''::text, ''moderate''::text, ''good''::text, ''excellent''::text])))'),

      ('profiles','profiles_pkey','PRIMARY KEY (id)'),
      ('profiles','profiles_id_fkey','FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE'),
      ('profiles','profiles_role_check','CHECK ((role = ANY (ARRAY[''admin''::text, ''user''::text, ''viewer''::text])))'),

      ('cities','cities_pkey','PRIMARY KEY (id)'),
      ('cities','cities_lat_lon_key','UNIQUE (lat, lon)'),

      ('city_weather','city_weather_pkey','PRIMARY KEY (id)'),
      ('city_weather','city_weather_city_id_fkey','FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE CASCADE'),
      ('city_weather','city_weather_city_id_observed_at_key','UNIQUE (city_id, observed_at)'),

      ('thresholds','thresholds_pkey','PRIMARY KEY (id)'),
      ('thresholds','thresholds_user_id_fkey','FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
      ('thresholds','thresholds_device_id_fkey','FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE'),
      ('thresholds','thresholds_metric_check','CHECK ((metric = ANY (ARRAY[''co2''::text, ''temperature''::text, ''humidity''::text, ''voc_index''::text])))'),

      ('notifications','notifications_pkey','PRIMARY KEY (id)'),
      ('notifications','notifications_user_id_fkey','FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
      ('notifications','notifications_device_id_fkey','FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE SET NULL'),

      ('events','events_pkey','PRIMARY KEY (id)'),
      ('events','events_user_id_fkey','FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
      ('events','events_device_id_fkey','FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE SET NULL'),

      ('interventions','interventions_pkey','PRIMARY KEY (id)'),
      ('interventions','interventions_user_id_fkey','FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),

      ('chat_sessions','chat_sessions_pkey','PRIMARY KEY (id)'),

      ('chat_messages','chat_messages_pkey','PRIMARY KEY (id)'),
      ('chat_messages','chat_messages_session_id_fkey','FOREIGN KEY (session_id) REFERENCES public.chat_sessions(id) ON DELETE CASCADE'),
      ('chat_messages','chat_messages_role_check','CHECK ((role = ANY (ARRAY[''user''::text, ''assistant''::text])))'),
      ('chat_messages','chat_messages_feedback_check','CHECK ((feedback = ANY (ARRAY[(-1)::integer, 1])))'),

      ('feedback','feedback_pkey','PRIMARY KEY (id)'),
      ('feedback','feedback_user_id_fkey','FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
      ('feedback','feedback_rating_check','CHECK (((rating >= (-1)::integer) AND (rating <= 5)))'),

      ('scenario_snapshots','scenario_snapshots_pkey','PRIMARY KEY (id)'),
      ('scenario_snapshots','scenario_snapshots_user_id_fkey','FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),

      ('scenario_recommendations','scenario_recommendations_pkey','PRIMARY KEY (id)'),
      ('scenario_recommendations','scenario_recommendations_user_id_fkey','FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),

      ('scenario_feedback','scenario_feedback_pkey','PRIMARY KEY (id)'),
      ('scenario_feedback','scenario_feedback_user_id_fkey','FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),

      ('ml_models','ml_models_pkey','PRIMARY KEY (user_id)'),
      ('ml_models','ml_models_user_id_fkey','FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),

      ('ml_feedback','ml_feedback_pkey','PRIMARY KEY (id)'),
      ('ml_feedback','ml_feedback_user_id_fkey','FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE')
    ) AS t(tbl, con, def)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = c.con AND conrelid = ('public.' || c.tbl)::regclass
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s', c.tbl, c.con, c.def);
    END IF;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------

-- Pre-existing
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_ts        ON public.chat_messages       USING btree (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_updated      ON public.chat_sessions       USING btree (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS city_weather_city_observed_idx      ON public.city_weather        USING btree (city_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS feedback_created_at_idx             ON public.feedback            USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_user_id_idx                ON public.feedback            USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_scenario_feedback_rec           ON public.scenario_feedback   USING btree (recommendation_id);
CREATE INDEX IF NOT EXISTS idx_scenario_feedback_user          ON public.scenario_feedback   USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scenario_recs_user_hash         ON public.scenario_recommendations USING btree (user_id, scenario_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scenario_snapshots_user_created ON public.scenario_snapshots  USING btree (user_id, created_at DESC);

-- Foreign-key covering indexes (added by Milestone 1; see
-- 20260804120200_add_missing_fk_indexes.sql for rationale)
CREATE INDEX IF NOT EXISTS idx_air_quality_device_id     ON public.air_quality   USING btree (device_id);
CREATE INDEX IF NOT EXISTS idx_air_quality_user_id       ON public.air_quality   USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_air_quality_user_created  ON public.air_quality   USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_devices_user_id           ON public.devices       USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_devices_city_id           ON public.devices       USING btree (city_id);
CREATE INDEX IF NOT EXISTS idx_events_user_id            ON public.events        USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_events_device_id          ON public.events        USING btree (device_id);
CREATE INDEX IF NOT EXISTS idx_interventions_user_id     ON public.interventions USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_ml_feedback_user_id       ON public.ml_feedback   USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id     ON public.notifications USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_device_id   ON public.notifications USING btree (device_id);
CREATE INDEX IF NOT EXISTS idx_thresholds_user_id        ON public.thresholds    USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_thresholds_device_id      ON public.thresholds    USING btree (device_id);

-- ----------------------------------------------------------------------------
-- Functions
-- Every function pins search_path (Supabase linter 0011). SECURITY DEFINER is
-- used only where a function must deliberately read past RLS.
-- ----------------------------------------------------------------------------

-- Server-side downsampling for chart queries: picks a time bucket from the
-- requested window so a year-long chart returns ~hundreds of rows, not 100k+.
CREATE OR REPLACE FUNCTION public.air_quality_bucketed(minutes integer)
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
  group by 1, p.bucket_seconds
  order by 1;
$function$;

-- BEFORE INSERT trigger on air_quality: derives user_id from the device when a
-- writer supplies only device_id. SECURITY DEFINER so it can read devices
-- regardless of the inserting role's RLS view.
CREATE OR REPLACE FUNCTION public.fill_air_quality_user_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NEW.user_id IS NULL AND NEW.device_id IS NOT NULL THEN
        SELECT user_id INTO NEW.user_id
        FROM public.devices
        WHERE id = NEW.device_id;
    END IF;
    RETURN NEW;
END;
$function$;

-- Device coordinates for the weather-ingest job.
CREATE OR REPLACE FUNCTION public.get_device_locations()
 RETURNS TABLE(id uuid, name text, lat double precision, lon double precision, city text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id, name, lat, lon, city
  FROM   devices
  WHERE  lat IS NOT NULL AND lon IS NOT NULL
  ORDER  BY created_at
  LIMIT  10;
$function$;

-- Picks "the" primary device for the signed-in user (most recent reading wins).
-- NOTE: assumes one active device per user. ROADMAP.md Milestone 2 makes this
-- device-scoped, since one account may own several devices in the pilot.
CREATE OR REPLACE FUNCTION public.schimmel_device_context()
 RETURNS TABLE(device_id uuid, device_name text, insulation text, city_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select d.id, d.name, coalesce(d.insulation, 'poor'), d.city_id
  from public.devices d
  where d.user_id = auth.uid() and d.active = true
  order by (
    select max(aq.created_at) from public.air_quality aq where aq.device_id = d.id
  ) desc nulls last, d.created_at desc
  limit 1;
$function$;

-- Generic updated_at trigger helpers. Currently attached to no trigger (kept
-- because the schema has updated_at columns that a future migration may wire up).
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------------
-- Triggers
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_fill_air_quality_user_id ON public.air_quality;
CREATE TRIGGER trg_fill_air_quality_user_id
  BEFORE INSERT ON public.air_quality
  FOR EACH ROW EXECUTE FUNCTION public.fill_air_quality_user_id();

-- ----------------------------------------------------------------------------
-- Row Level Security
--
-- IMPORTANT: the anon/authenticated/service_role table grants below are wide
-- (Supabase's default GRANT ALL). RLS is therefore the ONLY thing separating
-- one household's data from another's — every table must have RLS enabled and
-- a correct policy set, with no exceptions.
-- ----------------------------------------------------------------------------
ALTER TABLE public.air_quality              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_sessions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cities                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.city_weather             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interventions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ml_feedback              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ml_models                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenario_feedback        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenario_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenario_snapshots       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thresholds               ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- Policies
--
-- auth.uid() is always wrapped as (select auth.uid()) so Postgres evaluates it
-- once per statement (InitPlan) instead of once per row — materially cheaper on
-- air_quality, which is already six figures of rows and grows ~10x in the pilot.
-- ----------------------------------------------------------------------------

-- air_quality -----------------------------------------------------------------
DROP POLICY IF EXISTS "air_quality_select_own" ON public.air_quality;
CREATE POLICY "air_quality_select_own" ON public.air_quality AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "air_quality_insert_own" ON public.air_quality;
CREATE POLICY "air_quality_insert_own" ON public.air_quality AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = user_id));

-- !! DEVICE SYNC HOLE — replaced in ROADMAP.md Milestone 2 !!
-- These two grant the PUBLIC anon key (shipped in every browser bundle) read
-- and write access to one hardcoded user's readings. It is how the physical
-- sensor currently writes data. It cannot identify or revoke an individual
-- device, so it does not scale to the 10-device pilot.
DROP POLICY IF EXISTS "air_quality_anon_sync_insert" ON public.air_quality;
CREATE POLICY "air_quality_anon_sync_insert" ON public.air_quality AS PERMISSIVE FOR INSERT TO anon
  WITH CHECK ((user_id = 'b2025777-5d28-4d74-9280-2eb970318a4f'::uuid));

DROP POLICY IF EXISTS "air_quality_anon_sync_select" ON public.air_quality;
CREATE POLICY "air_quality_anon_sync_select" ON public.air_quality AS PERMISSIVE FOR SELECT TO anon
  USING ((user_id = 'b2025777-5d28-4d74-9280-2eb970318a4f'::uuid));

DROP POLICY IF EXISTS "air_quality_service_insert" ON public.air_quality;
CREATE POLICY "air_quality_service_insert" ON public.air_quality AS PERMISSIVE FOR INSERT TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "air_quality_service_update" ON public.air_quality;
CREATE POLICY "air_quality_service_update" ON public.air_quality AS PERMISSIVE FOR UPDATE TO service_role
  USING (true);

-- devices ---------------------------------------------------------------------
DROP POLICY IF EXISTS "devices_select_own" ON public.devices;
CREATE POLICY "devices_select_own" ON public.devices AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "devices_insert_own" ON public.devices;
CREATE POLICY "devices_insert_own" ON public.devices AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "devices_update_own" ON public.devices;
CREATE POLICY "devices_update_own" ON public.devices AS PERMISSIVE FOR UPDATE TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "devices_delete_own" ON public.devices;
CREATE POLICY "devices_delete_own" ON public.devices AS PERMISSIVE FOR DELETE TO public
  USING (((select auth.uid()) = user_id));

-- profiles --------------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = id));

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = id));

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles AS PERMISSIVE FOR UPDATE TO public
  USING (((select auth.uid()) = id));

-- cities / city_weather (shared reference data, readable by any signed-in user)
DROP POLICY IF EXISTS "cities_select_auth" ON public.cities;
CREATE POLICY "cities_select_auth" ON public.cities AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "city_weather_select_auth" ON public.city_weather;
CREATE POLICY "city_weather_select_auth" ON public.city_weather AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

-- thresholds ------------------------------------------------------------------
DROP POLICY IF EXISTS "thresholds_select_own" ON public.thresholds;
CREATE POLICY "thresholds_select_own" ON public.thresholds AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "thresholds_insert_own" ON public.thresholds;
CREATE POLICY "thresholds_insert_own" ON public.thresholds AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "thresholds_update_own" ON public.thresholds;
CREATE POLICY "thresholds_update_own" ON public.thresholds AS PERMISSIVE FOR UPDATE TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "thresholds_delete_own" ON public.thresholds;
CREATE POLICY "thresholds_delete_own" ON public.thresholds AS PERMISSIVE FOR DELETE TO public
  USING (((select auth.uid()) = user_id));

-- notifications ---------------------------------------------------------------
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own" ON public.notifications AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "notifications_insert_own" ON public.notifications;
CREATE POLICY "notifications_insert_own" ON public.notifications AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications AS PERMISSIVE FOR UPDATE TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "notifications_insert_service" ON public.notifications;
CREATE POLICY "notifications_insert_service" ON public.notifications AS PERMISSIVE FOR INSERT TO service_role
  WITH CHECK (true);

-- events ----------------------------------------------------------------------
DROP POLICY IF EXISTS "events_select_own" ON public.events;
CREATE POLICY "events_select_own" ON public.events AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "events_insert_own" ON public.events;
CREATE POLICY "events_insert_own" ON public.events AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = user_id));

-- interventions ---------------------------------------------------------------
DROP POLICY IF EXISTS "own interventions" ON public.interventions;
CREATE POLICY "own interventions" ON public.interventions AS PERMISSIVE FOR ALL TO public
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

-- chat ------------------------------------------------------------------------
DROP POLICY IF EXISTS "sessions_owner_select" ON public.chat_sessions;
CREATE POLICY "sessions_owner_select" ON public.chat_sessions AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "sessions_owner_insert" ON public.chat_sessions;
CREATE POLICY "sessions_owner_insert" ON public.chat_sessions AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "sessions_owner_update" ON public.chat_sessions;
CREATE POLICY "sessions_owner_update" ON public.chat_sessions AS PERMISSIVE FOR UPDATE TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "sessions_owner_delete" ON public.chat_sessions;
CREATE POLICY "sessions_owner_delete" ON public.chat_sessions AS PERMISSIVE FOR DELETE TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "messages_owner_select" ON public.chat_messages;
CREATE POLICY "messages_owner_select" ON public.chat_messages AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM chat_sessions
  WHERE ((chat_sessions.id = chat_messages.session_id) AND (chat_sessions.user_id = (select auth.uid()))))));

DROP POLICY IF EXISTS "messages_owner_insert" ON public.chat_messages;
CREATE POLICY "messages_owner_insert" ON public.chat_messages AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM chat_sessions
  WHERE ((chat_sessions.id = chat_messages.session_id) AND (chat_sessions.user_id = (select auth.uid()))))));

DROP POLICY IF EXISTS "messages_owner_update" ON public.chat_messages;
CREATE POLICY "messages_owner_update" ON public.chat_messages AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM chat_sessions
  WHERE ((chat_sessions.id = chat_messages.session_id) AND (chat_sessions.user_id = (select auth.uid()))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM chat_sessions
  WHERE ((chat_sessions.id = chat_messages.session_id) AND (chat_sessions.user_id = (select auth.uid()))))));

-- feedback --------------------------------------------------------------------
DROP POLICY IF EXISTS "feedback_own_select" ON public.feedback;
CREATE POLICY "feedback_own_select" ON public.feedback AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "feedback_own_insert" ON public.feedback;
CREATE POLICY "feedback_own_insert" ON public.feedback AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "feedback_own_delete" ON public.feedback;
CREATE POLICY "feedback_own_delete" ON public.feedback AS PERMISSIVE FOR DELETE TO public
  USING (((select auth.uid()) = user_id));

-- scenarios -------------------------------------------------------------------
DROP POLICY IF EXISTS "scen_snap_select_own" ON public.scenario_snapshots;
CREATE POLICY "scen_snap_select_own" ON public.scenario_snapshots AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "scen_snap_insert_own" ON public.scenario_snapshots;
CREATE POLICY "scen_snap_insert_own" ON public.scenario_snapshots AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "scen_snap_delete_own" ON public.scenario_snapshots;
CREATE POLICY "scen_snap_delete_own" ON public.scenario_snapshots AS PERMISSIVE FOR DELETE TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "scen_rec_select_own" ON public.scenario_recommendations;
CREATE POLICY "scen_rec_select_own" ON public.scenario_recommendations AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "scen_rec_insert_own" ON public.scenario_recommendations;
CREATE POLICY "scen_rec_insert_own" ON public.scenario_recommendations AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "scen_rec_delete_own" ON public.scenario_recommendations;
CREATE POLICY "scen_rec_delete_own" ON public.scenario_recommendations AS PERMISSIVE FOR DELETE TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "scen_fb_select_own" ON public.scenario_feedback;
CREATE POLICY "scen_fb_select_own" ON public.scenario_feedback AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "scen_fb_insert_own" ON public.scenario_feedback;
CREATE POLICY "scen_fb_insert_own" ON public.scenario_feedback AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = user_id));

-- ml --------------------------------------------------------------------------
DROP POLICY IF EXISTS "ml_models_own" ON public.ml_models;
CREATE POLICY "ml_models_own" ON public.ml_models AS PERMISSIVE FOR ALL TO authenticated
  USING (((select auth.uid()) = user_id))
  WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "ml_feedback_own" ON public.ml_feedback;
CREATE POLICY "ml_feedback_own" ON public.ml_feedback AS PERMISSIVE FOR ALL TO authenticated
  USING (((select auth.uid()) = user_id))
  WITH CHECK (((select auth.uid()) = user_id));

-- ----------------------------------------------------------------------------
-- Grants
-- Supabase's default posture: broad table grants, with RLS doing the real work.
-- Reproduced here so a fresh instance behaves identically to the live one.
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Hardening applied on top of the Supabase defaults above.
-- These must come AFTER the blanket GRANTs, which would otherwise re-grant them.
-- ----------------------------------------------------------------------------

-- TRUNCATE is the one table operation RLS does NOT filter, so the blanket grant
-- above leaves a latent path to wipe a table that RLS cannot block. PostgREST
-- does not expose TRUNCATE, so this is defence-in-depth — but the sensor data is
-- the product's evidentiary record. service_role keeps it (server-side only).
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('REVOKE TRUNCATE ON TABLE public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM anon, authenticated;

-- fill_air_quality_user_id() is a TRIGGER function and must stay SECURITY DEFINER,
-- but it should never be reachable as an RPC via /rest/v1/rpc/. PostgreSQL does not
-- re-check EXECUTE when a trigger fires, so this does not affect the insert path.
REVOKE EXECUTE ON FUNCTION public.fill_air_quality_user_id() FROM PUBLIC, anon, authenticated;
