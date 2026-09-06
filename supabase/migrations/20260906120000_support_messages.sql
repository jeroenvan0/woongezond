-- Klantenservice-inbox (docs/support-assistant.md). Eén rij per ontvangen mail met het
-- voorgestelde/verstuurde antwoord. Bevat e-mailadressen (laag B), dus: RLS aan en GEEN
-- policies — alleen de service-role leest en schrijft. device_id is de koppeling naar laag A.
CREATE TABLE IF NOT EXISTS public.support_messages (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resend_email_id text NOT NULL UNIQUE,
  message_id      text,
  from_addr       text NOT NULL,
  to_addr         text,
  subject         text,
  body            text,
  device_id       uuid REFERENCES public.devices(id) ON DELETE SET NULL,
  reply           text,
  escalate        boolean,
  reason          text,
  model           text,
  status          text NOT NULL DEFAULT 'received',   -- received | draft | answered | stored | ignored | send_failed | error
  created_at      timestamptz NOT NULL DEFAULT now(),
  handled_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_support_messages_device ON public.support_messages (device_id);
CREATE INDEX IF NOT EXISTS idx_support_messages_from ON public.support_messages (from_addr, created_at DESC);
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_messages FROM anon, authenticated;
