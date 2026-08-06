# Milestone 2 — Device trust model: design

**Status: design only. Nothing here has been applied.** No database changes, no
firmware changes, no code written. This is for review before implementation.

Written 2026-08-05. Prerequisite reading: [../DECISIONS.md](../DECISIONS.md) (M1),
[../ROADMAP.md](../ROADMAP.md), [../WISHLIST.md](../WISHLIST.md).

> **Why this wasn't implemented unattended.** M2 changes how physical sensors
> authenticate. The firmware is not in this repo. If the credential design is wrong,
> sensors silently stop recording — and on current evidence that would go unnoticed:
> the single live sensor stopped at 2026-08-03 11:12 and was still offline 20+ hours
> later, found only incidentally during the M1 audit. Implementing this needs the
> firmware in hand and someone awake to watch the first device reconnect.

---

## 1. The problem, precisely

Today a sensor writes to `air_quality` using the **public anon key** — the same key
shipped in every browser bundle — under this policy:

```sql
CREATE POLICY "air_quality_anon_sync_insert" ON public.air_quality
  FOR INSERT TO anon
  WITH CHECK (user_id = 'b2025777-5d28-4d74-9280-2eb970318a4f'::uuid);
```

Four consequences:

1. **No device identity.** The database cannot tell device #3 from device #7. Every
   device is just "whoever holds the anon key".
2. **No revocation.** Rotating the credential means rotating the anon key, which
   breaks the web app and all ten devices simultaneously.
3. **Hardcoded to one user.** Scaling to 10 households by this pattern means 10
   migrations hardcoding 10 UUIDs — and each new policy widens what the *public* key
   can write.
4. **Anyone can forge readings.** The anon key is public by design. Anyone who opens
   the site can POST fabricated readings attributed to that user — into a dataset the
   product positions as evidentiary. They can also read that user's full history
   (`air_quality_anon_sync_select`).

This is the pilot's blocker, and it is independent of hosting.

## 2. Recommended design

### 2.1 Authentication: per-device bearer token via a server-side ingest route

Devices stop talking to PostgREST directly. They POST to a Next.js route that holds
the service-role key server-side.

```
POST /api/ingest
Authorization: Bearer wg_dev_<32-byte-random-base64url>
Content-Type: application/json

{ "co2": 812, "temperature": 20.4, "humidity": 58.1,
  "voc_index": 103, "nox_index": 1, "measured_at": "2026-08-05T08:15:00Z" }
```

The route: hashes the token → looks up the device → rejects if unknown/revoked/inactive
→ validates the payload → inserts with `device_id` and `user_id` resolved **server-side
from the token**, never from the request body.

**Store only a hash of the token** (SHA-256, `encode(digest(token,'sha256'),'hex')`).
A database leak then yields no working credentials. The plaintext token is shown once at
provisioning time and never again — same model as a GitHub PAT.

Why this over the alternatives:

| Option | Verdict |
|---|---|
| **A. Ingest route + per-device token** (recommended) | Small firmware change (one header). Central validation. Per-device revoke. No Supabase Auth sprawl. Portable to self-hosted Supabase. Supports the "unclaimed until scanned" state the QR flow needs. |
| B. One Supabase Auth user per device | More Supabase-idiomatic, but 10→1000 auth users is real sprawl, refresh-token rotation on embedded devices is fiddly, and it still leaves devices talking to PostgREST directly with a broad table grant. |
| C. Signed JWT per device (asymmetric) | Cleanest cryptographically, no DB lookup per request — but needs key management on an ESP32-S3 and offers little over A at pilot scale. Revisit at ~1000 devices. |

**Deliberately NOT recommended: keeping direct PostgREST writes with a narrower policy.**
Any policy the anon role can satisfy is a policy the public can satisfy. The trust
boundary has to move server-side.

### 2.2 Data model

Two new tables plus one column.

