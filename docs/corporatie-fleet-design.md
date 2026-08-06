# C1 — Corporatie-rol & vlootoverzicht: ontwerp

**Ontwerp, 2026-08-06.** Branch `feat/corporatie-fleet`, afgesplitst van `ui-improvements`.
Uitvoering van **C1** uit [ux-and-features-plan.md](./ux-and-features-plan.md), koers *corporatie-first*.

> **Status:** ontwerp + migraties geschreven, **nog niet toegepast op productie**. Zie
> [corporatie-fleet-progress.md](./corporatie-fleet-progress.md) voor wat gebouwd/toegepast is.

---

## 1. Het probleem

Vandaag is alles per-bewoner: RLS is overal `auth.uid() = user_id` (zie
[baseline_schema.sql](../supabase/migrations/00000000000000_baseline_schema.sql)). Een
woningcorporatie wil 10 (later honderden) woningen in één blik zien, met de woningen die
**actie eisen** bovenaan — zonder de privacy van de bewoner te schaden.

Twee harde randvoorwaarden uit de bestaande codebase sturen het ontwerp:

1. **DECISIONS D1 / `/api/health`:** apparaatnamen *zijn* voornamen van bewoners
   ("Jeroen Sensor"). Locaties en namen mogen nooit lekken. De health-endpoint splitst
   daarom bewust een publieke, geanonimiseerde vorm van een operator-detailvorm. De
   vlootweergave volgt exact dat patroon.
2. **`air_quality` is zesciijferig en groeit ~10× in de pilot.** De hot-path RLS moet
   goedkoop blijven (M1 wikkelde `auth.uid()` al in `(select auth.uid())` voor één
   InitPlan-evaluatie). We mogen die policy niet zwaarder maken met een org-join.

## 2. Kernbeslissing: aggregatie via SECURITY DEFINER, niet via bredere RLS

Een corporatie-gebruiker **leest nooit ruwe bewonersrijen.** In plaats daarvan levert een
`SECURITY DEFINER`-RPC **per-woning samenvattingen** (status, versheid, schimmelrisico,
laatste meting) voor **alleen woningen die toestemming hebben gegeven.**

Waarom deze aanpak i.p.v. de RLS op `air_quality`/`devices` verbreden:

| | Bredere RLS op air_quality | SECURITY DEFINER aggregatie-RPC (**gekozen**) |
|---|---|---|
| Hot-path kosten | Elke rij-check krijgt een org-join — duur op 6-cijferige tabel | Hot path onaangeraakt; RPC draait één geaggregeerde query |
| Lekoppervlak | Corporatie kan potentieel ruwe rijen + namen zien | RPC geeft alleen aggregaten + gepseudonimiseerd woninglabel |
| Toestemming intrekken | Rij-policy herzien | Eén `revoked_at` zetten; RPC filtert direct |
| Auditbaarheid | Verspreid over policies | Eén functie, één plek om te reviewen |

Dit spiegelt de bestaande `/api/health`-split en de `schimmel_device_context()`-RPC.

## 3. Datamodel (nieuwe tabellen)

```
organizations
  id            uuid pk
  name          text            -- "Woningcorporatie X"
  created_at    timestamptz

org_members                      -- wie mag namens de corporatie meekijken
  id            uuid pk
  org_id        uuid  -> organizations
  user_id       uuid  -> auth.users        -- de corporatie-medewerker
  role          text  default 'viewer'     -- 'admin' | 'viewer'
  created_at    timestamptz
  unique(org_id, user_id)

household_consents               -- de kern: bewoner geeft één corporatie inzage
  id            uuid pk
  org_id        uuid  -> organizations
  resident_id   uuid  -> auth.users        -- de bewoner (household = user_id)
  label         text                        -- gepseudonimiseerd, door corporatie beheerd
                                            -- ("Woning 12, Da Costastraat") — NOOIT de device-naam
  granted_at    timestamptz default now()
  revoked_at    timestamptz                 -- null = actief; gezet = ingetrokken
  unique(org_id, resident_id)
```

**Waarom `household_consents` de bewoner als bron van waarheid houdt:** de bewoner (of een
onboarding-flow namens de bewoner met expliciete opt-in) maakt de rij; de corporatie kan
'm niet zelf aanmaken. `revoked_at` maakt intrekken één UPDATE. `label` staat bij het
consent, niet bij het device, zodat de corporatie een neutrale aanduiding ziet en de
voornaam-in-device-naam nooit passeert.

`profiles.role` (bestaat al, default `'user'`) blijft de app-brede rol; org-lidmaatschap
is fijnmaziger en leeft in `org_members`. We hergebruiken `profiles.role` niet voor
corporatie-toegang omdat één persoon lid kan zijn van meerdere corporaties.

## 4. De aggregatie-RPC

```
fleet_overview(p_org_id uuid)
  RETURNS TABLE(
    consent_id     uuid,
    label          text,          -- gepseudonimiseerd woninglabel
    device_count   int,
    last_seen      timestamptz,
    minutes_since  int,
    stale          boolean,       -- zelfde 30-min regel als /api/health
    co2_latest     numeric,
    rh_latest      numeric,
    temp_latest    numeric,
    mould_risk     numeric,       -- WoonScore-achtig, hoger = meer risico
    severity       text           -- 'ok' | 'warn' | 'crit' — voor de ranking
  )
  SECURITY DEFINER
```

