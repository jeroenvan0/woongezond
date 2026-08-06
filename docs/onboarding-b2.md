# B2 — Onboarding-wizard

**2026-08-06.** Onderdeel van [ux-and-features-plan.md](./ux-and-features-plan.md). Branch `feat/onboarding`.

## Doel
Een nieuwe bewoner (pilot) op dag één niet met een leeg dashboard laten staan, maar in een
korte flow zijn woning laten inrichten. Pilot-blokker uit het plan (H3 / I2-vervolg).

## Flow — `/welkom`
Gefocuste, overslaanbare wizard (buiten `AppShell`, eigen gecentreerde layout) met voortgangsbalk:

1. **Welkom** — wat komt eraan, geruststelling (later aanpasbaar).
2. **Je sensor** — per device: naam + kamer (`location`) + isolatieklasse. Maakt het
   schimmeladvies nauwkeuriger. Geen device? Uitleg dat hij verschijnt zodra geplaatst.
3. **Meldingen** — CO₂- en luchtvochtigheid-drempels (let op / kritiek).
4. **Delen** — uitleg over delen met de corporatie (opt-in, via code op `/delen`); nu niets doen.
5. **Klaar** — naar het dashboard.

## Implementatie
- `app/welkom/page.tsx` — client-wizard. **Geen schema-wijziging**: hergebruikt bestaande
  tabellen:
  - `devices` (update naam/`location`/`insulation`, RLS = eigen rijen);
  - `thresholds` (upsert per `metric` ∈ {`co2`,`humidity`} met `warning_value`/`critical_value`
    — exact dezelfde vorm als `NotificationBell`, zodat wizard en meldingen-instellingen
    dezelfde rijen delen).
- Instap: knop **"Richt je woning in"** in `FirstRunNotice` (verschijnt op het lege dashboard).
- Afronden/Overslaan zet `localStorage['wz-onboarded'] = '1'` en gaat naar `/dashboard`.

## Bewust NIET in deze stap
- **Device-claim via code/QR** (uit firmware-provisioning) — vergt firmware-coördinatie +
  een claim-tabel/RPC (spiegelt het org-invite-patroon). Losse vervolgstap; de wizard werkt
  nu op reeds aan het account gekoppelde devices.
- **Onboarding-status in de DB** — nu een localStorage-vlag (per browser). Een
  `profiles.onboarded_at` kan later een auto-redirect over apparaten heen ondersteunen.

## Verificatie
`npm test` 92 pass · typecheck clean · `npm run build` clean (`/welkom` aanwezig).
