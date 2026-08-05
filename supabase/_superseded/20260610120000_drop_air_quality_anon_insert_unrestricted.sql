-- Evidence integrity: remove the unrestricted anon INSERT policy on air_quality.
-- WITH CHECK (true) let anyone holding the public anon key insert fabricated
-- readings attributed to any user_id, which undermines the data's value as legal
-- evidence. The scoped sensor-ingestion policy (air_quality_anon_sync_insert,
-- restricted to the sync user) remains in place for the physical sensor push.
DROP POLICY IF EXISTS allow_anon_insert ON public.air_quality;
