# Superseded migrations

These three files were the *entire* contents of `supabase/migrations/` before
Milestone 1. Each was a patch that ALTERed an already-existing schema — the ~45
migrations that actually created that schema were never committed and lived only
in the live Supabase Cloud database.

Their net effect is now folded into `supabase/migrations/00000000000000_baseline_schema.sql`,
so they are kept here for provenance rather than for execution. They sit outside
`supabase/migrations/` deliberately: the Supabase CLI globs that directory, and
re-running these on top of the baseline would fail (e.g. `ADD COLUMN city_id` on
a table where the baseline already created it).

| File | What it did | Where it lives now |
|---|---|---|
| `20260610120000_drop_air_quality_anon_insert_unrestricted.sql` | Removed an `allow_anon_insert ... WITH CHECK (true)` policy that let any anon-key holder write readings under *any* user_id. Left `air_quality_anon_sync_insert` in place. | Baseline reflects the post-fix state. The remaining anon-sync policy is carried forward and flagged — Milestone 2 replaces it. |
| `20260619120000_add_cities_and_city_weather.sql` | Added `cities` + `city_weather` tables, `devices.city_id`, and their RLS. | Baseline creates all of it directly. |
| `20260619130000_add_device_insulation_class.sql` | Added `devices.insulation` (+ check constraint, backfill by device name) and `schimmel_device_context()`. | Baseline creates the column, constraint and function. The one-off backfill of two named devices is intentionally NOT carried over — it was data, not schema. |

## Note on migration history drift

The filenames above never matched the version numbers recorded in the live
database's migration history (e.g. this repo's `20260610120000` was applied as
`20260610064011`). That drift predates Milestone 1 and is one of the reasons the
schema was squashed into a single authoritative baseline rather than reconciled
patch-by-patch.

For the live Cloud database, the Milestone 1 migrations were applied directly and
are recorded in its history under their own version numbers. For a **fresh**
instance — which is the point of all this, per ROADMAP.md Milestone 5 — the
baseline plus the `20260804*` migrations reproduce the schema from scratch.
