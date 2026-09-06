# Weekrapport per sensor — plan voor de wekelijkse mail

Status **2026-09-06**, branch `feat/pilot-cockpit`. Vervolg op
[pilot-cockpit-plan.md §2c](pilot-cockpit-plan.md) ("wie woont achter sensor N").

## Wat er al is

| Bouwsteen | Waar | Staat |
|---|---|---|
| Weekmail per **account** (B5) | `app/api/digest/weekly`, `lib/weeklyDigest.ts`, `ops/systemd/woongezond-digest.*` | Code klaar, timer **niet** geïnstalleerd op de VPS, gemaakt vóór de pilot: leest op `user_id`, en pilot-sensoren 2–8 hebben geen user |
| Contactlaag B | `device_contacts` (naam, e-mail, adres, `report_consent_at`), RLS `is_org_admin()` | Live. Sensor 01 heeft een contact met toestemming |
| Rapport-analytics | `lib/reportAnalytics.ts` (diagnose, tips), `lib/coverage.ts` (dekking, gaten) | Live, gebruikt door `/report` |
| Mail | `lib/email.ts` → Resend, retry-once, luid loggen | Werkt, **maar**: lokale `RESEND_API_KEY` is ongeldig ("API key is invalid"), VPS heeft er geen, `ALERT_FROM_ADDR` is overal leeg, en er is nog geen geverifieerd afzenderdomein |
| Ondertekende, stateless tokens | `lib/pilot/session.ts` (HMAC, 30 min, één device) | Live; zelfde mechanisme is herbruikbaar voor een rapportlink van 30 dagen |

## Wat er vandaag bij is gekomen

- `lib/report/weeklyDeviceReport.ts` — pure functie: week aan metingen van één device +
  huisprofiel + voornaam → onderwerp, tekst en HTML. Hergebruikt `buildDiagnosis`/`buildTips`
  zodat de mail nooit iets anders zegt dan `/report`. Eén extra tip uit het huisprofiel
  (2 slapers + raamventilatie, was binnen drogen, condens), alleen als de metingen erbij
  passen. Meetdekking en gaten staan er eerlijk in; < 84 uur data krijgt een disclaimer.
  Variant "geen metingen" met de stekker/wifi-checklist. Tests: `tests/weeklyDeviceReport.test.ts`.
- `scripts/report-preview.mts` (`npm run report:preview -- --device 1 [--send | --to adres]`)
  — schrijft `.html`/`.txt`, verstuurt optioneel via Resend. Weigert te sturen naar een
  contact zonder `report_consent_at`.
- `lib/email.ts` — `sendEmail({to, subject, text, html})`; `sendAlertEmail` is er een wrapper om.
- Testmails naar jeroenvanoostendorp@gmail.com zijn vandaag via Gmail verstuurd (Resend
  werkt nog niet): het echte rapport van sensor 01 en de "geen metingen"-variant.

## Ontwerp van de wekelijkse verzending

**Wie krijgt wat.** Eén mail per rij in `device_contacts` met `email` én `report_consent_at`.
Niet per account (B5) — de pilot-sensoren hebben geen account, en een corporatie-admin mag
nooit het rapport van een bewoner in zijn mailbox krijgen. Sensoren zonder contact worden
stil overgeslagen (dat is de privacy-default: geen toestemming, geen mail).

**Wanneer.** Maandag 08:00 Europe/Amsterdam, periode = vorige maandag 00:00 t/m zondag
24:00. De bestaande `woongezond-digest.timer` staat al op `Mon 08:00`; die gaat het nieuwe
endpoint aanroepen en B5 vervalt (of blijft bestaan voor accounts zonder pilot-device, keuze
in stap 3).

**Route.** `POST /api/report/weekly` met `x-cron-secret`, `?dry=1` voor preview (per contact:
sensornummer, onderwerp, verdict, aantal metingen; **geen e-mailadres in de response of de
logs**, alleen device-id). Zelfde patroon als `digest/weekly`. Per device:
`air_quality` op `device_id` sinds periodestart, gepagineerd (een week is ~10k rijen; de
digest kapte af op 5000, dat is te weinig voor een eerlijk weekbeeld).

