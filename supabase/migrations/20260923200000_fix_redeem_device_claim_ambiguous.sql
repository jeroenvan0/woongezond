-- Koppelen via /koppel faalde altijd met `column reference "device_id" is ambiguous`:
-- RETURNS TABLE(device_id …) maakt device_id een PL/pgSQL-variabele, die botst met de
-- kolom in de backfill-UPDATE op air_quality. De transactie rolde terug, dus er gebeurde
-- niets. Alle kolomverwijzingen krijgen nu een tabelalias.
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

  UPDATE public.devices d SET user_id = v_uid WHERE d.id = v_row.device_id;
  UPDATE public.device_claim_codes c SET used_at = now(), redeemed_by = v_uid WHERE c.id = v_row.id;

  -- Backfill pre-claim readings for this device that have no owner yet.
  UPDATE public.air_quality aq SET user_id = v_uid
  WHERE aq.device_id = v_row.device_id AND aq.user_id IS NULL;

  SELECT d.name INTO v_name FROM public.devices d WHERE d.id = v_row.device_id;
  RETURN QUERY SELECT v_row.device_id, v_name;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.redeem_device_claim(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.redeem_device_claim(text) TO authenticated;
