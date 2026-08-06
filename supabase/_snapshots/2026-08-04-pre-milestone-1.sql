-- ============================================================================
-- ROLLBACK SNAPSHOT — live schema state immediately BEFORE Milestone 1
-- Captured: 2026-08-04 from project vciwibiiisobhotzxcyn (Supabase Cloud)
--
-- This file is NOT a migration and is deliberately outside supabase/migrations/
-- so the CLI never runs it. It exists purely so every object Milestone 1
-- modifies can be restored to its exact prior definition.
--
-- To roll back Milestone 1's database changes, run sections 1-3 below.
-- (Section 4 lists what was ADDED, which rollback would need to drop.)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. RLS POLICIES — original definitions (un-optimized auth.uid() calls)
--    Restoring these reverts 20260804120300_optimize_rls_initplan.sql
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "air_quality_insert_own" ON public.air_quality;
CREATE POLICY "air_quality_insert_own" ON public.air_quality AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "air_quality_select_own" ON public.air_quality;
CREATE POLICY "air_quality_select_own" ON public.air_quality AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "messages_owner_insert" ON public.chat_messages;
CREATE POLICY "messages_owner_insert" ON public.chat_messages AS PERMISSIVE FOR INSERT TO public WITH CHECK ((EXISTS ( SELECT 1
   FROM chat_sessions
  WHERE ((chat_sessions.id = chat_messages.session_id) AND (chat_sessions.user_id = auth.uid())))));

DROP POLICY IF EXISTS "messages_owner_select" ON public.chat_messages;
CREATE POLICY "messages_owner_select" ON public.chat_messages AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM chat_sessions
  WHERE ((chat_sessions.id = chat_messages.session_id) AND (chat_sessions.user_id = auth.uid())))));

DROP POLICY IF EXISTS "messages_owner_update" ON public.chat_messages;
CREATE POLICY "messages_owner_update" ON public.chat_messages AS PERMISSIVE FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM chat_sessions
  WHERE ((chat_sessions.id = chat_messages.session_id) AND (chat_sessions.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM chat_sessions
  WHERE ((chat_sessions.id = chat_messages.session_id) AND (chat_sessions.user_id = auth.uid())))));

DROP POLICY IF EXISTS "sessions_owner_delete" ON public.chat_sessions;
CREATE POLICY "sessions_owner_delete" ON public.chat_sessions AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "sessions_owner_insert" ON public.chat_sessions;
CREATE POLICY "sessions_owner_insert" ON public.chat_sessions AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "sessions_owner_select" ON public.chat_sessions;
CREATE POLICY "sessions_owner_select" ON public.chat_sessions AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "sessions_owner_update" ON public.chat_sessions;
CREATE POLICY "sessions_owner_update" ON public.chat_sessions AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "devices_delete_own" ON public.devices;
CREATE POLICY "devices_delete_own" ON public.devices AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "devices_insert_own" ON public.devices;
CREATE POLICY "devices_insert_own" ON public.devices AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "devices_select_own" ON public.devices;
CREATE POLICY "devices_select_own" ON public.devices AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "devices_update_own" ON public.devices;
CREATE POLICY "devices_update_own" ON public.devices AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "events_insert_own" ON public.events;
CREATE POLICY "events_insert_own" ON public.events AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "events_select_own" ON public.events;
CREATE POLICY "events_select_own" ON public.events AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "feedback_own_delete" ON public.feedback;
CREATE POLICY "feedback_own_delete" ON public.feedback AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "feedback_own_insert" ON public.feedback;
CREATE POLICY "feedback_own_insert" ON public.feedback AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "feedback_own_select" ON public.feedback;
CREATE POLICY "feedback_own_select" ON public.feedback AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "own interventions" ON public.interventions;
CREATE POLICY "own interventions" ON public.interventions AS PERMISSIVE FOR ALL TO public USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "ml_feedback_own" ON public.ml_feedback;
CREATE POLICY "ml_feedback_own" ON public.ml_feedback AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "ml_models_own" ON public.ml_models;
CREATE POLICY "ml_models_own" ON public.ml_models AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "notifications_insert_own" ON public.notifications;
CREATE POLICY "notifications_insert_own" ON public.notifications AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own" ON public.notifications AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = id));

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = id));

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = id));

DROP POLICY IF EXISTS "scen_fb_insert_own" ON public.scenario_feedback;
CREATE POLICY "scen_fb_insert_own" ON public.scenario_feedback AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "scen_fb_select_own" ON public.scenario_feedback;
CREATE POLICY "scen_fb_select_own" ON public.scenario_feedback AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "scen_rec_delete_own" ON public.scenario_recommendations;
CREATE POLICY "scen_rec_delete_own" ON public.scenario_recommendations AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "scen_rec_insert_own" ON public.scenario_recommendations;
CREATE POLICY "scen_rec_insert_own" ON public.scenario_recommendations AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "scen_rec_select_own" ON public.scenario_recommendations;
CREATE POLICY "scen_rec_select_own" ON public.scenario_recommendations AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "scen_snap_delete_own" ON public.scenario_snapshots;
CREATE POLICY "scen_snap_delete_own" ON public.scenario_snapshots AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "scen_snap_insert_own" ON public.scenario_snapshots;
CREATE POLICY "scen_snap_insert_own" ON public.scenario_snapshots AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "scen_snap_select_own" ON public.scenario_snapshots;
CREATE POLICY "scen_snap_select_own" ON public.scenario_snapshots AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "thresholds_delete_own" ON public.thresholds;
CREATE POLICY "thresholds_delete_own" ON public.thresholds AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "thresholds_insert_own" ON public.thresholds;
CREATE POLICY "thresholds_insert_own" ON public.thresholds AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "thresholds_select_own" ON public.thresholds;
CREATE POLICY "thresholds_select_own" ON public.thresholds AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "thresholds_update_own" ON public.thresholds;
CREATE POLICY "thresholds_update_own" ON public.thresholds AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

