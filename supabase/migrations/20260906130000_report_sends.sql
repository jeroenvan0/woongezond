-- Verzendlog van het weekrapport per sensor (docs/rapport-weekmail-plan.md).
-- Eén rij per (device, weekstart): de timer kan nooit twee keer dezelfde week sturen, en de
-- cockpit toont "rapport verstuurd 7 sep". Geen e-mailadres in deze tabel (dat staat in
-- device_contacts, laag B). RLS aan zonder policies: alleen de service-role.
CREATE TABLE IF NOT EXISTS public.report_sends (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id     uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  period_start  date NOT NULL,                 -- maandag (Europe/Amsterdam) van de gerapporteerde week
  period_end    date NOT NULL,
  sent_at       timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'sent',  -- sent | failed
  verdict       text,                          -- ok | warning | critical | nodata
  readings      integer,
  trigger       text NOT NULL DEFAULT 'timer', -- timer | manual
  CONSTRAINT report_sends_unique UNIQUE (device_id, period_start)
);
CREATE INDEX IF NOT EXISTS idx_report_sends_device ON public.report_sends (device_id, sent_at DESC);
ALTER TABLE public.report_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_sends FROM anon, authenticated;
