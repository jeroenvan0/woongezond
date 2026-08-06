# UX & features plan — na de UI-improvements

**Voorstel, 2026-08-06.** Vervolg op [ui-ux-plan.md](./ui-ux-plan.md) / [ui-ux-progress.md](./ui-ux-progress.md).

De `ui-improvements`-branch heeft het **uiterlijk** goed gezet: kleursysteem, tokens,
toegankelijkheid (WCAG AA), responsive, skeletons, één gedeelde datalaag, en de
*eerlijkheids*-laag (versheid, demo-data, foutbanners). Dat is grotendeels **presentatie
en correctheid** — niet gedrag/flow (UX) of nieuwe functionaliteit.

Dit document pakt dat op: eerst de UX-fixes die al in het oorspronkelijke plan waren
uitgesteld (Fase 6.3–6.5, I1–I4), daarna nieuwe features, en tot slot een paar grotere
strategische keuzes. Alles is gescoord: **S** ≈ halve dag · **M** ≈ 1–2 dagen · **L** ≈ 3+ dagen.

Doelgroep-context: luchtkwaliteit voor de sociale huur. Twee persona's die vandaag door
elkaar lopen: **de bewoner** (gezond wonen, snapt wat te doen) en **de corporatie/verhuurder**
(bewijs van vocht/schimmel als "gebrek", een vloot woningen die aandacht nodig heeft).
De 10-device pilot komt eraan (zie [ROADMAP.md](../ROADMAP.md)).

---

## A. UX-fixes — gedrag & flow, geen nieuw datamodel

Goedkoop, hoge waarde, kan direct op een vervolgbranch. Sluit de UX-schuld die de
UI-branch bewust liet liggen.

| # | Wat | Waarom | Grootte |
|---|---|---|---|
| **A1** | **Dashboard-IA herzien (was 6.3): *Nu → Wat betekent dit → Wat te doen → Bewijs.*** Nu is het dashboard één ongedifferentieerde scroll van 9 blokken op bijna gelijk gewicht. Voeg de vier advies-bronnen (ventilatie-banner, nacht-vooruitblik, ML-kaart, diagnose) samen tot **één op-ernst-gerangschikte adviesstroom** met een concrete actie bovenaan (*"Zet vanavond 20 min de ramen open — CO₂ liep op naar 1400 ppm in de slaapkamer"*). | De bewoner weet nu niet wat het belangrijkste is. Dit is de grootste UX-winst per euro. | **M** |
| **A2** | **Notificaties actiegericht + beheerbaar maken (F3-rest).** Nu: drempel-alerts, geen groeperen/verwijderen. Voeg toe: verwijderen, groeperen per type, en een *actie-regel* per melding (niet "CO₂ hoog" maar "ventileer nu"). | Meldingen zijn losse feiten, geen hulp. | **S–M** |
| **A3** | **Chat opent met paginacontext (B5).** De chat-FAB opent overal context-vrij; laat 'm de huidige pagina + geselecteerd device meesturen, zodat *"waarom is mijn schimmelrisico gestegen?"* meteen werkt via de bestaande diagnose-engine. | Van "leuk speeltje" naar echte assistent, met code die er al is. | **S** |
| **A4** | **Score-verhaal in plaats van drie losse getallen (A4-rest).** De labels zijn al goed gezet; voeg één *"wat betekent dit voor mijn woning"*-samenvatting die de drie scores in gewone taal verbindt. | Bewoner kan drie 0–100-schalen nog steeds niet tegen elkaar lezen. | **S** |
| **A5** | **Jargon uitleggen op de plek zelf (H2).** ACH, MI, SER, k₂, dauwpunt: de goede uitleg staat nu weggeklapt en alleen op de schimmelpagina. Hergebruik `InfoHint` overal waar de term valt. | Vertrouwen in een bewijs-product hangt op begrijpelijkheid. | **S** |

**Aanbevolen volgorde:** A1 eerst (structureel), dan A3+A2 (adviesketen), dan A4+A5 (taal).

---

## B. Nieuwe features — nieuw datamodel of nieuw scherm

Elk onafhankelijk te leveren. B1 en B2 zijn pilot-versnellers.

