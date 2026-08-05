-- Milestone 1: relocate pg_trgm from the public schema to `extensions`.
--
-- pg_trgm was installed into `public` by the previous quiz app (it powered
-- question text search). That app's tables are gone and nothing in Woongezond
-- uses trigram matching — verified: zero GIN/GiST indexes in the database
-- reference trgm operator classes, and no column uses a trgm type.
--
-- Extensions in `public` are flagged because they inject ~30 function names
-- (similarity, show_trgm, word_similarity, the gtrgm_* support functions, ...)
-- straight into the schema PostgREST exposes, widening the API surface and
-- creating name-collision risk with application objects. Supabase's convention
-- is a dedicated `extensions` schema, which is where every other extension on
-- this project already lives (uuid-ossp, pgcrypto, pg_stat_statements).
--
-- Moved rather than dropped: relocation is reversible in one statement and
-- carries no risk of breaking something unnoticed, whereas DROP EXTENSION is
-- destructive. If it is still unused by the end of the pilot, dropping it
-- outright is the natural follow-up.
--
-- Flagged by Supabase database linter 0014_extension_in_public.
-- Rollback: ALTER EXTENSION pg_trgm SET SCHEMA public;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension
    WHERE extname = 'pg_trgm' AND extnamespace = 'public'::regnamespace
  ) THEN
    EXECUTE 'ALTER EXTENSION pg_trgm SET SCHEMA extensions';
  END IF;
END $$;
