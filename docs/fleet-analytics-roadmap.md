# Fleet-analytics — roadmap voor portfolio-brede corporatie-inzichten

**2026-08-06.** Vervolg op [corporatie-fleet-design.md](./corporatie-fleet-design.md)
(C1, geleverd) en de bredere [ux-and-features-plan.md](./ux-and-features-plan.md) (C2/C3).
**Doel:** een corporatie moet straks over de héle vloot patronen zien — niet één sensor,
maar combinaties, grote afwijkingen, cohorten en trends — alles **geaggregeerd en
geanonimiseerd**.

> Dit is een ontwerp-/richtingdocument. Nog niets hiervan is gebouwd; het bouwt voort op wat
> er wél staat (C1 vlootoverzicht, huisprofiel bij provisioning, consent-model). Lees dit
> samen met de "wat staat er al"-sectie onderaan.

---

## 1. Waar we nu staan (de fundering)
- **`/vloot`** toont een per-woning lijst op ernst (crit/warn/ok), alleen voor woningen met
  toestemming, gepseudonimiseerd. Via `fleet_overview()` — een `SECURITY DEFINER`-RPC die
  aggregaten teruggeeft, nooit ruwe rijen (privacy per DECISIONS D1).
- **Huisprofiel** wordt nu bij provisioning vastgelegd: isolatie, bouwjaar, woningtype,
  plaatsing. **Dit is de sleutel tot cohorten** — je kunt straks segmenteren op woningkenmerk.
- **Consent** (opt-in, intrekbaar) bepaalt welke woningen meetellen.

De volgende stap is van een *lijst* naar *portfolio-intelligentie*.

## 2. De capaciteiten die een corporatie wil (geordend)

### F1 — Portfolio-dashboard (het "hoe staat mijn vloot ervoor")
Eén scherm met vloot-brede KPI's, allemaal geaggregeerd:
- % woningen gezond / let-op / actie-nodig (nu al af te leiden, maar als trend).
- Verdelingen i.p.v. losse getallen: histogram van gemiddelde CO₂/RV over de vloot,
  "hoeveel woningen zitten structureel boven 70% RV".
- Vloot-trend over tijd: verbetert het portfolio? Seizoenseffect eruit gefilterd
  (hergebruik `lib/trends.ts` seizoenscorrectie).
- Sensor-gezondheid vloot-breed: hoeveel sensoren offline/stil (nu al in `/api/health`).

**Grootte M.** Nieuwe RPC's `fleet_stats(org)`, `fleet_distribution(org, metric)`.

### F2 — Afwijkingsdetectie ("grote afwijkingen")
Welke woningen wijken **sterk af van de vlootnorm**? Dit is de kern van je vraag.
- Statistisch: z-score of percentiel per metriek t.o.v. de vloot. "3 woningen in de
  slechtste 10% voor vocht", "deze woning ligt 2,5σ boven de mediaan CO₂".
- Snelle stijgers: woningen met de grootste *verslechtering* week-op-week (delta-ranking),
  niet alleen absolute stand — vroege waarschuwing.
- Robuuste statistiek (mediaan/MAD i.p.v. gemiddelde/σ) zodat een paar extreme woningen de
  norm niet vertekenen.

**Grootte M.** RPC `fleet_outliers(org, metric, method)`; server-berekend zodat de ranking
niet van de client afhangt (zoals `severity` nu al).

### F3 — Cohorten & combinaties (waaróm wijkt iets af)
Groepeer op woningkenmerk en vergelijk — dit maakt het *actionable* voor een corporatie:
- Segmenteer op isolatieklasse, bouwjaar-band, woningtype, (later) complex/adres-cluster.
- "Slecht geïsoleerde woningen van vóór 1975 tonen 2× het schimmelrisico." Dat is een
  **onderhouds-/investeringssignaal**, niet één klacht.
- Combinaties van metrieken: de schimmel-triade (hoge RV + lage temp + weinig ventilatie)
  vloot-breed detecteren; woningen met de combinatie oplichten.
- Interventie-effectiviteit vloot-breed: werken vochtige-woning-maatregelen aantoonbaar?
  (koppelt aan de bestaande interventions/`beforeAfter` in `lib/trends.ts`.)

**Grootte L.** Vergt cohort-groepering in het datamodel (zie §4) + RPC `fleet_cohorts(org, dimension)`.

### F4 — Benchmarking (C2) — de bewoner in context
Zodra er cohort-aggregaten zijn: "jouw CO₂ is hoger dan 80% van vergelijkbare woningen."
Motiverend voor de bewoner, en eerlijk omdat het tegen *vergelijkbare* woningen is (zelfde
isolatie/type), niet tegen een nieuwbouwappartement. **Grootte M**, leunt op F3.

### F5 — Portfolio-werklijst & prioritering
Van inzicht naar actie: een gerangschikte lijst "welke woningen eerst bezoeken", met reden
(afwijking + trend + cohort-context) en geschatte impact. De corporatie plant hierop.
**Grootte M.**

