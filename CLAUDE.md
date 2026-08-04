# CLAUDE.md — Woongezond React app

Next.js 16 App Router port of the Dash/Flask luchtkwaliteit dashboard. See README.md for the full feature map.

- Verify layout changes with Puppeteer (headless, args --no-sandbox).
- After a build, restart the live service: `systemctl restart woongezond-react` (port 3001).
- Science ports live in `lib/` (calculations, trends, mouldModels, ml/) — keep them in sync with the Flask app in /var/www/woongezond-dev.
- All user data is per-user RLS; sensor data belongs to user_id (woongezond@vostech.group owns the real readings).
