# Decisions log

Running record of non-obvious choices, why they were made, and what was rejected.
Newest milestone first. See [ROADMAP.md](ROADMAP.md) for the plan,
[CALCULATIONS.md](CALCULATIONS.md) for model methodology, [WISHLIST.md](WISHLIST.md)
for unscheduled ideas.

---

# Milestone 1 — Reproducible repo & closed holes

Branch: `milestone-1-foundation`. Executed 2026-08-04/05 against the live Supabase
project `vciwibiiisobhotzxcyn`.

## Outcome

| Supabase advisor | Before | After |
|---|---|---|
| `function_search_path_mutable` | 7 | **0** |
| `extension_in_public` | 1 | **0** |
| `anon_security_definer_function_executable` | 6 | **0** |
| `authenticated_security_definer_function_executable` | 6 | **0** |
| `auth_rls_initplan` | ~15 | **0** |
| `unindexed_foreign_keys` | 12 | **0** |
| `auth_leaked_password_protection` | 1 | 1 — see D9 |
| `pg_graphql_*_table_exposed` | 31 | 31 — deferred to M2, see D8 |
| `multiple_permissive_policies` | 2 | 2 — deferred to M2, see D8 |

Data integrity throughout: `air_quality` held **115,481 rows before and after** every
migration. No row was written, altered, or deleted by Milestone 1.

## What was applied to the live database

Nine migrations, all recorded in Supabase migration history (`20260804165115` onward):

1. `drop_orphaned_quiz_functions` — dropped 5 function objects
2. `set_function_search_path` — pinned `search_path` on 2 trigger helpers
3. `add_missing_fk_indexes` — 13 indexes
4. `optimize_rls_initplan` — rewrote 39 policies
5. `move_pg_trgm_to_extensions` — `public` → `extensions`
6. `restrict_device_locations_rpc` — SECURITY DEFINER → INVOKER
7. `revoke_execute_on_trigger_function` — revoked RPC reachability
8. `revoke_truncate_from_client_roles` — 17 tables
9. `revoke_truncate_default_privileges` — stops future tables regaining it

---

## D1. A real data leak was found and fixed — not on the original audit list

`get_device_locations()` was `SECURITY DEFINER` with no internal filter, so it ignored
the `devices` RLS policies and returned **every device in the system**. It was callable
with nothing but the public anon key — the same key shipped in every browser bundle.
Verified live before fixing: an unauthenticated `POST /rest/v1/rpc/get_device_locations`
returned device names (`"Jannouk Sensor"`, `"Jeroen Sensor"`) with coordinates and city.

Device names are residents' first names, which makes this personal data. With ten pilot
households it would have published the name and approximate location of every participant
to anyone who opened the site and read the network tab — while the product's own
positioning rests on GDPR/AVG credibility with housing associations.

Stored coordinates are currently city-centre (52.37, 4.89 = Amsterdam) rather than
per-dwelling, so actual exposure was names + city, not street addresses. That is a
property of today's data, not a guarantee of the function: it returns whatever precision
`devices.lat/lon` happens to hold.

**Fixed** by switching to `SECURITY INVOKER` (caller's RLS applies: authenticated users
see only their own devices, anon sees nothing) plus revoking anon EXECUTE.

**Rejected:** dropping it outright. Nothing in the React app calls it (grepped across
`app/`, `lib/`, `components/`, `scripts/`, `ops/`) and it predates the React port — but
`SECURITY INVOKER` already removes the vulnerability, and keeping it is reversible in a
way `DROP` is not, in case the legacy Flask deployment still calls it.

## D2. The five dropped functions were provably dead, not just unused

Dropped: `get_quiz_questions`, `get_quiz_subscribers`, `get_todays_quizzes`, and both
overloads of `update_user_streak`. These are leftovers from an unrelated quiz/gamification
app that shared this Supabase project before its tables were dropped in
`drop_old_tables` (2026-05-17).

