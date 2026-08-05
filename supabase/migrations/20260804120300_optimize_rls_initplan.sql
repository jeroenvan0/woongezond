-- Milestone 1: evaluate auth.uid() once per statement instead of once per row.
--
-- Every RLS policy here previously called auth.uid() bare. Postgres treats that
-- as a volatile-ish per-row expression and re-executes it for each candidate
-- row. Wrapping it as (select auth.uid()) turns it into an InitPlan: evaluated
-- a single time per statement, then compared as a constant.
--
-- This is purely an evaluation-strategy change. The predicates are otherwise
-- byte-identical, the roles targeted are unchanged, and every policy keeps its
-- PERMISSIVE/command combination. Access semantics before and after are exactly
-- the same — the same rows are visible to the same users. What changes is that
-- a query over air_quality stops making ~115k function calls (about to become
-- ~1M during the pilot) and makes one.
--
-- The rewrite was generated mechanically from pg_policies rather than
-- transcribed by hand, precisely because a typo in an RLS predicate is the kind
-- of mistake that silently exposes one household's readings to another. It is
-- verified after apply by re-reading pg_policies and confirming (a) the policy
-- count is unchanged, (b) no policy still contains a bare auth.uid(), and
-- (c) the linter's auth_rls_initplan warnings are gone.
--
-- DROP + CREATE per policy runs inside the migration's transaction, so other
-- sessions continue to see the old policies until commit — there is no window
-- where a table sits unprotected.
--
-- Policies deliberately NOT touched (they contain no auth.uid() call):
--   air_quality_anon_sync_insert / _select   (hardcoded uuid — Milestone 2 replaces)
--   air_quality_service_insert / _update     (service_role, true)
--   notifications_insert_service             (service_role, true)
--   cities_select_auth / city_weather_select_auth (authenticated, true)
--
-- Flagged by Supabase database linter 0003_auth_rls_initplan.
-- Rollback: supabase/_snapshots/2026-08-04-pre-milestone-1.sql (section 1).

-- air_quality -----------------------------------------------------------------
DROP POLICY IF EXISTS "air_quality_insert_own" ON public.air_quality;
CREATE POLICY "air_quality_insert_own" ON public.air_quality AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "air_quality_select_own" ON public.air_quality;
CREATE POLICY "air_quality_select_own" ON public.air_quality AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = user_id));

-- chat_messages ---------------------------------------------------------------
DROP POLICY IF EXISTS "messages_owner_insert" ON public.chat_messages;
CREATE POLICY "messages_owner_insert" ON public.chat_messages AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM chat_sessions
  WHERE ((chat_sessions.id = chat_messages.session_id) AND (chat_sessions.user_id = (select auth.uid()))))));

DROP POLICY IF EXISTS "messages_owner_select" ON public.chat_messages;
CREATE POLICY "messages_owner_select" ON public.chat_messages AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
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

-- chat_sessions ---------------------------------------------------------------
DROP POLICY IF EXISTS "sessions_owner_delete" ON public.chat_sessions;
CREATE POLICY "sessions_owner_delete" ON public.chat_sessions AS PERMISSIVE FOR DELETE TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "sessions_owner_insert" ON public.chat_sessions;
CREATE POLICY "sessions_owner_insert" ON public.chat_sessions AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "sessions_owner_select" ON public.chat_sessions;
CREATE POLICY "sessions_owner_select" ON public.chat_sessions AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "sessions_owner_update" ON public.chat_sessions;
CREATE POLICY "sessions_owner_update" ON public.chat_sessions AS PERMISSIVE FOR UPDATE TO public
  USING (((select auth.uid()) = user_id));

-- devices ---------------------------------------------------------------------
DROP POLICY IF EXISTS "devices_delete_own" ON public.devices;
CREATE POLICY "devices_delete_own" ON public.devices AS PERMISSIVE FOR DELETE TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "devices_insert_own" ON public.devices;
CREATE POLICY "devices_insert_own" ON public.devices AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "devices_select_own" ON public.devices;
CREATE POLICY "devices_select_own" ON public.devices AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "devices_update_own" ON public.devices;
CREATE POLICY "devices_update_own" ON public.devices AS PERMISSIVE FOR UPDATE TO public
  USING (((select auth.uid()) = user_id));

