-- Pilot-cockpit fase 0 (docs/pilot-cockpit-plan.md §2b/§3).
-- Additief. Vereist 20260806120300 (org_id etc.) en 20260806120400 (ingest_token).

-- Sticker-nummer (1..8 in de pilot), huisprofiel van de bewoner, en goedkope liveness-velden
-- die /api/ingest bijwerkt zodat status-checks geen max(created_at) over air_quality hoeven.
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS device_number integer;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS house_profile jsonb;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS profile_completed_at timestamp with time zone;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS last_seen_at timestamp with time zone;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS last_rssi integer;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS fw_version text;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS boot_count integer;

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_device_number
  ON public.devices (device_number) WHERE device_number IS NOT NULL;

COMMENT ON COLUMN public.devices.house_profile IS
  'Antwoorden van de bewoner uit /start (lib/houseProfile.ts bepaalt de sleutels). De typed kolommen location/house_type/build_year/insulation worden ervan afgeleid.';