```sql
-- Credential per physical device. Hash only; plaintext shown once at provisioning.
CREATE TABLE public.device_credentials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id     uuid REFERENCES public.devices(id) ON DELETE CASCADE,  -- NULL = unclaimed
  token_hash    text NOT NULL UNIQUE,
  token_prefix  text NOT NULL,          -- first ~8 chars, for showing "wg_dev_a1b2…" in admin UI
  claim_code    text UNIQUE,            -- for the QR self-install flow (see §5)
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,            -- powers device liveness monitoring
  revoked_at    timestamptz
);

-- Which dwelling a device was in, and when. THE key structural change (see §2.3).
CREATE TABLE public.deployments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id     uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  label         text,                   -- "Slaapkamer voor", "Woonkamer"
  insulation    text,                   -- moves here from devices: a property of the WALL, not the sensor
  city_id       uuid REFERENCES public.cities(id),
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,            -- NULL = currently deployed
  CONSTRAINT deployment_period_valid CHECK (ended_at IS NULL OR ended_at > started_at)
);

ALTER TABLE public.air_quality ADD COLUMN deployment_id uuid REFERENCES public.deployments(id);
```

### 2.3 Why `deployments` matters more than it looks

This is the part worth arguing about, so here is the reasoning explicitly.

The business model rents the sensor: it stays Woongezond property and follows the
tenant-mutation cycle, roughly the first ~3 critical months of a new tenancy, then moves
to the next dwelling. But today a reading is tied only to `device_id` and `user_id`.

**Move a sensor from house A to house B and its history silently merges two different
buildings.** Every downstream calculation then reads a fiction:

- `schimmel_device_context()` picks "the" device and returns its `insulation` — so
  house B's readings get scored against house A's wall construction.
- The report's period comparison and long-term trend (`langetermijntrend`) fit a
  regression straight across the move.
- The mould models (VTT/WUFI-Bio) carry **accumulated state** — `MI` and `GP` build up
  over time and decay slowly. A move mid-series carries house A's accumulated mould
  index into house B's score. This is the worst one: it is not just noise, it is a
  fabricated risk history.

And it corrupts exactly the evidentiary record the product sells.

Note `insulation` moves from `devices` to `deployments`. Wall insulation is a property
of the *building*, not of the sensor — keeping it on the device means it travels with the
hardware, which is simply wrong. (See [../CALCULATIONS.md](../CALCULATIONS.md) §2.4:
insulation class silently drives every wall-surface risk number.)

**Cost now: one table, one FK, one backfill. Cost later: unrecoverable** — once readings
from two dwellings share a device with no period boundary, you cannot separate them
retroactively. Recommend building it in M2 even though pilot devices likely stay put
Oct–Mar.

### 2.4 Payload validation

None exists anywhere today. At minimum, reject rather than store:

| Field | Accept | Note |
|---|---|---|
| `co2` | 0–40000 ppm | SCD41 spec range is 400–5000; allow wider to see genuine faults, reject impossible |
| `temperature` | −40 to 85 °C | SCD41 operating range |
| `humidity` | 0–100 % | |
| `voc_index` / `nox_index` | 0–500 | Sensirion index scale |
| `measured_at` | within ±24h of now | rejects clock-skew garbage and backdated forgery |

Also: reject duplicate `(device_id, measured_at)` — add a unique index. A device
retrying after a network blip must not double-insert.

**Keep the reading if one field is out of range but others are valid?** Recommend no —
store the row with the bad field NULL and record the rejection in `events`, so a
degrading sensor is visible rather than silently dropped. This matters for the pilot's
"≥90% of measurements received" criterion.

### 2.5 Rate limiting

Devices report every 60s. Cap at ~1 accepted reading per 30s per device; return 429
beyond. This bounds the damage from a stuck-in-a-loop device or a leaked token.

## 3. Migration path (must not break the live sensor)

The existing sensor is currently offline, but the sequence must still be safe for a
device that reconnects mid-migration.

**Phase 1 — additive, zero risk.** Create tables, add `deployment_id`, deploy
`/api/ingest`. Backfill: one `deployments` row per existing device, `started_at` =
its first reading, `ended_at` = NULL; set `deployment_id` on historical rows by
device. Old anon path still works. Nothing breaks.

