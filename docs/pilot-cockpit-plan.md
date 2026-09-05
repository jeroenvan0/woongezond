# Pilot-cockpit — 8 sensoren, 8 huizen, één ontwikkelaars-cockpit

**2026-09-05, branch `feat/pilot-cockpit` (vanaf `dev`).** Plan voor de pilotfase: acht Feather
S3 + SCD41 sensoren, elk in een ander huis, allemaal afzonderlijk te volgen vanuit één scherm
dat Jeroen als ontwikkelaar gebruikt. Bouwt voort op
[pilot-feather-s3-plan.md](./pilot-feather-s3-plan.md) en
[firmware-provisioning.md](./firmware-provisioning.md), maar kiest nu concreet.

## 1. Waar we vandaag staan (gemeten, niet aangenomen)

| Onderdeel | Staat |
|---|---|
| Firmware (`~/Documents/Arduino/Jannouk/Jannouk.ino`) | Arduino, SCD41, POST rechtstreeks naar Supabase REST met de **anon-key**. WiFi-SSID, wachtwoord, anon-key, `device_id` en `location` **hardcoded** in de sketch. Geen NTP, geen buffer, 60 s interval, 3 retries. |
| Database (project `vciwibiiisobhotzxcyn`) | 3 devices: placeholder "Feather S3" (0 metingen), "Jannouk Sensor" (laatste meting 25 mei), "Jeroen Sensor" (136k metingen, laatste **2 sep** — 3 dagen stil). **Geen** van de vijf migraties van 6 aug is toegepast: geen `org_id`, geen `ingest_token`, geen `organizations`, geen `fleet_overview()`. |
| App | `/api/ingest` (token-auth), `/vloot/koppelen` (provisioning + QR + token), `/koppel`, `/vloot` staan in `main`/`dev` maar vallen leeg terug zolang de migraties ontbreken. |
| Servers | prod `woongezond.com/admin` (main), dev `dev.woongezond.com/admin` (dev), zelfde Supabase-project. |

Twee gevolgen: (a) elke sensor draagt nu het "hoofdsleutel"-geheim van de hele database en een
WiFi-wachtwoord in platte tekst; (b) niets meet vandaag of een sensor nog leeft — Jeroen's
eigen sensor is al drie dagen stil zonder dat iets dat meldt.

## 2. Beslissingen

1. **Eén firmware-image voor alle acht.** Per-apparaat gegevens zijn *data*, geen code:
   het device-token gaat in NVS via de Arduino `Preferences`-library, WiFi via een captive
   portal (`WiFiManager`). Geen recompile per huis, geen wachtwoord in de sketch.
2. **Het token is de identiteit.** Server maakt per sensor een `wgd_…`-token
   (`/vloot/koppelen` doet dit al). De firmware stuurt alleen dat token; de server weet
   welke `device_id`, welk huis, welke bewoner. De sketch kent geen UUID's meer.
3. **Sensoren blijven in de pilot "ongeclaimd".** Ze horen bij één organisatie
   ("Pilot", Jeroen = admin) met `user_id = NULL`. Bewoners hoeven geen account. Zolang een
   sensor ongeclaimd is, mag de org-beheerder de ruwe data zien (dat is de cockpit). Claimt
   een bewoner 'm later via de QR, dan schakelt het bestaande consent-model in en ziet de
   corporatie alleen nog aggregaten tenzij de bewoner deelt. Privacy-verhaal blijft dus kloppen.
4. **De cockpit is per apparaat, niet per huishouden.** `/vloot` blijft de corporatie-view
   (aggregaten, consented). De cockpit (`/cockpit`) toont alle org-apparaten: online/stil,
   laatste meting, signaalsterkte, firmware-versie, herstarts, grafiek, logboek — ongeacht
   claim of consent, alleen voor org-admins.
5. **`deployments` (M2 §2.3) nog niet.** Acht vaste plaatsingen; huisprofiel staat op
   `devices`. Verhuist een sensor, dan een nieuw device provisionen en de oude op inactief.
   Bewuste schuld, genoteerd.
6. **Anon-sync-policy uit** zodra de laatste sensor op een token draait
   (`air_quality_anon_sync_insert/select`).

## 2b. Bewoner-zelfservice: één QR, WiFi instellen, huisvragen beantwoorden

**Gewenst (Jeroen, 5 sep):** de bewoner scant zelf de QR op het apparaat, zet de WiFi en
beantwoordt een paar vragen over het huis. Geen installateur, geen account nodig.