The test applied was not "does the app call these" but "can these possibly work". Reading
each body via `pg_get_functiondef` showed every one references a table that no longer
exists — `daily_quiz_questions`, `questions`, `user_quiz_subscriptions`, `user_profiles`,
`streaks`. They could only ever have raised `relation does not exist`. Four were
`SECURITY DEFINER` and callable by `anon`, so they were dead code that was also
attack surface.

## D3. `fill_air_quality_user_id` — earlier caution overturned by an explicit test

The `restrict_device_locations_rpc` migration deliberately left this one alone, reasoning
that revoking EXECUTE "risks disturbing the BEFORE INSERT trigger that attributes every
incoming sensor reading to a user" — the correct instinct, since that trigger is the
sensor ingestion path.

Rather than leave it on caution, the assumption was tested directly:

```sql
BEGIN;
  REVOKE EXECUTE ON FUNCTION public.fill_air_quality_user_id() FROM anon, authenticated, public;
  SET LOCAL ROLE anon;
  INSERT INTO public.air_quality (...) VALUES (...);   -- succeeded
ROLLBACK;
```

The insert succeeded with EXECUTE revoked, confirming PostgreSQL does not re-check EXECUTE
on a trigger function when the trigger fires (privilege is checked at `CREATE TRIGGER`
time). The transaction was rolled back — verified afterwards: 115,481 rows, zero test rows
left behind, EXECUTE restored.

The revoke was then applied for real. The function stays `SECURITY DEFINER` because it
legitimately needs to read `devices` to resolve `user_id`; it is simply no longer
reachable as an RPC.

## D4. TRUNCATE revoked because RLS does not filter it

Supabase's default `GRANT ALL ON ALL TABLES TO anon, authenticated` gave `anon` TRUNCATE
on all 17 tables. Every other DML verb is filtered by RLS — **TRUNCATE is not**. It is the
one operation that could empty a table regardless of policy.

Not an active vulnerability: PostgREST exposes no TRUNCATE verb, and the anon key is a
PostgREST/GoTrue JWT, not direct Postgres access. So this is defence-in-depth, not an open
door. It was still worth closing, because the sensor data is the product's evidentiary
record and shouldn't sit one misconfiguration away from deletion.

Deliberately **left alone**: anon INSERT/SELECT/UPDATE/DELETE. These *are* RLS-filtered,
and the device sync path depends on anon INSERT/SELECT until Milestone 2 replaces it.
Revoking them tonight would have silently killed sensor ingestion.

A second migration (`revoke_truncate_default_privileges`) applies the same rule via
`ALTER DEFAULT PRIVILEGES`, because otherwise the next table created would quietly
re-acquire TRUNCATE and undo the fix.

## D5. RLS rewrite verified behaviourally, not just by advisor

39 policies were rewritten from `auth.uid()` to `(select auth.uid())` so Postgres
evaluates the call once as an InitPlan rather than per row. Semantically identical,
but touching 39 security policies at once on a live database warrants proof, not trust.

Two things were checked. First, a false alarm worth recording: a verification query
reported "39 still unoptimized" because it pattern-matched lowercase `select auth.uid()`,
while Postgres normalises and stores the rewritten form as `( SELECT auth.uid() AS uid)`.
The migration was correct; the check was wrong. Re-checked case-insensitively:
39 using `auth.uid()`, 39 optimized, **0 unoptimized**.

Second, isolation was tested behaviourally by impersonating roles:

| Role | air_quality | devices | notifications | chats | profiles |
|---|---|---|---|---|---|
| Owner (`b2025777…`) | 105,462 | 2 | 42 | 9 | 1 |
| Stranger (`…deadbeef`) | **0** | **0** | **0** | **0** | **0** |

The owner sees 105,462 of 115,481 readings — the remainder belong to the second user —
which is exactly right. A stranger sees nothing anywhere. `schimmel_device_context()` and
`air_quality_bucketed()` both still return rows.

One method note: an initial attempt to test both roles in a single `SELECT` using
`set_config()` inside CTEs reported a false FAIL. CTE evaluation order isn't guaranteed
and the statement is planned once, so the role never actually switched mid-query. Split
into one role per transaction, the result was unambiguous.