**Idempotent.** Nieuwe tabel `report_sends (device_id, period_start, sent_at, verdict,
message_id)` met unique `(device_id, period_start)`. Een herstart van de timer stuurt nooit
twee keer, en de cockpit kan "rapport verstuurd 7 sep" tonen (§2c punt 4).

**Link in de mail → `/rapport?t=…`.** Ondertekend token à la `issueSession`, maar 30 dagen
geldig en met prefix `wgr_` (zodat een rapporttoken nooit de wizard in kan). De pagina rendert
`/report` voor precies dat device via de service-role, zonder login. Hetzelfde token dient
voor "geen rapport meer ontvangen" (`/rapport/afmelden?t=…` zet `report_consent_at` op NULL).
Tot die pagina bestaat gaat de mail zonder knop; de tekst staat op zichzelf.

**Afzender.** Resend met een geverifieerd domein: `rapport@woongezond.com` (SPF + DKIM records
in DNS van woongezond.com, DMARC `p=none` om te beginnen). Reply-to naar jouw adres zodat
bewoners kunnen antwoorden. Nieuwe API-key, in `.env.local` op de VPS én lokaal.

**Toon.** "Hoi <voornaam>," (of "Hallo," bij "Fam. …"), één kop, drie blokken: hoe ging het,
tips voor komende week, meetdekking. Max 4 tips, ernstigste eerst. Geen getallen zonder
duiding (elk cijfer krijgt een woord: "vaak te benauwd", "prima").

## Stappen — stand 2026-09-06 (avond)

1. [x] **Resend**: domein woongezond.com geverifieerd, sleutel + afzender lokaal in `.env.local`.
   Nog op de VPS zetten (zie onder).
2. [x] **Route + tabel**: `app/api/report/weekly` (cron-secret; `?dry=1`, `?device=&force=1`,
   `?rolling=1`), `lib/report/sweep.ts`, tabel `report_sends` (migratie 20260906130000,
   toegepast), weekgrenzen in `lib/report/period.ts` (getest rond zomer-/wintertijd).
   Dry-run vandaag: 1 contact, week 24–30 aug, 5.466 metingen, oordeel "aandachtspunten".
3. [x] **Timer omgehangen**: `woongezond-digest.service` roept nu `/api/report/weekly` aan;
   `ops/README.md` bijgewerkt. Installeren op de VPS: `sudo cp ops/systemd/woongezond-digest.* /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now woongezond-digest.timer`.
4. [x] **Rapportlink**: token `wgr_` (`lib/report/token.ts`, 30 dagen, één device), pagina
   `/rapport?t=…` (`app/api/rapport` levert 15-min-gemiddelden), afmelden via
   `/rapport/afmelden?t=…` → `report_consent_at = NULL`. Knop + afmeldlink staan in de mail.
5. [x] **Cockpit** `/cockpit` (org-admin): per sensor contact, toestemming, laatste rapport,
   "Nu versturen" (afgelopen 7 dagen, ook als deze week al ging); plus de klantenservice-inbox.
6. [ ] **Later**: huisprofiel meenemen in de bestaande rapport-tips (de CO₂-tip noemt
   "mechanische ventilatie" bij iemand met alleen een raam); buitenweer uit `city_weather`;
   maandrapport als PDF.

### Uitrollen (VPS)
`.env.local` op de VPS aanvullen met `RESEND_API_KEY`, `ALERT_FROM_ADDR`, `PUBLIC_BASE_URL`,
`SUPPORT_*`, `RESEND_WEBHOOK_SECRET` (waarden: lokaal `.env.local`), branch uitrollen,
`systemctl restart woongezond-react`, timer installeren, dan eerst `?dry=1`.

## Testplan vóór de eerste echte verzending

- `?dry=1` toont precies de contacten met toestemming, en niets anders.
- Sensor met 0 metingen → "geen metingen"-mail (niet stil overslaan: de bewoner moet weten
  dat de sensor uit staat).
- Contact zonder `report_consent_at` → geen mail, wel geteld als overgeslagen.
- Twee keer draaien op dezelfde maandag → tweede keer 0 verstuurd.
- Mail bekeken in Gmail (web + telefoon) en Apple Mail; de HTML gebruikt alleen inline
  styles en tabellen, geen externe afbeeldingen.
