-- Milestone 1: remove dead SECURITY DEFINER functions left over from a previous app.
--
-- This Supabase project previously hosted an unrelated quiz/gamification app.
-- Its tables were dropped on 2026-05-17 (migration 20260517090351 "drop_old_tables")
-- when the project was repurposed for Woongezond, but five of its functions were
-- never removed. All five reference tables that no longer exist:
--
--   get_quiz_questions(uuid)          -> daily_quiz_questions, questions
--   get_quiz_subscribers(text,text)   -> user_quiz_subscriptions, user_profiles
--   get_todays_quizzes()              -> daily_quizzes
--   update_user_streak(uuid)          -> user_profiles
--   update_user_streak(uuid,date)     -> streaks
--
-- Four of them are SECURITY DEFINER *and* executable by the `anon` role, i.e.
-- callable without signing in via /rest/v1/rpc/<name>. They error out rather
-- than returning data, so this is dead attack surface rather than an active
-- leak — but a SECURITY DEFINER function reachable by anonymous callers has no
-- business existing in a system heading into a pilot with real households.
--
-- Flagged by Supabase database linter 0028/0029.
-- Rollback: supabase/_snapshots/2026-08-04-pre-milestone-1.sql (section 2).

DROP FUNCTION IF EXISTS public.get_quiz_questions(uuid);
DROP FUNCTION IF EXISTS public.get_quiz_subscribers(text, text);
DROP FUNCTION IF EXISTS public.get_todays_quizzes();
DROP FUNCTION IF EXISTS public.update_user_streak(uuid);
DROP FUNCTION IF EXISTS public.update_user_streak(uuid, date);
