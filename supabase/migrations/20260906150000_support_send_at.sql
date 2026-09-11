-- Stand 'delayed': het voorstel gaat automatisch op send_at, tenzij de beheerder eerder ingrijpt.
ALTER TABLE public.support_messages ADD COLUMN IF NOT EXISTS send_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_support_messages_send_at ON public.support_messages (send_at) WHERE status = 'scheduled';