### Waarom het twee werelden zijn, en hoe we ze aan elkaar knopen
WiFi instellen kan **alleen via de sensor zelf** (de telefoon moet met het apparaat praten, en
dat kan pas als het op WiFi zit — kip-ei, opgelost met een tijdelijk eigen netwerkje van de
sensor). De huisvragen horen **op de server**. Eén QR moet dus beide werelden aansturen.
De website is slim, de sensor is dom:

```
sticker-QR  →  woongezond.com/start?code=DEVICE-7K2P   (opent op mobiel internet)
                 │
                 ├─ stap 1  "Steek de sensor in het stopcontact."
                 ├─ stap 2  "Ga naar WiFi-instellingen, kies  Woongezond-07 ."
                 │            → captive portal van de sensor opent vanzelf:
                 │              thuisnetwerk kiezen + wachtwoord → sensor test 'm →
                 │              "Verbonden ✓, je kunt terug naar de website"
                 │          de webpagina pollt intussen /api/devices/status?code=…
                 │          en springt zelf op groen zodra de eerste meting binnenkomt
                 ├─ stap 3  huisvragen (bouwjaar, woningtype, isolatie, kamer, hoeveel
                 │          mensen slapen er, ventilatie/roosters, verwarming) → opgeslagen
                 │          op het device via de code, zonder login
                 └─ stap 4  (optioneel) "Wil je je eigen lucht zien? Maak een account" → claim
```

De code in de QR is het geheim: wie 'm heeft, mag het huisprofiel van *dat ene* apparaat
invullen. Dat is hetzelfde vertrouwensmodel als de bestaande koppelcode. De code staat alleen
op de sticker en in de database, **niet** in de firmware.

### Wat dit verandert t.o.v. de rest van het plan
- **Nieuw** `/start?code=…` — publieke, code-gegate wizard (mobiel-first). Hergebruikt de
  vragen uit `/welkom` (onboarding B2) en de huisprofielvelden van `/vloot/koppelen`.
- **Nieuw** `POST /api/devices/profile` (code + antwoorden, service-role, schrijft
  `build_year/house_type/insulation/location/placement_note` + nieuwe kolommen
  `occupants int`, `ventilation text`, `heating text`), en `GET /api/devices/status?code=…`
  (alleen `online: bool, last_seen`) voor de groene vink.
- **Firmware**: open AP `Woongezond-0N` (geen AP-wachtwoord — bestaat alleen tot de WiFi
  staat, en je moet fysiek in huis zijn). Portal met netwerklijst, wachtwoord, **verificatie
  vóór opslaan** ("wachtwoord klopt niet" i.p.v. stil herstarten), 5 GHz-melding. Standaard
  `WiFiManager`-gedrag; de portal-tekst eindigt met "ga terug naar de website".
