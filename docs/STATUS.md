# STATUS — where the work stands

Last updated **2026-08-05**, branch `milestone-1-foundation`.

This is the "pick it back up" page. [../ROADMAP.md](../ROADMAP.md) is the plan;
this is the current position on it.

---

## Blocked on you — three things

1. **Enable leaked-password protection.** Supabase dashboard → Authentication → Policies.
   One toggle, still off (confirmed via the security advisor today). It is an Auth service
   setting, so it cannot be done in a migration. Worth doing before 10 households sign up.
2. **Deploy the two new systemd timers.** Code is written and tested locally; nothing runs
   in production yet. Instructions: [../ops/README.md](../ops/README.md). Dry-run first.
3. **Approve the notification dedupe**, which requires deleting duplicate rows from
   production — see [known-issues.md §KI-4](known-issues.md#ki-4--every-notification-is-written-twice-pre-existing-race).

## Blocked on hardware (expected ~2026-08-06)

Milestone 2 — the device trust model — is the pilot's real blocker and cannot be
implemented without the firmware. Design is written and waiting:

- [milestone-2-device-trust-design.md](milestone-2-device-trust-design.md) — credential
  model, `deployments` table, ingest route, 3-phase migration that doesn't break the live
  sensor. Five open questions at §6, of which "can the firmware send a custom
  `Authorization` header, and can it be reflashed OTA?" is the blocking one.
- [firmware-provisioning.md](firmware-provisioning.md) — written today in response to
  "the firmware must be different per device, but the user must be able to install it
  easily". Headline recommendation: **one firmware image for every device**; per-device
  identity written as NVS data at the bench (~2 s, no recompile), Wi-Fi entered by the
  resident through a SoftAP captive portal, because their password cannot be known at
  flash time.

## Live system, as of today

| | |
|---|---|
| App | Running on the VPS, systemd `woongezond-react`, port 3001 |
| Weather ingest | **Healthy** — hourly timer, last observation 5 min old when checked |
| Sensor `3f1380c9…` "Jeroen Sensor" | **Back online 2026-08-05 ~19:02Z**, after ~56 h silent |
| Sensor `084c71f1…` "Jannouk Sensor" | **Silent since 2026-05-25** (~72 days) |
| Sensor `a1000000…` "Feather S3" | **Never reported** |
| `air_quality` | 115,481 rows at 15:00Z |

The active sensor had stopped abruptly mid-day on 2026-08-03 after months of steady
1,424 rows/day — the shape of a power cut or Wi-Fi drop, not a failing sensor — and
resumed during this session. It was down ~56 hours and nothing would have reported that;
it was found only by looking. Two of three devices are still dark. See
[known-issues.md §KI-3](known-issues.md#ki-3--sensor-outages-going-unnoticed).

## Landed today (2026-08-05)

All verified: `npm test` (72 passing), `npm run typecheck`, `npm run build`, plus headless
Chrome for the CSP.

**Milestone 3 — reliability (code complete, not deployed)**

- `app/api/health/route.ts` — DB reachability + last-ingest-per-device. Public response is
  counts only; per-device detail needs `x-cron-secret`, so it can't re-leak resident names
  the way `get_device_locations()` did. `degraded` is HTTP 200 on purpose, so a supervisor
  never restarts the app because a resident unplugged a sensor.
- `app/api/notifications/check/route.ts` — rewritten. One sweep implementation, two doors:
  `x-cron-secret` sweeps every user, a browser session sweeps only its own. Now
  **device-scoped**, adds `device_offline` alerts, and supports `?dry=1`.
- `lib/email.ts` — Resend send with retry-once and loud logging on double failure,
  replacing a silent `catch {}`.
- `lib/logger.ts` — one JSON line per event, so `journalctl … | jq` is finally useful.
- `ops/systemd/woongezond-notifications.{service,timer}` + `ops/README.md`.

**Milestone 4 — hardening**

- `proxy.ts` — nonce-based CSP with `strict-dynamic`. (Next 16 renamed `middleware.ts` to
  `proxy.ts`.) `next.config.ts` keeps the static headers: X-Frame-Options, nosniff,
  Referrer-Policy, Permissions-Policy, HSTS, and `no-store` on all API responses.
- `lib/rateLimit.ts` — applied to `/api/chat`, `/api/recommendations`, `/api/ml/retrain`,
  `/api/notifications/check`, keyed per user after auth.
- `tests/` + `vitest` — 72 tests over the calculation layer. `npm test`.

**The two UI defects you reported — both fixed and verified**

- **Smoothing (KI-1)**: the slider is now valued in data points and states its real window
  (`12 uur · 12 punten`, `1 punt = 1 uur`), correct at every period. Conversion lives in
  `lib/smoothing.ts` with 20 tests. Fixing it exposed two more distortions of the same
  kind, both also fixed: the KPI cards read the last *bucket*, so the headline showed
  1016 ppm at 24 h and 736 ppm at 30 days for the same instant — they now read 1013 ppm at
  every period and do not move with the slider; and they could stick on "—" whenever
  `loading` was set without a refetch firing.
- **Notification centre (KI-2)**: `NotificationBell` is placement-aware. Verified with zero
  clipping across seven viewports (1440×900, 1280×720, 1440×620, 1440×500, collapsed rail,
  390×844, 360×640), with the panel at its tallest.

**Documentation**

- [known-issues.md](known-issues.md) — every defect with its root cause. KI-1 and KI-2 are
  fixed; KI-3 (sensor outages), KI-4 (duplicate notifications) and KI-5 (Google Fonts)
  remain open.

## Deliberately not done, and why

- **`rawCount` is still wrong** (KI-1's tail): the RPC returns the bucketed row count, so
  the "meetpunten" footer understates reality by up to 360×. Fixing it means changing the
  `air_quality_bucketed` RPC, which is a database change, not a UI one.
- **ML retrain is still user-scoped**, unlike the alert sweep. Making it device-scoped
  requires deciding whether a model belongs to a device or an account — that is bound up
  with the multi-device UI in M4, so it shouldn't be settled in passing.
- **The KPI query has no device filter.** It shows the newest reading from any of the
  account's devices, matching the rest of the dashboard's single-device assumption. The
  device switcher in M4 is where that gets settled.
- **Rate limiting is in-process memory.** Correct for one `next start` process; wrong the
  moment the app is containerized or scaled. Flagged in the file itself.

## Verify the current state yourself

```bash
npm test && npm run typecheck && npm run build
npm run dev                     # ready in <1s from ~/Developer (NOT from iCloud — see README)
curl -s localhost:3000/api/health | jq
```

The repo is clean and everything above is committed. Nothing is half-applied: no database
changes were made today, and the four `device_offline` notification rows in production
were written by the app's own session path from an open browser tab, not by a migration.
