# ops — systemd units for the VPS

The app runs on a rented VPS under systemd, not Vercel. `woongezond-react.service`
(port 3001) serves the Next.js app; the units here are the scheduled jobs beside it.

| Unit | Schedule | What it does |
|---|---|---|
| `woongezond-weather.{service,timer}` | hourly, `*:05` | Fetches OpenWeather per city that has an active device → `city_weather` |
| `woongezond-notifications.{service,timer}` | every 15 min, `*:02,17,32,47` | Threshold + device-liveness alert sweep across all users |

Both POST a localhost route guarded by the `x-cron-secret` header, read from
`CRON_SECRET` in `/var/www/woongezond-dev-react/.env.local`.

## Installing / updating a unit

```bash
sudo cp ops/systemd/woongezond-notifications.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now woongezond-notifications.timer
```

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
