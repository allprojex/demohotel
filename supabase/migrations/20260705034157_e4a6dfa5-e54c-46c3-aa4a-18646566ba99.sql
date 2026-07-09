ALTER TYPE public.channel_sync_direction ADD VALUE IF NOT EXISTS 'webhook_inbound';
ALTER TABLE public.channel_reservations_queue
  DROP CONSTRAINT IF EXISTS channel_reservations_queue_channel_id_external_ref_key;
ALTER TABLE public.channel_reservations_queue
  ADD CONSTRAINT channel_reservations_queue_channel_id_external_ref_key UNIQUE (channel_id, external_ref);