-- A one-shot command for the sensor, delivered in the response to its next /api/ingest
-- POST (the device polls every ~60 s; the server never reaches out). Used by "Sensor
-- resetten" in /start: 'reset_wifi' makes the device forget its Wi-Fi and open the setup
-- network. The token is never cleared remotely — identity stays with the hardware.
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS pending_command text;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS command_issued_at timestamp with time zone;
