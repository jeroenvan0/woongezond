# Corporatie-first vervolg — progress log

Werk-doc voor branch `feat/corporatie-fleet` (afgesplitst van `ui-improvements`).
Volgt [ux-and-features-plan.md](./ux-and-features-plan.md), koers *corporatie-first*.
**Lees dit eerst bij hervatten.**

## TL;DR
Volgorde: **C1-ontwerp → migraties (C1 + B3/A3) → B3-code → fleet-scherm → A1 dashboard-IA.**
Migraties zijn **geschreven maar nog NIET toegepast op productie** — bewust: RLS is
veiligheidskritiek, toepassen is jouw review + run. Alle code draait op fallback-paden tot
toepassing, dus `npm test` (92), typecheck en `npm run build` zijn groen zonder migratie.

## Verificatiepoort
```bash
npm test && npm run typecheck && npm run build
```
Groen sinds de B3-wiring-commit.

## Status per stap

### C1 — corporatie-rol & vlootoverzicht
- [x] **Ontwerp** — [corporatie-fleet-design.md](./corporatie-fleet-design.md). Kernkeuze:
      aggregatie via `SECURITY DEFINER`-RPC (`fleet_overview`), niet via bredere RLS op
      `air_quality`. Opt-in toestemmingsmodel, gepseudonimiseerd woninglabel, privacy per
      DECISIONS D1.
- [x] **Migratie geschreven** — [`20260806120000_add_org_and_consent_model.sql`](../supabase/migrations/20260806120000_add_org_and_consent_model.sql):
      `organizations`, `org_members`, `household_consents` + RLS + `is_org_member()` +
      `fleet_overview()`. **Nog niet toegepast.**