| # | Feature | Waarom nu | Grootte | Blokkade |
|---|---|---|---|---|
| **B1** | **Grond-waarheid vastleggen (was 6.5 / I4).** Breid Interventies uit met een *"observatie"*-type: *"zichtbare schimmel hier, deze datum"* + kamer + optionele foto. | `CALCULATIONS.md` §10 heeft dit nodig om de VTT/WUFI-modellen te valideren — zonder kan de pilot de modellen niet toetsen. Maakt het rapport ook sterker als bewijs. | **M** | foto-opslag (Supabase Storage + RLS) |
| **B2** | **Onboarding-wizard voor pilot-huishoudens (was 6.2-rest / I2).** Na signup: *claim je sensor* (code/QR uit [firmware-provisioning.md](./firmware-provisioning.md)) → benoem de kamer → stel drempels → klaar. | Pilot-blokker: 10 huishoudens moeten zichzelf kunnen inrichten zonder jou. | **M** | koppelt aan firmware-provisioning |
| **B3** | **Per-kamer / per-device beleving (6.1-rest + I1).** Device-switcher bestaat al; maak grafieken + drempels per device en een *"vergelijk kamers"*-weergave (slaapkamer vs badkamer). | Vocht/schimmel is kamer-specifiek; nu mengt alles. | **M** | DB-migratie: `air_quality_bucketed` RPC een `device_id`-param geven (zelfde migratie als A3-rawCount) |
| **B4** | **Deelbaar bewijs-rapport ("deel met verhuurder").** Van het rapport een echt exporteerbaar/deelbaar artefact maken: PDF-download + optioneel mailen naar de corporatie, met een vaste referentie/datumstempel. | De "gebrek"-use-case is het hart van het product; nu is het rapport een pagina, geen document dat je overhandigt. | **M** | e-mail bestaat al (Resend); PDF-render toevoegen |
| **B5** | **Wekelijkse woonsamenvatting per e-mail.** Vriendelijke weekmail aan de bewoner (*"deze week 3 nachten verhoogd schimmelrisico in de badkamer — tip: …"*), en optioneel een maandoverzicht naar de corporatie. | Engagement + retentie in de pilot; hergebruikt `reportAnalytics` + `email` + de bestaande timers. | **S–M** | systemd-timer (net als de alert-sweep) |
| **B6** | **Adaptieve/persoonlijke drempels.** Nu vaste CO₂/RV-grenzen; laat ze meebewegen met seizoen/woningtype, of leer een per-woning basislijn. | Minder valse alarmen, relevanter advies. | **M** | bouwt op de bestaande ML-laag |

---

## C. Grotere strategische keuzes — het product laten groeien

Los van de pilot-leverlijst; hier zit de meeste productwaarde maar ook de meeste inspanning.

- **C1 — Corporatie-/verhuurdersrol & vlootoverzicht (L).** Een tweede persona: de
  corporatie wil 10 (later honderden) woningen in één blik zien, met de woningen die
  *actie* nodig hebben bovenaan. Vereist een rollenmodel bovenop de huidige per-bewoner-RLS
  (een corporatie-gebruiker die geaggregeerd meekijkt, met toestemming). Dit is de grootste
  uitbreiding en tegelijk de meest waarschijnlijke commerciële richting.
- **C2 — Benchmarking tegen vergelijkbare woningen (M, na C1).** *"Jouw CO₂ is hoger dan
  80% van vergelijkbare woningen"* — context die pas kan als er vlootdata is.
- **C3 — Proactieve, voorspellende meldingen (M).** Combineer `nightForecast` + ML tot een
  *"vanavond risico"*-melding **vóór** het slapengaan, met één concrete actie — i.p.v.
  achteraf melden dat het misging.

---

## Afhankelijkheden & één gedeelde DB-migratie

Drie items wachten op dezelfde migratie — bundel ze:
- **A3-rawCount** (echte ruwe telling uit `air_quality_bucketed`) — al bekend uit het UI-plan.
- **B3** (`device_id`-param op dezelfde RPC).
- **B1** (Supabase Storage-bucket + RLS voor observatie-foto's).

Science-ports (`lib/`) blijven in sync met de Flask-app in `/var/www/woongezond-dev`
(zie CLAUDE.md) — B6/C3 raken die laag.

---

## Voorgestelde eerste stap — **besloten: corporatie-first (2026-08-06)**

Het rollenmodel bepaalt het datamodel waar B3 en C2 op leunen, dus dat gaat voorop.

1. **C1 — verkenning + datamodel** (rollen bovenop de per-bewoner-RLS: een corporatie-gebruiker
   die met toestemming geaggregeerd meekijkt). Ontwerp eerst, bouw daarna het vlootoverzicht.
2. **B3 — per-device/kamer-scoping** meenemen in dezelfde DB-migratie (`device_id`-param op
   `air_quality_bucketed`, plus A3-rawCount) — dit is de datalaag die C1's aggregatie voedt.
3. **A1 — dashboard-IA** parallel, want een op-ernst-gerangschikt advies is precies wat een
   vlootoverzicht per woning nodig heeft ("welke woning eist actie?").
4. Daarna de bewoner-pilotlijn: **B2 → B1 → B5**.

Zo levert de corporatie-richting meteen de bouwstenen (rollen, per-device data, ranking) die
de bewoner-features later hergebruiken.
