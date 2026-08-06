-- fill_air_quality_user_id() is a TRIGGER function. It must stay SECURITY DEFINER
-- (it reads public.devices to resolve user_id on insert), but it should never be
-- callable as an RPC via /rest/v1/rpc/. PostgreSQL does not re-check EXECUTE on a
-- trigger function when the trigger fires, so revoking EXECUTE does not affect the
-- sensor insert path. Verified by transaction-rollback test before applying:
--   BEGIN; REVOKE ...; SET LOCAL ROLE anon; INSERT INTO air_quality ...; -- succeeded
--   ROLLBACK;
--
-- Resolves advisors 0028/0029 (anon/authenticated can execute SECURITY DEFINER fn).
REVOKE EXECUTE ON FUNCTION public.fill_air_quality_user_id() FROM PUBLIC, anon, authenticated;
