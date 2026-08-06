# Woongezond — Roadmap to Production (10-device pilot)

Status snapshot: 2026-08-04. Based on a full code audit + live inspection of the Supabase
project (`vciwibiiisobhotzxcyn`, schema/RLS/advisors pulled directly from the database).

See also:
- [CALCULATIONS.md](CALCULATIONS.md) — every formula/threshold behind the mould-risk,
  health-score and report-diagnosis calculations, explicitly marked v1/unvalidated pending
  the pilot.
- [DECISIONS.md](DECISIONS.md) — running log of non-obvious choices and what was rejected.
- [WISHLIST.md](WISHLIST.md) — unscheduled ideas, incl. the woningcorporatie portfolio portal.

## Where things actually stand today

The app is in better shape for self-hosting than it looks on paper: it already runs on a
rented VPS via systemd (`woongezond-react.service`, port 3001, `npm run build && npm start`),
and the hourly weather cron is already a systemd timer hitting a secret-guarded route — not
Vercel Cron. There is no Vercel-specific code anywhere. **The "get off Vercel" half of the
VPS move is essentially done already.**

What's missing is everything around *making the data model and operations trustworthy enough
to run unattended for 10 households*, and *the Supabase side* of self-hosting. Concretely:

1. **No baseline schema in git.** `supabase/migrations/` only contains 3 late patches. The
   real baseline (`create_woongezond_schema`, RLS policies, functions) exists only in the live
   database — confirmed via the Supabase migration list, which shows 47 migrations total, most
   never committed to this repo. You cannot stand up a fresh Supabase instance from this repo
   today.
