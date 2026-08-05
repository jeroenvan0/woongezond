# Woongezond — Luchtkwaliteit (React / Next.js)

Production React port of the Dash/Flask air-quality dashboard. Next.js 16 (App
Router) · React 19 · TypeScript · Tailwind 4 · Supabase (auth + data) · Recharts.

Live: `https://woongezond-react.vostech.group` (systemd `woongezond-react`, port 3001).

## Pages

| Route | What |
|-------|------|
| `/dashboard` | Live KPIs (CO₂, temp, RV, schimmel, dauwpunt, gezondheid), weather + AQI bar, insight banner, moving-average smoothing, tabs (Metingen / Dauw & schimmel / Ventilatie / Diagnose), **ML-voorspelling** card, AI chat |
| `/trends` | Daily health timeline (+7-day rolling, intervention markers), monthly score bars (+ est. outdoor temp), season×hour heatmap, **period comparison with seasonal correction**, intervention tracking (CRUD) |
| `/schimmelrisico` | **VTT Mould Index + WUFI-Bio** models over the T/RH series, WoonScore hero, MI/SER charts, dual-axis T/RH chart, material class (k₂), model explanation |
| `/scenarios` | What-if calculator (season, outdoor T/RH, occupants, ACH, heating, window habit), live results, ML card, AI recommendations, saved-scenario comparison |
| `/login` | Supabase email/password auth |

## Cross-cutting features

- **Notifications** — `NotificationBell` in the header: threshold settings (CO₂ / RV),
  unread badge, auto-check via `POST /api/notifications/check` (rate-limited, optional
  email through `RESEND_API_KEY`).
- **AI chat** — tool-calling assistant (`query_sensor_data`, `query_current_weather`),
  live data + weather context, markdown rendering, conversation history, 👍/👎 feedback.
- **ML** — self-learning Ridge-regression CO₂/RH forecaster (`lib/ml`, see its README).

## Key code

```
app/api/        data · chat · recommendations · weather · ml/{model,retrain} · notifications/check
lib/            calculations · trends · mouldModels · chatTools · ml/* · supabase/*
components/     MetricCard · ChartCard · SensorChart · TimeSeriesChart · DualAxisChart
                HealthTimelineChart · MonthlyTrendChart · HourHeatmap
                NotificationBell · MLPredictionCard · ChatWidget · Navigation
```

## Environment (`.env.local`)

Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENWEATHER_API_KEY`.
Optional: `RESEND_API_KEY`, `ALERT_FROM_ADDR` (email alerts — no-op when unset);
`CRON_SECRET` (guards the weather-ingest route);
`NEXT_PUBLIC_BASE_PATH` (serve the whole app under a prefix, e.g. `/admin` — leave
unset to serve at the domain root; must match at build time and runtime).

## Develop / build / deploy

```bash
npm run dev                       # dev server
npm run build && npm start        # production
sudo systemctl restart woongezond-react   # reload the live service after a build
```

**Do not keep a working copy inside an iCloud-synced folder** (`~/Documents` or
`~/Desktop` when "Desktop & Documents Folders" is on). iCloud evicts file contents
and leaves dataless placeholders; Next.js reads its own runtime with `readFileSync`
during boot, and those synchronous reads block in `read(2)` waiting for a
materialisation that never arrives. The symptom is `next dev` hanging forever with
**zero output** and no listening port — not an error, just silence. `git status` and
`rsync` over the same tree stall the same way. Check with:

```bash
find . -flags +dataless | wc -l   # should be 0
```

Clone to a non-synced path (`~/Developer/...`, `~/code/...`) instead. From there the
dev server is ready in well under a second.

## Supabase

Per-user RLS (`auth.uid() = user_id`) on `air_quality`, `interventions`, `thresholds`,
`notifications`, `chat_sessions`/`chat_messages`, `ml_models`, `ml_feedback`. Each user
sees only their own sensor data and model.