- **Sticker**: één QR (URL) + het nummer + "WiFi: Woongezond-0N". Géén WiFi-join-QR meer
  (iOS opent daar geen captive portal van, en twee QR's = de verkeerde scannen).
- **Corporatie-provisioning blijft** voor jou als beheerder (`/vloot/koppelen` maakt device,
  token, code, QR-sticker). De bewoner vult het huisprofiel; jij ziet en corrigeert het in
  `/cockpit/[id]`.
- Open vraag 1 (login voor bewoners?) is hiermee beantwoord: **niet nodig**, optioneel in stap 4.

### Valkuilen die we vooraf afdekken
| Valkuil | Antwoord |
|---|---|
| Telefoon verliest internet zodra hij op de sensor-AP zit | De wizardpagina is volledig client-side geladen; de poll pauzeert en hervat. |
| iOS sluit het captive-portal-venster na verbinden | Prima: de webpagina meldt zelf "sensor online" via de poll. |
| Bewoner vult de huisvragen in voordat de WiFi staat | Mag; stappen zijn onafhankelijk, de code is genoeg. |
| Iemand raadt een code | 32^4 ≈ 1M combinaties + rate limit op `/start`-API's + code alleen geldig voor niet-ingevulde apparaten of met `expires_at`. |
| Twee huizen delen een sensor-naam | AP-naam bevat het device-nummer; nummer staat ook op de sticker. |

## 3. Wat er gebouwd wordt

### Fase 0 — fundament (voorwaarde voor alles, ~1 dagdeel)
- [ ] De vijf migraties van 6 aug toepassen op het Supabase-project (Jeroen: review RLS +
      Storage-policies, dan `supabase db push` of SQL-editor). Additief, breekt niets bestaands.
- [ ] Nieuwe migratie `20260905…_pilot_cockpit.sql`:
  - `devices`: `device_number int unique` (1–8, op de sticker), `fw_version text`,
    `last_seen_at timestamptz`, `last_rssi int`, `boot_count int`, `notes text`.
  - `device_events` (id, device_id, at, kind `placed|moved|reset|note|offline|online`,
    text, created_by) — het logboek per sensor ("14 sep bij fam. X in de slaapkamer gehangen").
  - RLS: org-**admin** mag `air_quality` van org-apparaten lezen **waar `devices.user_id IS NULL`**
    (ongeclaimd) — via een `SECURITY DEFINER` RPC `org_device_series(p_device_id, minutes)`
    die `device_in_my_org()` én de admin-rol checkt, zodat de raw-tabel-policies onaangeraakt blijven.
  - RPC `cockpit_overview(p_org_id)`: per device laatste meting, metingen/24u, %-uptime 24u/7d.
- [ ] Seed: organisatie "Pilot", Jeroen als admin. Bestaande "Jeroen Sensor" aan de org hangen
      (`org_id`, `device_number = 1`, token minten) zodat die als eerste op het nieuwe pad gaat.

### Fase 1 — firmware v2 (één image, ~1 dag, hardware nodig)
Nieuwe sketch `firmware/woongezond-sensor/` **in deze repo** (nu leeft 'm alleen in
`~/Documents/Arduino`, ongeversioneerd).
- [ ] `Preferences` namespace `wg`: `token`, `base_url`. Bij boot: geen token → **serial
      provisioning-modus**: op de USB-monitor `SET TOKEN wgd_…` en `SET URL https://dev.woongezond.com/admin`
      typen (of via `scripts/provision-device.mts`, zie fase 3). Geen recompile.
- [ ] `WiFiManager`: geen WiFi-creds → AP `Woongezond-0N` + captive portal. Lange druk op
      BOOT-knop (10 s) wist **alleen** WiFi, nooit het token.
- [ ] POST naar `<base_url>/api/ingest` met `x-device-token`. Body:
      `{co2, temperature, humidity, rssi, fw, uptime_s, boot_count}` — de laatste vier zijn
      nieuw en voeden de cockpit. `/api/ingest` gaat ze accepteren en op `devices` bijwerken.
- [ ] Buffer: ring van 60 metingen in RAM; bij herstel WiFi als **array** posten
      (`/api/ingest` accepteert dan `[...]`, met `offset_s` per meting → server-tijd minus offset).
- [ ] `FW_VERSION` constante; 2× knipperen = geen WiFi, 3× = token afgewezen (401).
- [ ] Eerst **één** board volledig rond (serial erbij), dan pas de andere zeven.

### Fase 2 — cockpit in de app (~2 dagen)
- [ ] `/cockpit` (org-admin only, link in AppShell): tabel 8 rijen — nr, naam/huis, status
      (● online / ◐ stil >30 min / ○ nooit gezien), laatste meting, CO₂/T/RV nu, metingen/24u,
      uptime 7d, RSSI, fw, boot_count, claim-status. Klik → detail.
- [ ] `/cockpit/[id]`: grafiek (hergebruik dashboard-componenten met `?device=`), 24u/7d/30d,
      huisprofiel bewerken, token + QR + koppelcode (bestaat al in `/vloot/koppelen`, hierheen
      verplaatsen), logboek (`device_events`) met vrije notitie, CSV-export van de ruwe reeks.
- [ ] `/start?code=…` bewoner-wizard + `/api/devices/profile` + `/api/devices/status` (zie §2b).
- [ ] `/cockpit/vergelijk`: alle 8 CO₂-lijnen in één grafiek (verschillen tussen huizen zien).
- [ ] `/api/health`-detail gebruikt `last_seen_at` (goedkoop) i.p.v. 8 max()-queries; de
      notifications-timer meldt "sensor N is 2 uur stil" aan Jeroen (die timer staat nog niet
      op de VPS — installeren na fase 0).

### Fase 3 — uitrol (per huis ~15 min)
- [ ] `scripts/provision-device.mts --number N --name "Fam. X — slaapkamer"`: maakt het device
      via de API, print token + koppelcode, schrijft token via serial naar het board, en doet een
      dry-run POST om te checken dat de server 'm herkent. Sticker: nummer + WiFi-QR van de AP.
- [ ] Thuis (bewoner zelf, §2b): QR scannen → `/start` → WiFi via portal → huisvragen → in de
      cockpit springt rij N op online, huisprofiel ingevuld. Logboekregel "geplaatst" automatisch.
- [ ] Na de achtste: anon-policy droppen.

## 4. Lokaal testen ("ik wil een localhost zien")
```bash
npm run dev            # http://localhost:3005  (lokaal géén /admin-prefix; zelfde Supabase als prod/dev!)
```
- **Echte sensor → localhost:** de Feather zit op hetzelfde WiFi als de Mac. Zet als `base_url`
  `http://<ip-van-de-mac>:3005` (bijv. `http://192.168.1.23:3005`; lokaal geen /admin). Werkt zonder
  HTTPS, precies wat je wilt om ingest te debuggen met de serial monitor ernaast.
- **Zonder hardware:** `scripts/simulate-devices.mts` post voor 8 fictieve tokens realistische
  dagcurves (CO₂ stijgt 's nachts in een slaapkamer) naar localhost. Deze devices krijgen
  `type = 'simulated'` en `device_number` 101–108, en het script heeft `--cleanup`.
- **Schone database:** omdat localhost tegen het productie-project praat, is voor migratie-
  experimenten een Supabase-branch (`supabase branches create pilot`) de veilige route; de
  app hoeft dan alleen andere `NEXT_PUBLIC_SUPABASE_URL/KEY` in `.env.local`.

### Zo test je het nu al (zonder hardware, zonder migraties) — gebouwd 2026-09-05
```bash
npm run dev:mock                                   # = PILOT_MOCK=1 next dev -p 3005 (mock is uit in productie)
npm run pilot:qr -- --code DEVICE-MOCK1            # sticker-QR (PNG + terminal) met het LAN-IP van je Mac
npm run pilot:sim -- --token wgd_mock_1            # nepsensor: elke 10 s een meting naar /api/ingest
```
Scan de QR met je telefoon (zelfde WiFi) → `/start?code=DEVICE-MOCK1` → "Beginnen" → het
WiFi-scherm wacht → start de nepsensor → het scherm springt op groen → tien vragen → klaar.
Acht mock-apparaten: `DEVICE-MOCK1..8` met tokens `wgd_mock_1..8` (`lib/pilot/store.ts`).
Met een echte Feather: `base_url = http://<ip-van-de-mac>:3005` en een mock-token, of na de
migraties een echt token uit `npm run pilot:seed`.

Wat er staat: `app/start` (wizard), `app/api/devices/status` + `profile`, `lib/houseProfile.ts`
(de tien vragen + afleiding van isolatieklasse), `lib/pilot/store.ts` (mock/Supabase),
migratie `20260905120000_pilot_house_profile.sql`, `scripts/pilot-{qr,sim,seed}.mts`.

## 5. Volgorde en wat het oplevert
| Week | Doe | Resultaat |
|---|---|---|
| 1 | Fase 0 + firmware op board #1 (Jeroen's eigen sensor) | Eerste sensor op token-pad, zichtbaar in `/cockpit` op dev.woongezond.com |
| 2 | Fase 2 cockpit + simulator | Cockpit getest met 1 echte + 7 gesimuleerde sensoren |
| 3 | Zeven boards flashen + provisioning-script | Alle acht op tafel groen in de cockpit |
| 4+ | Plaatsen bij de huizen, één per keer | Per huis een logboek, per sensor uptime en data |

## 6. Open vragen voor Jeroen
1. ~~Login voor bewoners?~~ Beantwoord in §2b: niet nodig, optioneel als laatste stap.
2. Heeft de behuizing een bereikbare BOOT-knop en een LED? (nodig voor WiFi-reset en status.)
3. Arduino IDE blijven, of PlatformIO (reproduceerbare builds, versie in git)? Voorstel: PlatformIO
   in `firmware/`, met dezelfde libraries.
4. Alleen SCD41 (CO₂/T/RV), of komen er ook VOC/NOx-sensoren bij (SGP41)? Bepaalt het payload.
5. Wat is er met "Jeroen Sensor" gebeurd sinds 2 september? (WiFi, stroom, of vastgelopen —
   het antwoord bepaalt hoe belangrijk de watchdog/buffer in fase 1 is.)