2. **The device→data trust model doesn't scale past one household.** I pulled the actual RLS
   policy: `air_quality_anon_sync_insert`/`_select` grant the **public anon key** insert/select
   rights, gated only by `user_id = 'b2025777-...'` — a single hardcoded UUID. Anyone who copies
   the anon key out of the browser bundle (trivial — it's meant to be public) can write or read
   air-quality rows for that one account today. For 10 devices, this pattern would mean either
   one migration per device (unmanageable) or, worse, all 10 devices trusting the same
   unauthenticated anon key with no way to tell them apart or revoke one without breaking all.
   This needs a real fix before the pilot, independent of hosting.
3. **Alerting only runs while a browser tab is open.** `/api/notifications/check` is polled
   client-side every 120s by `NotificationBell.tsx` — there is no server-side cron for it, unlike
   weather ingestion. For unattended pilot devices, this means alerts silently never fire if
   nobody has the dashboard open.
4. **Zero automated tests**, on a calculation layer (`lib/calculations.ts`, `lib/mouldModels.ts`)
   that the app's own code (`lib/coverage.ts`) frames as having evidentiary/legal weight.
5. **No security headers, no rate limiting**, `next.config.ts` is 12 lines.
6. **Live Supabase project carries dead attack surface**: four orphaned `SECURITY DEFINER`
   functions (`get_quiz_questions`, `get_todays_quizzes`, `get_quiz_subscribers`,
   `update_user_streak`) left over from an unrelated quiz/gamification app that used to share
   this Supabase project before its tables were dropped in migration `drop_old_tables`
   (2026-05-17). Callable by `anon` today against tables that no longer exist.
7. **No admin/device-onboarding UI** — enrolling a device today is manual SQL. There *is*,
   however, an unused `profiles.role` column (`admin` / `user` / `viewer`) already sitting in
   the schema, seemingly anticipating this.

## Decisions already made (from our interview)

- **Device firmware/ingestion**: confirmed — it's a simple flashing script that pushes readings
  straight to Supabase (matches what the live RLS policy showed: a direct anon-key insert, not a
  custom protocol/gateway). You'll share the actual script later; Milestone 1's audit step below
  stays as-is until then. **Longer-term goal, noted for planning**: move from manual flashing to
  a **QR-code self-install flow**, where a new household scans a code and the device provisions
  itself without you touching it. This changes the shape of Milestone 2 below — see the note
  there.
- **Multi-tenancy model**: one account can own **multiple devices** (e.g. a researcher/landlord
  view across several locations), not strictly one-device-per-household. Good news: the
  `devices` table already models `user_id` → many `devices` correctly. The gap is entirely in
  (a) the hardcoded single-user anon-sync policy, and (b) `schimmel_device_context()`, which
  explicitly picks "the" one primary device per user — both assume single-device today and need
  to become device-scoped rather than user-scoped.
- **VPS + self-hosted Supabase timing**: you asked for my recommendation. **I recommend
  treating it as a later phase (Milestone 5), after the device trust model and schema are
  fixed** — see rationale below. The app-hosting side barely changes (it's already on a VPS);
  only the Supabase side is new work, and it's safer to migrate a stable, already-fixed schema
  once than to redo the migration after changing the trust model on the new instance too.

---

## Milestone 1 — Make the repo reproducible & close known holes ✅ DONE (2026-08-05)

Goal: anyone (including future-you on a new VPS) can rebuild this system from git alone, and
the known security gaps are closed. This unblocks everything after it.

Branch `milestone-1-foundation`. Full rationale, rejected alternatives and verification
evidence in [DECISIONS.md](DECISIONS.md). All advisor counts went to zero except two
categories deliberately deferred to M2 and one dashboard toggle (below).
`air_quality` held **115,481 rows before and after** — no data touched.

- [x] Commit a real baseline migration, replacing the "3 patches on an invisible base" state.
      → `supabase/migrations/00000000000000_baseline_schema.sql`, built by SQL introspection
      (`supabase db dump` needs the Postgres password, which we don't have — see DECISIONS D6).
- [x] Drop the orphaned quiz-app `SECURITY DEFINER` functions. → 5 function objects dropped;
      each provably dead (every body referenced a table dropped in May 2026).
- [x] Move `pg_trgm` extension out of the `public` schema. → moved to `extensions`.
- [x] Add `SET search_path` to the flagged functions. → 7 warnings now 0.
- [x] Fix the `auth_rls_initplan` warnings. → 39 policies rewritten, then verified
      *behaviourally*: stranger sees 0 rows across every table, owner still sees their own.
- [x] Add missing indexes on the unindexed FK columns. → 13 indexes, incl. a
      `(user_id, created_at DESC)` composite for the app's hottest query.
- [x] **Bonus — real data leak found and fixed.** `get_device_locations()` was
      `SECURITY DEFINER` with no filter and returned *every* device's name + location to
      anyone holding the public anon key. Residents' first names are device names, so with
      10 pilot households this would have published every participant's name and city.
      → now `SECURITY INVOKER`. See DECISIONS D1.
- [x] **Bonus — revoked TRUNCATE from `anon`/`authenticated`** on all 17 tables. TRUNCATE is
      the one verb RLS does not filter. See DECISIONS D4.
- [x] **Bonus — revoked RPC reachability of the ingest trigger function**, after proving with
      a rollback-tested insert that it doesn't disturb sensor ingestion. See DECISIONS D3.
- [ ] **Enable leaked-password protection in Supabase Auth — needs you.** It's an Auth
      service setting, not SQL, so it can't be done through migrations: Supabase dashboard →
      Authentication → Policies. One toggle. Worth doing before 10 households sign up.
- [ ] Audit + document the real device ingestion mechanism once you share where the firmware
      lives — write it up in `docs/device-ingestion.md` so it's no longer tribal knowledge.
      (Still blocked on the firmware; carried into M2.)

## Milestone 2 — Fix the device trust model (the pilot's real blocker)

Goal: 10 physical devices can each write their own readings without trusting a shared public
key, and one can be individually revoked without breaking the other 9.

> **Design written, not implemented:** [docs/milestone-2-device-trust-design.md](docs/milestone-2-device-trust-design.md)
> — credential model, `deployments` table, ingest route, 3-phase migration path that
> doesn't break the live sensor, and 5 open questions that need the firmware. Implementation
> deliberately waits for the firmware and someone awake to watch the first device reconnect.

**Why this matters even more given the QR-code self-install goal**: a QR-code flow means a
device needs to arrive at a household with *no* per-device configuration already burned in by
you — it has to provision itself against a fresh account when scanned. That's only safe if each
device can be issued (and revoked) its own credential on demand, which is exactly what today's
hardcoded-single-`user_id` policy cannot do. Put differently: Milestone 2 here is the prerequisite
for the QR-code idea, not a separate later concern — building the per-device credential mechanism
now with self-provisioning in mind (rather than just "good enough for 10 manually-flashed
devices") avoids doing this twice.

- [ ] Replace the hardcoded-`user_id` anon-sync policy with a real per-device credential. Two
      viable shapes (worth a short design conversation once I see the current firmware):
  - **Option A (minimal firmware change)**: a Next.js API route (`POST /api/ingest`) that takes
    a per-device secret (header or bearer token), looks up the device by that secret using the
    *service-role* key server-side, validates payload shape/bounds, and inserts — never exposing
    the anon key's insert rights to devices at all. Anon-role insert on `air_quality` gets
    revoked entirely.
  - **Option B (Supabase-native)**: one Supabase Auth "device identity" per physical device
    (service accounts), RLS scoped by `auth.uid() = device_id`-style mapping. More Supabase-idiomatic,
    more firmware rework.
  - My default recommendation is **A** — it's a small, testable Next.js route, keeps the
    firmware talking HTTP+bearer-token (a common, easy device-side change), and centralizes
    validation (CO₂/temp/humidity bounds, dedup on timestamp) in one place instead of relying on
    DB constraints alone.
- [ ] Add basic payload validation (bounds checks, required fields, duplicate-timestamp
      rejection) at that ingestion boundary — currently nonexistent anywhere in the stack.
- [ ] Update `schimmel_device_context()` and any other "one device per user" assumption to be
      explicitly device-scoped (pass `device_id`, don't infer "the" device).
- [ ] Build a minimal admin device-enrollment flow: a page (gated by the existing but unused
      `profiles.role = 'admin'`) to register a new device, generate/rotate its credential, and
      mark it active/inactive — replacing today's manual SQL. For the 10-device pilot this can
      stay admin-only (you enroll each device before flashing it) — the QR-code, self-service
      version is a distinct follow-on (see below), not required to hit "pilot ready."
- [ ] *(Future, post-pilot)* QR-code self-install: extend the admin enrollment flow into a
      public claim-code flow — generate an unclaimed device credential + QR code in advance,
      have the device flash with it, and let the resident "claim" it into their account by
      scanning the code once at home. Deliberately scoped out of the initial pilot (10 devices
      you configure yourself is manageable by hand) but designing Milestone 2's credential
      mechanism to support "unclaimed until scanned" now avoids reworking it later.

## Milestone 3 — Reliability: move alerting off the browser

Goal: threshold alerts fire even when nobody has the dashboard open — the whole point of an
unattended pilot.

- [ ] Port `/api/notifications/check` to a systemd timer (mirroring
      `ops/systemd/woongezond-weather.timer` exactly) instead of relying on
      `NotificationBell.tsx`'s 120s client poll.
- [ ] Make the Resend email send retry-once-on-failure and log failures server-side
      (`console.error` at minimum) instead of the current silent `catch {}`.
- [ ] Add a `/api/health` endpoint (DB reachable, last ingest timestamp per device) for the
      process supervisor / an uptime check to hit — there is none today.
- [ ] Add minimal server-side logging across API routes (today: nothing reaches stdout for most
      caught errors) so `journalctl -u woongezond-react` is actually useful for debugging a
      10-device fleet.
- [ ] Make `/api/notifications/check` and the ML retrain job device-scoped rather than
      user-scoped: today both only ever look at "the latest reading" / "all readings" for a
      user with no `device_id` filter, so on a multi-device account one loud device can mask a
      quiet problem on another, and a Ridge model would train on a confused blend of two rooms.
      Detailed in [CALCULATIONS.md](CALCULATIONS.md) §8–9.

## Milestone 4 — Hardening + pilot UX polish

Goal: the app is safe to hand to 10 real households and looks/feels finished.

- [ ] Add security headers in `next.config.ts` (CSP, X-Frame-Options, Referrer-Policy,
      Permissions-Policy at minimum).
- [ ] Add basic rate limiting on `/api/chat`, `/api/recommendations`, `/api/ml/retrain` (cost
      exposure on OpenRouter + a 200k-row scan today) and `/api/notifications/check`.
- [ ] Unit tests for the pure calculation layer: `lib/calculations.ts`, `lib/mouldModels.ts`,
      `lib/trends.ts` — these are pure functions, trivially testable, and the highest-value place
      to start given zero test tooling exists today. Add `vitest` + a `test` script.
- [ ] Multi-device UI: dashboard/trends need a device switcher now that one account can have
      several devices (today's UI implicitly assumes one).
- [ ] Decide + implement password reset / account creation flow for onboarding 10 new pilot
      users (today: sign-in only, no self-serve signup or reset).
- [ ] **Run the pilot as validation, not just deployment**: [CALCULATIONS.md](CALCULATIONS.md)
      §10 lists 7 concrete calibration questions the pilot's 10 real homes can actually answer
      (which of the four mould-risk models tracks reality, whether the per-insulation-class
      R-values hold up, whether the report's legal-conclusion thresholds match any known leak/
      inspection cases, etc.). Worth deciding up front how you'll capture ground truth during
      the pilot — e.g. a simple log of "visible mould observed here on this date" or a building
      inspector's note — since without that, the pilot generates more sensor data but doesn't
      actually validate the models.

## Milestone 5 — VPS + self-hosted Supabase migration

Goal: both app and database run on infrastructure you control, on hardware you rent.

Recommended to sequence *after* M1–M2 so you're migrating an already-fixed, reproducible schema
rather than migrating today's undocumented state and then fixing it twice.

- [ ] Stand up self-hosted Supabase (Docker Compose) on the VPS using the now-committed baseline
      migration from M1.
- [ ] Add `output: 'standalone'` to `next.config.ts` + a `Dockerfile` if you want the app
      containerized alongside Supabase (optional — the systemd approach already works and could
      stay as-is if you'd rather not containerize the Next app).
- [ ] Write the reverse-proxy config (nginx/Caddy) for the `/admin` sub-path
      (`NEXT_PUBLIC_BASE_PATH`) in front of both the app and self-hosted Supabase's API — not in
      this repo today.
- [ ] Cutover plan: dump live Supabase data → restore into self-hosted instance → point
      `.env`/`NEXT_PUBLIC_SUPABASE_URL` at the new instance → verify all 10 devices' ingestion
      route still authenticates correctly (this is why M2 needs to land first — device auth
      should not depend on anything Supabase-cloud-specific).
- [ ] Backup/restore strategy for the self-hosted Postgres (pg_dump on a timer, off-VPS
      storage) — self-hosting means you lose Supabase Cloud's managed backups.

---

## Open questions for you

1. Where does the current device firmware/ingestion script live? Needed to scope M1's audit
   and M2's redesign concretely rather than guessing at the wire protocol.
2. For M2's device credential redesign — any constraint on changing what firmware sends (e.g.
   "firmware is flashed and hard to update" vs. "I can push an OTA update easily")? This decides
   whether Option A above is realistic or whether we need a lower-effort stopgap first.
3. Rough timeline: is there a target date for the 10-device pilot to start? That determines how
   much of M3/M4 can be trimmed vs. M1/M2 which I'd treat as non-negotiable before onboarding
   real households.
4. VPS specs/provider already chosen, or still shopping? Not blocking now, but relevant once we
   get to M5 sizing (self-hosted Supabase's Docker stack is not lightweight — worth knowing your
   RAM budget before then).
