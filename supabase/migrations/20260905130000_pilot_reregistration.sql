-- Physical-possession proof for overwriting a registration: /api/ingest records when the
-- sensor last (re)booted (from the firmware's uptime_s); /start may overwrite an existing
-- house_profile only within minutes of that. See docs/pilot-cockpit-plan.md §2b.
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS last_boot_at timestamp with time zone;