## D6. Migrations squashed into an idempotent baseline

The repo previously held 3 patch migrations that only ever `ALTER`ed a schema defined
nowhere in git — the live DB had 47 migrations, the repo had 3. A fresh instance built
from this repo would have produced an almost empty database.

`00000000000000_baseline_schema.sql` now captures the complete schema: extensions, 17
tables, constraints, indexes, functions, triggers, RLS enablement, all 46 policies, and
grants. It is written idempotently (`IF NOT EXISTS`, `CREATE OR REPLACE`,
`DROP POLICY IF EXISTS` before each `CREATE POLICY`, `DO` blocks for constraints) so
applying it to the already-populated live database is a no-op.

The 3 superseded files moved to `supabase/_superseded/` — outside the migrations glob, so
the CLI ignores them — since their effects are already folded into the baseline. Kept
rather than deleted because git history here is a single squashed commit and would not
otherwise preserve them.

**Baseline reflects the desired end state, not a literal snapshot.** It excludes the dead
quiz functions and carries the optimized policies, so a fresh instance gets the good
schema directly instead of creating dead objects and then dropping them. The numbered
migrations exist to move the *existing* database to that same state. Both converge.

**Known and accepted:** live migration history (56 entries) no longer matches the repo
(baseline + 9). Content matches; only history differs. This is only load-bearing at the
Milestone 5 self-host cutover, which builds a fresh instance from the repo — the case
where the baseline is correct and the divergent cloud history is irrelevant.

**Built by SQL introspection, not `supabase db dump`.** The CLI is installed (v2.67.1) but
`db dump` needs the Postgres password, which isn't in `.env.local` (only anon/service-role
JWTs, which are PostgREST credentials, not database logins). Reconstructed instead via
`pg_get_constraintdef`, `pg_get_indexdef`, `pg_get_functiondef`, `pg_get_triggerdef` and
`pg_policies`. Worth re-verifying with a real `pg_dump` when the password is available.

## D7. Extension moved rather than dropped

`pg_trgm` sat in `public` (linter 0014) and is unused: zero trigram indexes, no dependent
columns — another quiz-app leftover. Moved to the `extensions` schema, Supabase's
convention, rather than dropped: `ALTER EXTENSION … SET SCHEMA` is trivially reversible,
and removing an extension that some future full-text search might want is a bigger
decision than this milestone needed to make.

## D8. Deliberately deferred to Milestone 2

- **31 `pg_graphql_*_table_exposed` warnings.** These stem from `anon`/`authenticated`
  holding SELECT, which makes tables visible in GraphQL introspection. Rows are still
  RLS-protected. The real fix is revoking anon's blanket grants — impossible tonight
  because the sensor authenticates *as anon* via the `air_quality_anon_sync_*` policies.
  Milestone 2 replaces that with a per-device credential; these warnings should be
  re-checked immediately after.
- **2 `multiple_permissive_policies` warnings** on `air_quality` for anon — caused by
  `air_quality_anon_sync_insert/select` overlapping `air_quality_insert_own/select_own`.
  The anon-sync policies are exactly what Milestone 2 deletes.

## D9. Not doable from here

**Leaked-password protection** (HaveIBeenPwned checks on signup) is an Auth service
setting, not SQL — it lives in the Supabase dashboard under Authentication → Policies, or
the Management API. It cannot be applied through the migration path used here.

**Action for Jeroen:** enable it in the dashboard. One toggle. Worth doing before ten pilot
households create accounts.

---

# Milestone 2 — not started

Design work only, deliberately not applied. Milestone 2 changes how physical sensors
authenticate, and the firmware is not in this repo. Getting it wrong means sensors
silently stop recording — a failure mode that, on current evidence, would go unnoticed:
**the single live sensor stopped reporting 2026-08-03 11:12 and was still offline more
than a day later**, discovered only incidentally during this audit. See
[WISHLIST.md](WISHLIST.md) §3b.