-- events ----------------------------------------------------------------------
DROP POLICY IF EXISTS "events_insert_own" ON public.events;
CREATE POLICY "events_insert_own" ON public.events AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "events_select_own" ON public.events;
CREATE POLICY "events_select_own" ON public.events AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = user_id));

-- feedback --------------------------------------------------------------------
DROP POLICY IF EXISTS "feedback_own_delete" ON public.feedback;
CREATE POLICY "feedback_own_delete" ON public.feedback AS PERMISSIVE FOR DELETE TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "feedback_own_insert" ON public.feedback;
CREATE POLICY "feedback_own_insert" ON public.feedback AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "feedback_own_select" ON public.feedback;
CREATE POLICY "feedback_own_select" ON public.feedback AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = user_id));

-- interventions ---------------------------------------------------------------
DROP POLICY IF EXISTS "own interventions" ON public.interventions;
CREATE POLICY "own interventions" ON public.interventions AS PERMISSIVE FOR ALL TO public
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

-- ml_feedback -----------------------------------------------------------------
DROP POLICY IF EXISTS "ml_feedback_own" ON public.ml_feedback;
CREATE POLICY "ml_feedback_own" ON public.ml_feedback AS PERMISSIVE FOR ALL TO authenticated
  USING (((select auth.uid()) = user_id))
  WITH CHECK (((select auth.uid()) = user_id));

-- ml_models -------------------------------------------------------------------
DROP POLICY IF EXISTS "ml_models_own" ON public.ml_models;
CREATE POLICY "ml_models_own" ON public.ml_models AS PERMISSIVE FOR ALL TO authenticated
  USING (((select auth.uid()) = user_id))
  WITH CHECK (((select auth.uid()) = user_id));

-- notifications ---------------------------------------------------------------
DROP POLICY IF EXISTS "notifications_insert_own" ON public.notifications;
CREATE POLICY "notifications_insert_own" ON public.notifications AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own" ON public.notifications AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications AS PERMISSIVE FOR UPDATE TO public
  USING (((select auth.uid()) = user_id));

-- profiles --------------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = id));

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = id));

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles AS PERMISSIVE FOR UPDATE TO public
  USING (((select auth.uid()) = id));

-- scenario_feedback -----------------------------------------------------------
DROP POLICY IF EXISTS "scen_fb_insert_own" ON public.scenario_feedback;
CREATE POLICY "scen_fb_insert_own" ON public.scenario_feedback AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "scen_fb_select_own" ON public.scenario_feedback;
CREATE POLICY "scen_fb_select_own" ON public.scenario_feedback AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = user_id));

-- scenario_recommendations ----------------------------------------------------
DROP POLICY IF EXISTS "scen_rec_delete_own" ON public.scenario_recommendations;
CREATE POLICY "scen_rec_delete_own" ON public.scenario_recommendations AS PERMISSIVE FOR DELETE TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "scen_rec_insert_own" ON public.scenario_recommendations;
CREATE POLICY "scen_rec_insert_own" ON public.scenario_recommendations AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "scen_rec_select_own" ON public.scenario_recommendations;
CREATE POLICY "scen_rec_select_own" ON public.scenario_recommendations AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = user_id));

-- scenario_snapshots ----------------------------------------------------------
DROP POLICY IF EXISTS "scen_snap_delete_own" ON public.scenario_snapshots;
CREATE POLICY "scen_snap_delete_own" ON public.scenario_snapshots AS PERMISSIVE FOR DELETE TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "scen_snap_insert_own" ON public.scenario_snapshots;
CREATE POLICY "scen_snap_insert_own" ON public.scenario_snapshots AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "scen_snap_select_own" ON public.scenario_snapshots;
CREATE POLICY "scen_snap_select_own" ON public.scenario_snapshots AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = user_id));

-- thresholds ------------------------------------------------------------------
DROP POLICY IF EXISTS "thresholds_delete_own" ON public.thresholds;
CREATE POLICY "thresholds_delete_own" ON public.thresholds AS PERMISSIVE FOR DELETE TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "thresholds_insert_own" ON public.thresholds;
CREATE POLICY "thresholds_insert_own" ON public.thresholds AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "thresholds_select_own" ON public.thresholds;
CREATE POLICY "thresholds_select_own" ON public.thresholds AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "thresholds_update_own" ON public.thresholds;
CREATE POLICY "thresholds_update_own" ON public.thresholds AS PERMISSIVE FOR UPDATE TO public
  USING (((select auth.uid()) = user_id));
