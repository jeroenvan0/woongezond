-- Per-device data-ingest — een veilig schrijfpad voor de pilot-sensoren (Feather S3).
--
-- Ontwerp: docs/pilot-feather-s3-plan.md.
--
-- De baseline heeft een "DEVICE SYNC HOLE": de anon-key mag air_quality schrijven voor ÉÉN
-- hardgecodeerde user (air_quality_anon_sync_insert). Dat schaalt niet naar 8 apparaten van
-- een corporatie. Hier krijgt elk apparaat een eigen ingest-token; /api/ingest valideert dat
-- token (service-role) en schrijft de meting met het juiste device_id/user_id. De oude
-- anon-policy blijft voorlopig staan (de bestaande live-sensor gebruikt 'm nog); zie het plan
-- voor het uitfaseren.

-- Per-apparaat geheim. Alleen zichtbaar voor de eigenaar/org-leden via de devices-RLS.
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS ingest_token text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_ingest_token ON public.devices (ingest_token) WHERE ingest_token IS NOT NULL;

-- Koppelen backfillt nu ook de metingen die vóór het claimen binnenkwamen: een apparaat kan
-- al meten voordat de bewoner de QR scant; die rijen hadden user_id NULL (onzichtbaar). Bij
-- claim krijgen ze de bewoner als eigenaar, zodat geen data verloren gaat.
CREATE OR REPLACE FUNCTION public.redeem_device_claim(p_code text)
 RETURNS TABLE(device_id uuid, device_name text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_row  public.device_claim_codes%ROWTYPE;
  v_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_row FROM public.device_claim_codes c
  WHERE c.code = p_code AND c.used_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > now())
  LIMIT 1;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'claim_invalid'; END IF;

  UPDATE public.devices SET user_id = v_uid WHERE id = v_row.device_id;
  UPDATE public.device_claim_codes SET used_at = now(), redeemed_by = v_uid WHERE id = v_row.id;

  -- Backfill pre-claim readings for this device that have no owner yet.
  UPDATE public.air_quality SET user_id = v_uid
  WHERE device_id = v_row.device_id AND user_id IS NULL;

  SELECT name INTO v_name FROM public.devices WHERE id = v_row.device_id;
  RETURN QUERY SELECT v_row.device_id, v_name;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.redeem_device_claim(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.redeem_device_claim(text) TO authenticated;