Toegangscheck binnenin (niet-omzeilbaar): de aanroeper moet lid zijn van `p_org_id`
(`exists (select 1 from org_members where org_id = p_org_id and user_id = auth.uid())`),
anders lege set. Levert alleen woningen met `revoked_at is null`. Geeft **geen**
device-namen, coördinaten of ruwe reeksen. `severity` is server-side afgeleid zodat de
ranking ("welke woning eist actie") niet van de client afhangt.

De schimmelrisico-afleiding hergebruikt de science-port in `lib/mouldModels.ts` waar
mogelijk; als de SQL dat niet compact kan, levert de RPC de ruwe laatste T/RH en rekent de
API-route de `mould_risk` met de bestaande TS-code (één plek voor de formule — CLAUDE.md:
science-ports in sync houden met de Flask-app).

## 5. Privacy & toestemming (expliciet)

- **Opt-in, niet opt-out.** Geen woning verschijnt in een vlootoverzicht zonder een rij in
  `household_consents` met `revoked_at is null`.
- **Intrekbaar.** De bewoner ziet in de app (`/delen`) welke corporatie meekijkt en kan
  intrekken (zet `revoked_at`); direct effect op de volgende RPC-aanroep.
- **Geaggregeerd + gepseudonimiseerd.** Corporatie ziet status per woning, geen ruwe
  metingen, geen namen/adressen tenzij de corporatie die zelf als `label` invulde.
- **Auditlog** (fase 2): elke `fleet_overview`-aanroep loggen (org, aanroeper, aantal
  woningen) — sluit aan op de JSON-logging in `lib/logger.ts`.

### 5.1 Hoe de bewoner toestemming geeft — invite-codes

Een bewoner mag `organizations` **niet** zien (RLS = alleen leden), dus kan niet zomaar een
org kiezen. Passend bij de firmware-provisioning "claim via code"-filosofie:

1. De corporatie maakt een **invite-code** aan (`org_invites`, migratie 20260806120200) met
   een vooraf ingevuld gepseudonimiseerd `label` (bv. "Woning 12, Da Costastraat").
2. De bewoner vult die code in op `/delen` → `redeem_org_invite(code)` (SECURITY DEFINER,
   schrijft alleen voor `auth.uid()`) maakt/heractiveert de `household_consents`-rij en
   markeert de invite als gebruikt.
3. De bewoner ziet daarna op `/delen` met wie hij deelt en kan met één klik stoppen
   (`revoked_at` zetten) of opnieuw delen.

De org-lijst blijft zo verborgen voor bewoners; de corporatie bepaalt het label vooraf.
`organizations` krijgt één extra SELECT-policy zodat de bewoner alleen de **naam** ziet van
een org waarmee hij een actieve toestemming heeft (voor het overzicht op `/delen`).

Oppervlak: `app/delen/page.tsx` (bewoner) + `app/api/consents/route.ts`
(GET lijst · POST inwisselen · PATCH intrekken/heractiveren). De corporatie-kant van het
aanmaken van invites is nog handmatig/seed (zie progress-doc); een invite-beheerscherm voor
de corporatie is fase 2.

## 6. UI-oppervlak

- Nieuwe route `/vloot` (fleet), alleen zichtbaar als de gebruiker in ≥1 `org_members` zit.
  Nav-item conditioneel in `AppShell`.
- Woningen als op-`severity`-gerangschikte lijst/kaarten: crit → warn → ok, met
  versheid-chip (hergebruik `DeviceHealthChip`-taal) en de vier KPI's.
- Klik op een woning → detail met de geaggregeerde trend (nog steeds geen ruwe namen).
- Deelt tokens/primitives uit de `ui-improvements`-branch (Card, SectionHeading, Stat,
  SegmentedControl, severity-kleuren).

## 7. Aansluiting op B3 (per-device scoping)

`fleet_overview` aggregeert per **woning** (resident/user_id). B3 maakt de bewoner-app
per-**device** (kamer). Beide leunen op dezelfde migratie die `air_quality_bucketed` een
`device_id`-param geeft; de fleet-RPC gebruikt datzelfde bucket-mechanisme per woning.
Zie [b3-a3-device-scoping.md](./b3-a3-device-scoping.md) (deze migratie) — bundelen.

## 8. Wat bewust NIET in deze fase zit

- **C2 benchmarking** (vergelijken tussen woningen) — pas nuttig zodra er vlootdata is.
- **Auditlog-tabel** — ontwerp hierboven benoemd, implementatie fase 2.
- **Self-service org-aanmaak** — orgs worden voorlopig handmatig/seed aangemaakt; de
  pilot heeft één corporatie.
- **Schrijfrechten voor de corporatie** — de vlootweergave is read-only; de corporatie
  kan niets aan een bewonerswoning wijzigen.

## 9. Migratievolgorde & toepassen

1. `…_add_org_and_consent_model.sql` — tabellen + RLS + `fleet_overview`-RPC (deze branch).
2. `…_air_quality_bucketed_device_param.sql` — B3/A3 (deze branch).

**Toepassen (nog te doen, door jou te reviewen):**
```bash
# tegen een Supabase-branch/preview eerst, nooit direct prod:
supabase db push            # of via de Supabase MCP apply_migration
npm run typecheck && npm run build && npm test
```
Daarna snapshot bijwerken in `supabase/_snapshots/` zoals de bestaande workflow.
