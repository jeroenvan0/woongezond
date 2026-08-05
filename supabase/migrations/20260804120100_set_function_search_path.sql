-- Milestone 1: pin search_path on the two remaining functions that lack it.
--
-- A function without an explicit search_path resolves unqualified object names
-- using the *caller's* search_path. A caller who prepends their own schema can
-- therefore shadow a table or operator the function body relies on and steer it
-- somewhere unintended — the standard search_path-injection pattern. It matters
-- most for SECURITY DEFINER functions, but the linter flags all of them and
-- pinning it is free.
--
-- The app's own functions (air_quality_bucketed, fill_air_quality_user_id,
-- get_device_locations, schimmel_device_context) already set search_path and
-- are untouched here. After this migration, every non-extension function in
-- `public` pins it.
--
-- Both functions below are generic updated_at trigger helpers that touch no
-- tables, so the strictest setting (empty search_path) is safe: now() lives in
-- pg_catalog, which is always implicitly available.
--
-- Kept rather than dropped even though NO trigger currently uses either one —
-- several tables do carry updated_at columns, so these are plausibly wanted
-- later, and keeping them is the lower-risk call. Noted in DECISIONS.md.
--
-- Flagged by Supabase database linter 0011_function_search_path_mutable.
-- Rollback: supabase/_snapshots/2026-08-04-pre-milestone-1.sql (section 3).

ALTER FUNCTION public.set_updated_at()          SET search_path = '';
ALTER FUNCTION public.update_updated_at_column() SET search_path = '';