- [x] **Fleet-scherm** — route `/vloot` + `app/api/fleet/route.ts` + severity-gerangschikte
      kaarten (crit→warn→ok, versheid-chip, 4 KPI's). Nav-item `Vloot` alleen zichtbaar voor
      org-leden (AppShell doet een `org_members`-count). Draait leeg + toont "geen vloottoegang"
      tot de migratie is toegepast — geen crash. typecheck + build groen.
- [x] **Consent-beheer** in de bewoner-app — `/delen` + `app/api/consents/route.ts`
      (GET lijst · POST code inwisselen · PATCH intrekken/heractiveren). Invite-gedreven:
      migratie [`20260806120200_add_org_invites_and_consent_rpc.sql`](../supabase/migrations/20260806120200_add_org_invites_and_consent_rpc.sql)
      voegt `org_invites` + `redeem_org_invite()` toe + een org-naam-SELECT voor bewoners
      met actieve toestemming. Shell heeft een "Delen"-ingang (sidebar + mobiele topbar).
      **Migratie nog niet toegepast.** typecheck + build groen.
- [ ] **Invite-beheerscherm voor de corporatie** (codes aanmaken in de UI) — nu handmatig/seed. NOG TE DOEN.

### B3 + A3 — per-device scoping & eerlijke ruwe telling
- [x] **Ontwerp** — [b3-a3-device-scoping.md](./b3-a3-device-scoping.md).
- [x] **Migratie geschreven** — [`20260806120100_air_quality_bucketed_device_param.sql`](../supabase/migrations/20260806120100_air_quality_bucketed_device_param.sql):
      `air_quality_bucketed(minutes, p_device_id)` + `air_quality_raw_count(...)`. **Nog niet toegepast.**
- [x] **Code gewired (defensief)** — `app/api/data/route.ts` accepteert `?device=<uuid>`,
      valt terug op de één-arg RPC en op `rows.length` als de migratie nog niet leeft.
      `lib/useSeries.ts` cache-key = window+device; dashboard geeft `selectedDevice` mee.
- [ ] **Per-kamer trends/schimmel** — alleen dashboard is nu device-scoped; trends + schimmel
      volgen hetzelfde patroon. NOG TE DOEN.
- [ ] **"Vergelijk kamers"-weergave** — NOG TE DOEN.

### A1 — dashboard-IA (Nu → Betekenis → Actie → Bewijs)
- [x] **Drie zone-headings** toegevoegd: *Nu in huis* (KPI's + versheid + weer) →
      *Wat dit betekent — en wat te doen* (ventilatie-advies + nacht + ML + diagnose, samen
      en op ernst) → *Bewijs — de metingen* (grafieken). `DiagnoseCard` van ONDER de grafieken
      naar boven verplaatst zodat al het advies bij elkaar staat. typecheck/build/tests groen.
- [ ] **Volledige merge tot één op-ernst-gerangschikte advieskaart** (ventilatie+nacht+ML+
      diagnose in één component met expliciete ranking) — grotere refactor, NOG TE DOEN.
      De zones + hergroepering zijn de veilige eerste helft; de echte samensmelting van de
      vier componenten kan daarna zonder de IA opnieuw aan te raken.

### Nog niet gestart (vervolg)
- **B2** onboarding-wizard · **B1** grond-waarheid (foto's, Storage) · **B5** weekmail ·
  **A2** notificaties · **A3-chat** paginacontext · **C2/C3**. Zie ux-and-features-plan.md.

## Migraties toepassen (jouw stap, te reviewen)
```bash
# NOOIT direct prod. Eerst tegen een Supabase-branch/preview (of de MCP apply_migration):
supabase db push
npm run typecheck && npm run build && npm test
# seed één organisatie + org_member (corporatie-medewerker) + een test-consent, dan /vloot.
```
Daarna snapshot bijwerken in `supabase/_snapshots/` (bestaande workflow) en, op de VPS na
een build: `systemctl restart woongezond-react` (poort 3001).

## Seed + end-to-end test (na toepassen migraties)
Draai in de Supabase SQL-editor (of via de MCP `execute_sql`). Vervang de UID's.

```sql
-- 1) Organisatie + corporatie-medewerker (jouw account als admin).
insert into organizations (name) values ('Test Corporatie') returning id;      -- <org>
insert into org_members (org_id, user_id, role) values ('<org>', '<jouw-uid>', 'admin');

-- 2a) Vlootweergave testen zonder invite-flow: direct een toestemming zetten.
insert into household_consents (org_id, resident_id, label)
  values ('<org>', 'b2025777-5d28-4d74-9280-2eb970318a4f', 'Woning 1 — testreeks');
select * from fleet_overview('<org>');   -- moet één woning met severity teruggeven

-- 2b) OF de echte bewoner-flow testen: maak een invite-code aan…
insert into org_invites (org_id, code, label)
  values ('<org>', 'WONING-7F3A', 'Woning 7, teststraat');
--     …log daarna in als de BEWONER en vul die code in op /delen.
--       redeem_org_invite maakt dan de household_consents-rij automatisch.
```

Verwacht: `/vloot` toont de woning(en) op severity; `/delen` (als bewoner) toont met wie je
deelt + "Stop delen". De nav-items verschijnen alleen bij de juiste rol (Vloot voor
org-leden; Delen voor iedereen).

## Open / risico's
- Migraties niet toegepast → fleet-scherm toont leeg tot dat gebeurt (bewust).
- `fleet_overview` severity-drempels (CO2 1200/1500, RV 70/80) zijn app-defaults; als
  bewoners eigen `thresholds` hebben, kan een latere versie die per woning gebruiken.
- `mould_risk` staat in het ontwerp maar de RPC levert 'm nog niet — nu severity uit
  CO2/RV + staleness. Schimmelrisico per woning kan de API later met `lib/mouldModels.ts`
  bijrekenen.

## Commits (nieuwste onder)
- (volgt) docs: corporatie-first vervolg — plan + design
- (volgt) C1: org/consent datamodel + fleet_overview RPC (migratie, nog niet toegepast)
- (volgt) B3+A3: device-param RPC + eerlijke rawCount + defensieve /api/data wiring
