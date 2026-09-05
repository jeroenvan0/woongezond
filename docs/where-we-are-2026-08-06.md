# Waar we staan — 2026-08-06 (lees dit eerst morgen)

Overzicht van alles wat deze week is gebouwd, de PR-/branch-staat, de migraties die je nog
moet toepassen, en de aanbevolen volgende stap. Elke feature heeft z'n eigen `*-design.md`
+ `*-progress.md`; dit is de index eroverheen.

## Branches & PR's (merge-volgorde!)
De feature-branches zijn **gestapeld**. Merge van onder naar boven:

| PR | Branch → base | Inhoud | Staat |
|----|---------------|--------|-------|
| #4 | ui-improvements → main | UI/UX + kleursysteem + a11y | **gemerged** |
| #5 | feat/corporatie-fleet → ui-improvements | Vlootoverzicht, consent, B3/A3, dashboard-IA | **gemerged** |
| #6 | feat/onboarding → main | Onboarding-wizard (B2) + weekmail (B5) | **gemerged** |
| #7 | feat/device-provisioning → main | QR-koppeling, huisprofiel, foto's, WiFi-scaffold | **open** |
| #8 | feat/device-ingest → feat/device-provisioning | Per-device ingest + Feather S3-contract | **open (stacked)** |

**Doen:** merge #7, daarna #8 (of retarget #8 naar `main` na #7). Deze docs-branch
(`docs/fleet-roadmap-and-partner-update`) staat los van de code en kan los gemerged worden.

## Migraties — geschreven, NOG NIET toegepast (jouw review + apply)
Alle app-code valt defensief terug tot je ze toepast. Review de RLS/Storage-policies expliciet.
Volgorde = bestandsnaam.

1. `20260806120000_add_org_and_consent_model.sql` — organizations/org_members/household_consents + `fleet_overview()`.
2. `20260806120100_air_quality_bucketed_device_param.sql` — per-kamer scoping + echte rawCount.
3. `20260806120200_add_org_invites_and_consent_rpc.sql` — invite-codes + `redeem_org_invite()`.
4. `20260806120300_add_device_provisioning.sql` — devices org_id/huisprofiel + user_id nullable, claim-codes, foto's, **Storage-bucket + policies**, `redeem_device_claim()`.
5. `20260806120400_add_device_ingest.sql` — `devices.ingest_token` + backfill bij koppelen.

Toepassen: `supabase db push` (of MCP `apply_migration`) tegen een branch/preview → `npm run typecheck && npm run build && npm test` → snapshot bijwerken in `supabase/_snapshots/`. VPS: `systemctl restart woongezond-react`.

## Wat er nu functioneel is (na toepassen migraties)
- **Bewoner:** dashboard-IA (Nu/Betekenis&actie/Bewijs), per-kamer grafieken, onboarding `/welkom`,
  delen-beheer `/delen`, apparaat koppelen `/koppel`, weekmail.
- **Corporatie:** vlootoverzicht `/vloot`, uitnodigingscodes `/uitnodigingen`, sensor provisionen
  `/vloot/koppelen` (huisprofiel + QR + token + foto), veilig ingest-pad `/api/ingest`.
- **Ops:** weekmail-timer (`ops/systemd/woongezond-digest.*`).

## Documentatie-index
- **Pilot / hardware:** [pilot-feather-s3-plan.md](./pilot-feather-s3-plan.md) — firmware-contract Feather ESP32-S3.
- **Provisioning:** [device-provisioning-design.md](./device-provisioning-design.md) · [-progress.md](./device-provisioning-progress.md).
- **Corporatie/consent:** [corporatie-fleet-design.md](./corporatie-fleet-design.md) · [-progress.md](./corporatie-fleet-progress.md).
- **Per-kamer/rawCount:** [b3-a3-device-scoping.md](./b3-a3-device-scoping.md).
- **Onboarding:** [onboarding-b2.md](./onboarding-b2.md).
- **Vloot-intelligentie (nieuw, richting):** [fleet-analytics-roadmap.md](./fleet-analytics-roadmap.md).
- **Overkoepelend plan:** [ux-and-features-plan.md](./ux-and-features-plan.md).
- **Compagnon-update (HTML):** [updates/partner-update-2026-08-06.html](./updates/partner-update-2026-08-06.html).

## Aanbevolen volgende stap
1. Merge #7 + #8, pas de migraties toe tegen een Supabase-branch, seed één org + testsensor
   (recepten in de progress-docs), en loop de hele keten één keer door met echte klikken.
2. Begin daarna aan **fleet-analytics F1 (portfolio-dashboard)** en **F2 (afwijkingsdetectie)** —
   zie [fleet-analytics-roadmap.md](./fleet-analytics-roadmap.md). Het huisprofiel dat we nu
   vastleggen ontgrendelt F3 (cohorten) en F4 (benchmarking).
3. Volgende week: firmware Feather S3 → `provisionWifi()` invullen + het ingest-contract
   fijnslijpen op wat de sensor echt stuurt.

## Openstaande grotere vragen (voor met de compagnons)
Welke 3 vloot-inzichten wil een corporatie eerst? · Is de portfolio-laag het betaalde product? ·
Welke woningkenmerken leggen we bij onboarding vast (verwarming/ventilatie/bewoners)? ·
k voor k-anonimiteit? · Go-to-market bij corporaties (vocht vs. verduurzaming vs. gezondheid)?
