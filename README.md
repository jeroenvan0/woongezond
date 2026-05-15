# Luchtkwaliteit Dashboard

Dash/Plotly dashboard dat live data uit Supabase toont.

## Lokaal draaien (macOS/Linux)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python app.py
```

Open dan http://localhost:8050

## Omgevingsvariabelen

Verplicht via `.env` in de projectmap:

```
SUPABASE_URL=https://kqzknfjkihbzkwqjlrsk.supabase.co
SUPABASE_KEY=sb_publishable_...
```

Optioneel (voor lokale run/Docker):

```
APP_HOST=0.0.0.0
APP_PORT=8050
DASH_DEBUG=0
APP_TIMEZONE=Europe/Amsterdam
MAX_POINTS=50000
MAX_FETCH_ROWS=600000
SUPABASE_PAGE_SIZE=1000
```

De app laadt deze variabelen automatisch bij opstarten via `.env`.

Bij lange periodes (30 dagen/1 jaar) gebruikt de app automatisch trendmodus:

- data wordt in batches opgehaald (paginering)
- data wordt geaggregeerd naar een passende resolutie
- diagnose toont langetermijntrends (CO₂, RH, schimmelrisico)

## Alternatieve app starten

Standaard start je `app.py`. Wil je de uitgebreide versie:

```bash
python app_v2.py
```

## Docker

### Met Docker Compose (aanbevolen)

```bash
cp .env.example .env
docker compose up --build
```

Open dan http://localhost:8050

### Met Docker CLI

```bash
cp .env.example .env
docker build -t woongezond-dashboard .
docker run --rm -p 8050:8050 --env-file .env woongezond-dashboard
```

## Productie startcommando

Via `Procfile`:

```bash
gunicorn app:server
```

## Hosten op Railway (aanbevolen, gratis tier)

1. Maak account op https://railway.app
2. "New project" → "Deploy from GitHub repo"
3. Push deze map naar een GitHub repo
4. Railway detecteert de Procfile automatisch
5. Voeg eigen domein toe via Settings → Domains

## Hosten op Render

1. Maak account op https://render.com
2. "New Web Service" → koppel je GitHub repo
3. Build command: `pip install -r requirements.txt`
4. Start command: `gunicorn app:server`
5. Voeg eigen domein toe via Settings → Custom Domains

## Eigen domeinnaam koppelen

Bij beide platforms: voeg een CNAME record toe bij je DNS provider:
```
CNAME  dashboard  <jouw-app>.railway.app
```
