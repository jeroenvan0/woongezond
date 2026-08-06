-- Milestone 1: add covering indexes for foreign keys that had none.
--
-- Postgres does not auto-index the referencing side of a foreign key. Without a
-- covering index every DELETE or UPDATE on the referenced table (auth.users,
-- devices, cities) must sequentially scan the referencing table to enforce the
-- constraint. On air_quality — already ~115k rows for a single device, and
-- expected to grow roughly 10x during the pilot — that is a full table scan per
-- affected parent row.
--
-- These indexes also carry the RLS predicates. Nearly every policy filters on
-- user_id, so `idx_air_quality_user_id` is doing double duty: FK enforcement and
-- making per-user row filtering an index lookup instead of a scan.
--
-- idx_air_quality_user_created is not an FK index. It matches the app's single
-- hottest access pattern — "this user's readings, newest first, within a time
-- window" — which is what /api/data, air_quality_bucketed(), the report page and
-- the ML retrain job all issue. The (user_id, created_at DESC) composite serves
-- both the RLS filter and the ordering from one index.
--
-- Locking note: plain CREATE INDEX takes a brief ACCESS EXCLUSIVE lock, blocking
-- writes for its duration. At this table size that is well under a second, and
-- the sensor writes only every few minutes, so a blocked insert would simply
-- wait rather than fail. CONCURRENTLY was deliberately not used because it
-- cannot run inside a transaction block, which would cost the all-or-nothing
-- guarantee that makes this migration safe to apply to a live database.
--
-- Flagged by Supabase database linter 0001_unindexed_foreign_keys.
-- Rollback: supabase/_snapshots/2026-08-04-pre-milestone-1.sql (section 4).

-- air_quality — the hot path
CREATE INDEX IF NOT EXISTS idx_air_quality_device_id    ON public.air_quality USING btree (device_id);
CREATE INDEX IF NOT EXISTS idx_air_quality_user_id      ON public.air_quality USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_air_quality_user_created ON public.air_quality USING btree (user_id, created_at DESC);

-- devices
CREATE INDEX IF NOT EXISTS idx_devices_user_id ON public.devices USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_devices_city_id ON public.devices USING btree (city_id);

-- events
CREATE INDEX IF NOT EXISTS idx_events_user_id   ON public.events USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_events_device_id ON public.events USING btree (device_id);

-- interventions
CREATE INDEX IF NOT EXISTS idx_interventions_user_id ON public.interventions USING btree (user_id);

-- ml_feedback
CREATE INDEX IF NOT EXISTS idx_ml_feedback_user_id ON public.ml_feedback USING btree (user_id);

-- notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_id   ON public.notifications USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_device_id ON public.notifications USING btree (device_id);

-- thresholds
CREATE INDEX IF NOT EXISTS idx_thresholds_user_id   ON public.thresholds USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_thresholds_device_id ON public.thresholds USING btree (device_id);

ANALYZE public.air_quality;
ANALYZE public.devices;
ANALYZE public.notifications;
ANALYZE public.thresholds;
