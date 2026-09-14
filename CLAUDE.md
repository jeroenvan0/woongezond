# CLAUDE.md — Woongezond React app

Next.js 16 App Router port of the Dash/Flask luchtkwaliteit dashboard. See README.md for the full feature map.

- Verify layout changes with Puppeteer (headless, args --no-sandbox).
- If `next dev` hangs with no output at all, the checkout sits in an iCloud-synced folder — see the iCloud note in README.md. Never wait it out; it never resolves.
- After a build, restart the live service: `systemctl restart woongezond-react` (port 3001).
- Science ports live in `lib/` (calculations, trends, ml/) — keep them in sync with the Flask app in /var/www/woongezond-dev. Exception: `lib/mouldRisk.ts` replaced the Flask mould models (CALCULATIONS.md §4.4); it is the reference now.
- All user data is per-user RLS; sensor data belongs to user_id (woongezond@vostech.group owns the real readings).
- Luchtmomenten (`lib/ventilationEvents.ts`, Cockpit › Analyse) worden nu per aanvraag uit de ruwe rijen
  berekend en nergens opgeslagen. **Volgende stap (besloten 2026-09-14): wegschrijven in de database** —
  tabellen voor momenten (label, ACH-interval, zekerheid, bewijs, detectorversie), dagkenmerken per sensor
  en feedback ("klopt dit?"), gevuld door een dagelijkse job. Reden: het schimmelmodel moet straks de
  gemeten luchtwisseling en vochtproductie van het huis zelf gebruiken in plaats van vaste aannames, en
  de zekerheid van de labels kan pas geijkt worden als er beoordeelde momenten liggen. De fysica (ACH uit
  de decay) blijft een regel; alleen de labelzekerheid mag later getraind worden. Het moet wel kloppen:
  eerst valideren met raamcontacten in de winter, dan pas in rapport of weekmail. Plan en stand:
  docs/huisprofiel-luchtgedrag-plan.md §4.
