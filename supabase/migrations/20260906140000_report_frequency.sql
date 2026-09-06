-- Hoe vaak een bewoner het rapport wil (instelbaar per sensor in de cockpit).
ALTER TABLE public.device_contacts
  ADD COLUMN IF NOT EXISTS report_frequency text NOT NULL DEFAULT 'weekly';
ALTER TABLE public.device_contacts DROP CONSTRAINT IF EXISTS device_contacts_frequency_chk;
ALTER TABLE public.device_contacts
  ADD CONSTRAINT device_contacts_frequency_chk CHECK (report_frequency IN ('daily', 'weekly', 'monthly'));
COMMENT ON COLUMN public.device_contacts.report_frequency IS 'daily | weekly | monthly — de dagelijkse timer bepaalt met lib/report/period.ts of een rapport vandaag aan de beurt is.';
