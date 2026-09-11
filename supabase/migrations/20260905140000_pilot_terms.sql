-- The resident accepts the terms (algemene voorwaarden) in /start before the house
-- profile is saved. Recorded per device (no account in the pilot), with the version
-- accepted so a later text change can ask again. See docs/pilot-cockpit-plan.md §2b.
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS terms_accepted_at timestamp with time zone;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS terms_version text;