**Phase 2 — dual-path.** Provision a token per device, reflash, confirm each device
appears via `/api/ingest` (watch `last_used_at`). Both paths accept writes here. This is
the step that needs the firmware and someone watching.

**Phase 3 — close the old door.** Only once every device is confirmed on the new path:

```sql
DROP POLICY "air_quality_anon_sync_insert" ON public.air_quality;
DROP POLICY "air_quality_anon_sync_select" ON public.air_quality;
REVOKE INSERT, SELECT, UPDATE, DELETE ON public.air_quality FROM anon;
```

Phase 3 also clears the two `multiple_permissive_policies` warnings and most of the 31
`pg_graphql_*_table_exposed` warnings deferred from M1 (DECISIONS D8). Re-run the
advisors after.

**Rollback at any phase:** Phases 1–2 are additive; roll back by ignoring the new path.
Phase 3 is the only one-way door — recreate the policies from
`supabase/_snapshots/2026-08-04-pre-milestone-1.sql` if needed.

## 4. Multi-device per account

Confirmed as the intended model. `devices.user_id` already supports one-to-many, so the
schema is fine. What needs changing is the code that assumes exactly one device:

- `schimmel_device_context()` — picks a single "primary" device by most-recent reading.
  Should take an explicit `deployment_id`.
- `/api/notifications/check` — reads the single latest `air_quality` row for the user
  with **no device filter**, so one chatty device masks a silent problem on another.
  Must iterate per active deployment.
- `thresholds` — keyed per user, not per device. A bedroom and a living room reasonably
  want different targets.
- ML retrain — one model per `user_id`. Two rooms' dynamics blended into one Ridge model
  learns a confused average. Should key on deployment.
- Dashboard/trends UI — needs a device switcher.

(Detailed in [../CALCULATIONS.md](../CALCULATIONS.md) §8–9.)

## 5. Forward-compatibility with QR self-install

The `claim_code` column exists so this needs no rework later. Intended flow: provision a
credential with `device_id = NULL` and a printed claim code → flash the device with its
token → resident scans the QR at home → an authenticated claim endpoint binds that
credential to a new `devices` row and opens a `deployments` row under their account.

Until claimed, a token can authenticate but has nowhere to write — so a stolen unclaimed
device yields nothing. Building the credential table with `device_id` nullable now is the
only thing required to keep that door open.

## 6. Open questions — need Jeroen

1. **Firmware constraints.** Can devices send a custom `Authorization` header, and can
   they be reflashed easily (OTA vs. physical)? If reflashing all 10 is painful, Phase 2
   changes shape. *Blocking for implementation.*
2. **Current wire format.** What exactly does the firmware POST today — field names,
   timestamp source (device clock or server `now()`), retry behaviour on failure? The
   ingest route should accept the existing shape where possible to minimise firmware
   change.
3. **Device clock.** Does the ESP32-S3 sync NTP? If not, `measured_at` must be
   server-assigned and the ±24h validation is meaningless.
4. **Buffering.** Does the device queue readings while offline and replay them? If yes,
   the ±24h window and the duplicate constraint both need to accommodate batch replay —
   and `/api/ingest` should accept an array, not just a single reading.
5. **`deployments` in M2 or M3?** Recommend M2 (§2.3). It is cheap now and unrecoverable
   later, but it does widen this milestone.

## 7. What this does not cover

- **Device liveness monitoring** — `last_used_at` is added here, but alerting on silence
  belongs to M3. Worth doing together: the pilot is judged on "≥8/10 devices continuously
  online" and nothing measures that today.
- **The woningcorporatie portal** — needs an organisation layer above the user. See
  [../WISHLIST.md](../WISHLIST.md) §1. `deployments` is a prerequisite for it, which is a
  second reason to build it here.
- **Anon grant tightening beyond `air_quality`** — other tables still carry broad anon
  grants (RLS-protected). Worth a sweep once the sensor no longer needs the anon role.
