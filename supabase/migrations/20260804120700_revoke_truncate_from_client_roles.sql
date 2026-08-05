-- TRUNCATE is the one table operation Row Level Security does NOT filter. The
-- Supabase default grant (GRANT ALL ON ALL TABLES TO anon, authenticated) therefore
-- leaves a latent path to wipe a table that RLS cannot block. PostgREST does not
-- expose TRUNCATE today, so this is defence-in-depth rather than an active hole,
-- but the sensor data is the product's evidentiary record and must not be
-- one misconfiguration away from deletion.
--
-- INSERT/SELECT/UPDATE/DELETE are intentionally left alone here: they ARE filtered
-- by RLS, and the device sync path depends on anon INSERT/SELECT until Milestone 2
-- replaces it with a per-device credential.
--
-- service_role keeps TRUNCATE (it bypasses RLS by design and is server-side only).
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('REVOKE TRUNCATE ON TABLE public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;