-- Policies NOT touched by Milestone 1 (recorded here for completeness only):
--   air_quality_anon_sync_insert / air_quality_anon_sync_select
--     -> anon role, WITH CHECK/USING (user_id = 'b2025777-5d28-4d74-9280-2eb970318a4f')
--        This is the single-hardcoded-user device sync hole. Milestone 2 replaces it.
--   air_quality_service_insert / air_quality_service_update  -> service_role, true
--   notifications_insert_service                             -> service_role, true
--   cities_select_auth / city_weather_select_auth            -> authenticated, true

-- ----------------------------------------------------------------------------
-- 2. FUNCTIONS DROPPED BY MILESTONE 1 — original definitions
--    Restoring these reverts 20260804120000_drop_orphaned_quiz_functions.sql
--
--    NOTE: all five reference tables that NO LONGER EXIST (daily_quizzes,
--    daily_quiz_questions, questions, user_quiz_subscriptions, user_profiles,
--    streaks) — dropped by migration 20260517090351 "drop_old_tables".
--    Recreating them would restore broken functions; they are recorded here
--    only for completeness, not because restoring them is ever useful.
-- ----------------------------------------------------------------------------

-- CREATE OR REPLACE FUNCTION public.get_quiz_questions(p_quiz_id uuid)
--  RETURNS TABLE(vraag_positie integer, question_id uuid, prompt text, options jsonb,
--                correct_option text, explanation text, difficulty text, specialism text)
--  LANGUAGE sql SECURITY DEFINER
-- AS $function$
--     SELECT dqq.position, q.id, q.prompt, q.options, q.correct_option::text,
--            q.explanation, q.difficulty::text, q.specialism::text
--     FROM daily_quiz_questions dqq JOIN questions q ON q.id = dqq.question_id
--     WHERE dqq.quiz_id = p_quiz_id ORDER BY dqq.position;
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.get_quiz_subscribers(p_sector text, p_specialism text DEFAULT NULL)
--  RETURNS TABLE(user_id uuid, first_name text, last_name text, email text)
--  LANGUAGE sql SECURITY DEFINER
-- AS $function$
--     SELECT up.id, up.first_name, up.last_name, up.email
--     FROM user_quiz_subscriptions uqs JOIN user_profiles up ON up.id = uqs.user_id
--     WHERE uqs.sector::text = p_sector
--       AND (p_specialism IS NULL OR p_specialism = '' OR uqs.specialism IS NULL
--            OR uqs.specialism::text = p_specialism)
--       AND uqs.active = true AND up.email_enabled = true AND up.is_active = true;
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.get_todays_quizzes()
--  RETURNS TABLE(quiz_id uuid, title text, specialism text, news_items jsonb,
--                clinical_pearl jsonb, sector text, quiz_date date)
--  LANGUAGE sql SECURITY DEFINER
-- AS $function$
--     SELECT dq.id, dq.title, dq.specialism::text, dq.news_items, dq.clinical_pearl,
--            dq.sector::text, dq.quiz_date
--     FROM daily_quizzes dq WHERE dq.quiz_date = CURRENT_DATE AND dq.sent_at IS NULL;
-- $function$;
--
-- update_user_streak(p_user_id uuid)                -- SECURITY DEFINER, reads/writes user_profiles
-- update_user_streak(p_user_id uuid, p_completed_date date)  -- reads/writes streaks
--   (full bodies omitted — both operate exclusively on dropped quiz-app tables)

-- ----------------------------------------------------------------------------
-- 3. FUNCTIONS ALTERED BY MILESTONE 1 — original definitions (no search_path)
--    Restoring these reverts 20260804120100_set_function_search_path.sql
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4. OBJECTS ADDED BY MILESTONE 1 — drop these to fully roll back
-- ----------------------------------------------------------------------------

-- From 20260804120200_add_missing_fk_indexes.sql:
--   DROP INDEX IF EXISTS public.idx_air_quality_device_id;
--   DROP INDEX IF EXISTS public.idx_air_quality_user_id;
--   DROP INDEX IF EXISTS public.idx_air_quality_user_created;
--   DROP INDEX IF EXISTS public.idx_devices_user_id;
--   DROP INDEX IF EXISTS public.idx_devices_city_id;
--   DROP INDEX IF EXISTS public.idx_events_user_id;
--   DROP INDEX IF EXISTS public.idx_events_device_id;
--   DROP INDEX IF EXISTS public.idx_interventions_user_id;
--   DROP INDEX IF EXISTS public.idx_ml_feedback_user_id;
--   DROP INDEX IF EXISTS public.idx_notifications_user_id;
--   DROP INDEX IF EXISTS public.idx_notifications_device_id;
--   DROP INDEX IF EXISTS public.idx_thresholds_user_id;
--   DROP INDEX IF EXISTS public.idx_thresholds_device_id;

-- From 20260804120400_move_pg_trgm_to_extensions.sql:
--   ALTER EXTENSION pg_trgm SET SCHEMA public;   -- (pg_trgm was in public before)
