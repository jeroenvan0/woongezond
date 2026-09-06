# ops — systemd units for the VPS

The app runs on a rented VPS under systemd, not Vercel. `woongezond-react.service`
(port 3001) serves the Next.js app; the units here are the scheduled jobs beside it.

| Unit | Schedule | What it does |
|---|---|---|
| `woongezond-weather.{service,timer}` | hourly, `*:05` | Fetches OpenWeather per city that has an active device → `city_weather` |
| `woongezond-notifications.{service,timer}` | every 15 min, `*:02,17,32,47` | Threshold + device-liveness alert sweep across all users |
| `woongezond-digest.{service,timer}` | weekly, `Mon 08:00` | Weekly per-sensor report email to every consenting contact (`/api/report/weekly`, see docs/rapport-weekmail-plan.md) |

Both POST a localhost route guarded by the `x-cron-secret` header, read from
`CRON_SECRET` in `/var/www/woongezond-dev-react/.env.local`.

## Installing / updating a unit

```bash
sudo cp ops/systemd/woongezond-notifications.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now woongezond-notifications.timer
```

The weekly digest installs the same way:

```bash
sudo cp ops/systemd/woongezond-digest.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now woongezond-digest.timer
# Preview without sending (per-household counts + subjects), any time:
SECRET=$(grep -m1 '^CRON_SECRET=' /var/www/woongezond-dev-react/.env.local | cut -d= -f2-)
curl -fsS -X POST -H "x-cron-secret: $SECRET" 'http://localhost:3001/api/report/weekly?dry=1' | jq
# One sensor, now, even if this week was already sent (what the cockpit's "Nu versturen" does):
curl -fsS -X POST -H "x-cron-secret: $SECRET" 'http://localhost:3001/api/report/weekly?device=<uuid>&force=1&rolling=1' | jq
```

The digest only sends real email once `RESEND_API_KEY` is set (`lib/email.ts` is a no-op
otherwise), so the timer is safe to enable before the mail provider is configured.

## Verifying

```bash
systemctl list-timers 'woongezond-*'          # next/last run for each
systemctl status woongezond-notifications     # last invocation's exit status
journalctl -u woongezond-notifications -n 50  # the curl output
journalctl -u woongezond-react -o cat | jq 'select(.level=="error")'   # app-side errors
```

That last one works because the app logs one JSON object per line (`lib/logger.ts`).

## Before enabling the notification timer for the first time

Dry-run it. This reports exactly which alerts *would* fire and writes nothing:

```bash
SECRET=$(grep -m1 '^CRON_SECRET=' /var/www/woongezond-dev-react/.env.local | cut -d= -f2-)
curl -fsS -X POST -H "x-cron-secret: $SECRET" \
  'http://localhost:3001/api/notifications/check?dry=1' | jq
```

Worth doing after any threshold change too — a misconfigured threshold across 10
households is 10 people getting emailed at 3am.

## Health

```bash
curl -s http://localhost:3001/api/health | jq                       # public: counts only
curl -s -H "x-cron-secret: $SECRET" http://localhost:3001/api/health | jq   # per-device
```

`status` is `ok` / `degraded` (a device is stale) / `error` (DB unreachable, HTTP 503).
**`degraded` returns HTTP 200 on purpose** — a stale sensor is a device problem, and a
supervisor must not restart or roll back the app because a resident unplugged theirs.
Point uptime monitoring at the status code; point a human at the `status` field.

## VPS layout (`ops/vps/`)

One VPS (`vostech`, 153.92.223.130, `ssh root@153.92.223.130`) hosts two copies of this app.
Both use the same Supabase cloud project and `NEXT_PUBLIC_BASE_PATH=/admin`.

| URL | Branch | Checkout | Unit | Port |
|---|---|---|---|---|
| https://woongezond.com/admin | `main` | `/var/www/woongezond-dev-react` (legacy name) | `woongezond-react` | 3001 |
| https://dev.woongezond.com/admin | `dev` | `/var/www/woongezond-react-dev` | `woongezond-react-dev` | 3002 |

Flow: feature branches → PR into `dev` → test on dev.woongezond.com → PR `dev` → `main`.

```bash
cd /var/www/woongezond-dev-react
ops/vps/deploy.sh prod     # pull main, npm ci, build, restart, curl-check
ops/vps/deploy.sh dev      # same for the dev checkout
ops/vps/setup-dev.sh       # one-time: clone dev, unit, nginx site, certbot (needs the A record first)
ops/vps/cleanup-vostech-urls.sh   # retire the old *.vostech.group URLs + Dash apps (done 2026-09)
```

The nightly cloud→local Supabase mirror (`sync_runs`) lives in `/opt/supabase-sync/sync.py`
and is independent of the app.