### F6 — Vloot-alerts (cluster-detectie)
Meld de corporatie proactief bij een *opkomend cluster*: "5 woningen in complex X tonen
stijgende vochtigheid — mogelijk een schil-/ventilatieprobleem in het gebouw." Dit tilt het
van individuele klacht naar gebouwbeheer. **Grootte M–L**, leunt op §4 (complex-groepering)
en het bestaande sweep/timer-patroon (`ops/`).

## 3. Privacy & anonimisering (niet-onderhandelbaar)
De hele waarde valt of staat met vertrouwen. Regels die overal gelden:
- **k-anonimiteit.** Toon nooit een cohort/segment met minder dan *k* woningen (start k=5).
  Een cohort van 1 = de-anonimiserend. RPC's geven `null`/"te weinig woningen" onder k.
- **Alleen aggregaten.** Corporatie ziet verdelingen, tellingen, percentielen — nooit ruwe
  reeksen of een individuele naam/adres (behalve het gepseudonimiseerde label dat de
  corporatie zelf zette). Zelfde `SECURITY DEFINER`-poort als `fleet_overview`.
- **Consent blijft leidend.** Alleen woningen met actieve toestemming tellen mee; intrekken
  haalt een woning direct uit alle aggregaten.
- **Afwijking ≠ ontmaskering.** Een outlier tonen mag, maar met het pseudonieme label; de
  koppeling naar een echt adres blijft bij de corporatie zelf (buiten dit systeem).
- **Auditlog** (uit C1 §5) uitbreiden: log elke aggregatie-query (org, aanroeper, dimensie).

## 4. Datamodel-implicaties
- **Cohort-dimensies bestaan grotendeels al** op `devices`: `insulation`, `build_year`,
  `house_type`. F3/F4 kunnen hier meteen op. Voeg desgewenst een bouwjaar-band-helper toe.
- **Complex/adres-cluster** (voor F6) — nieuw: een `buildings`/`complexes`-tabel of een
  `complex_id` op `devices`, zodat "gebouw X" een groepeerbare eenheid wordt. Nog te ontwerpen.
- **Performance op schaal.** Bij honderden woningen worden live-aggregaties duur. Introduceer
  een **dagelijkse rollup** (`fleet_daily_rollup`: per woning per dag de kern-aggregaten) via
  een systemd-timer (zoals de weekmail/alert-sweep). Portfolio-trends en cohorten lezen dan de
  rollup, niet de zescijferige `air_quality`. Dit is de belangrijkste schaalbeslissing.
- **Materialisatie vs. RPC.** Klein (pilot, ≤tientallen woningen): live RPC's volstaan.
  Groot: rollup-tabel + eventueel materialized views, ververst door de timer.

## 5. Technische aanpak (consistent met wat er staat)
- Breid de `fleet_*`-RPC-familie uit, allemaal `SECURITY DEFINER` + org-membership-poort +
  k-anonimiteitscheck: `fleet_stats`, `fleet_distribution`, `fleet_outliers`,
  `fleet_cohorts`, `fleet_worklist`.
- Server-side afgeleide rankings/severity (nooit client), net als nu.
- Nieuwe route-familie onder `/vloot` (tabs: Overzicht · Afwijkingen · Cohorten · Werklijst),
  hergebruikt de bestaande tokens/primitives.
- Rollup-timer in `ops/` als de pilot groeit.

## 6. Voorgestelde volgorde
1. **F1 portfolio-dashboard** (zichtbare waarde, bouwt op bestaande aggregaten).
2. **F2 afwijkingsdetectie** (jouw expliciete vraag; direct nuttig).
3. **F3 cohorten** (leunt op het huisprofiel dat we nu al vastleggen) → ontgrendelt **F4 benchmarking**.
4. **F5 werklijst** en **F6 cluster-alerts** als de pilot draait en er genoeg woningen zijn.
5. **Rollup-tabel** invoeren zodra F1–F3 traag worden (schaalmoment, niet eerder).

## 7. Open vragen (voor morgen / met de compagnons)
- Welke drie inzichten wil een corporatie écht als eerste? (bepaalt F1-inhoud)
- Is "complex/gebouw" de juiste groepeer-eenheid, of ook wijk/bouwstroom?
- k voor k-anonimiteit: 5 veilig genoeg, of hoger voor kleine corporaties?
- Commercieel: is de portfolio-laag het betaalde product (corporatie-abonnement)?
- Welke cohort-dimensies leggen we nog meer vast bij onboarding (verwarmingstype,
  ventilatiesysteem, bewonersaantal)? Dit hoort in het corporatie-onboardingformulier.

---

## Wat staat er al (zodat je morgen doorpakt)
- `fleet_overview()` + `/vloot` — per-woning aggregaat, de blauwdruk voor alle `fleet_*`-RPC's.
- Huisprofiel (`devices.insulation/build_year/house_type`) — de cohort-dimensies, al vastgelegd.
- Consent + org-model + org-lid-RLS — de toegangs- en privacylaag.
- Provisioning + ingest — de datastroom die deze analytics voedt.
Zie de bijbehorende `*-design.md`/`*-progress.md` docs per onderdeel.
