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
Optional: `RESEND_API_KEY`, `ALERT_FROM_ADDR` (email alerts — no-op when unset).

## Develop / build / deploy

```bash
npm run dev                       # dev server
npm run build && npm start        # production
sudo systemctl restart woongezond-react   # reload the live service after a build
```

## Supabase

Per-user RLS (`auth.uid() = user_id`) on `air_quality`, `interventions`, `thresholds`,
`notifications`, `chat_sessions`/`chat_messages`, `ml_models`, `ml_feedback`. Each user
sees only their own sensor data and model.
