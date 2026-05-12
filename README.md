# Luchtkwaliteit Dashboard

Dash/Plotly dashboard dat live data uit Supabase toont.

## Lokaal draaien

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open dan http://localhost:8050

## Omgevingsvariabelen

Verplicht via `.env` in de projectmap:

```
SUPABASE_URL=https://kqzknfjkihbzkwqjlrsk.supabase.co
SUPABASE_KEY=sb_publishable_...
```

De app laadt deze variabelen automatisch bij opstarten.

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
