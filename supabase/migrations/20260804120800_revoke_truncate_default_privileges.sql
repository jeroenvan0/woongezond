-- Without this, any table created later re-acquires TRUNCATE for anon/authenticated
-- from Supabase's default privileges, silently undoing 20260804120700.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM anon, authenticated;
