# Pilot-plan — fictieve corporatie, 8× Feather S3

**2026-08-06.** Voorbereiding op de eerste pilot: **9 apparaten gebouwd, 8 uitgerold** onder
één fictieve woningcorporatie, 1 gehouden voor ontwikkeling. Hardware: **Adafruit Feather
ESP32-S3 + luchtkwaliteitssensor** (CO₂ / temperatuur / RV, en optioneel VOC/NOx). Firmware
wordt volgende week gebouwd en gedeeld; dit is het contract waar die tegen bouwt.

Sluit aan op [device-provisioning-design.md](./device-provisioning-design.md) en
[firmware-provisioning.md](./firmware-provisioning.md).

## De end-to-end pilot-flow
1. **Corporatie provisiont** in de app (`/vloot/koppelen`): 8× een sensor aanmaken met
   huisprofiel. Per sensor levert de app **drie dingen**:
   - een **ingest-URL + device-token** (voor de firmware),
   - een **koppelcode + QR** (voor de bewoner),
   - een plek voor een **plaatsingsfoto**.
2. **Flashen**: de installateur zet per Feather S3 het device-token + de ingest-URL in de
   firmware-config (of via de WiFi-provisioning-stap, zie onder).
3. **WiFi**: de sensor komt op het thuisnetwerk (methode hieronder).
4. **Meten**: de sensor POST't elke ~60s naar de ingest-URL. Vóór koppeling hebben die
   metingen nog geen eigenaar; ze worden bewaard en bij koppeling met terugwerkende kracht
   aan de bewoner gekoppeld (`redeem_device_claim` backfillt `air_quality.user_id`).
5. **Koppelen**: de bewoner scant de QR op de sensor → `/koppel?code=…` → sensor aan de woning.
6. **Delen**: de bewoner geeft (optioneel) de corporatie inzage via `/delen`; de woning
   verschijnt in `/vloot`.

## Firmware-contract

### 1. Data-ingest (verplicht, staat live)
```
POST  <origin>/api/ingest
Header:  x-device-token: wgd_<hex>        (het per-device token uit /vloot/koppelen)
Body (application/json):
  { "co2": 812, "temperature": 20.4, "humidity": 54.1, "voc_index": 120, "nox_index": 1 }
```
- Alleen `co2`, `temperature`, `humidity` zijn logisch verplicht (minstens één moet er zijn);
  `voc_index`/`nox_index` optioneel. Aliassen `temp`/`rh`/`voc`/`nox` worden ook geaccepteerd.
- Auth = **alleen het token** (een sensor is geen browsergebruiker). Geen anon-key meer.
- Rate limit: 4 requests/min per token (server). Meet elke ~60s; bij een mislukte POST
  één retry, niet vaker.
- Respons `200 { ok, device_id, claimed }`. `401 invalid_token` → token fout/ingetrokken.

Dit vervangt het baseline "DEVICE SYNC HOLE" (anon-key → één hardgecodeerde user). Die oude
anon-policy blijft nog even staan voor de bestaande live-sensor; faseer 'm uit zodra alle
apparaten op tokens draaien (verwijder `air_quality_anon_sync_insert/select`).

### 2. WiFi-provisioning (kies één; nu gescaffold)
De web-app kan de Feather niet zelf op WiFi zetten zonder firmware-medewerking. Twee opties;
de app-adapter `lib/wifiProvision.ts` is klaar om de gekozen methode in te vullen.

- **A. SoftAP + captive HTTP (aanbevolen voor ESP32-S3).** Bij eerste boot opent de Feather
  een AP `Woongezond-XXXX`. De installateur verbindt de telefoon ermee; de app (of een
  captive pagina op de Feather) POST't `{ ssid, password }` naar `http://192.168.4.1/provision`.
  Robuust, geen browserafhankelijkheid. Nadeel: even handmatig van/naar het AP wisselen.
- **B. BLE (WebBluetooth).** De Feather adverteert een GATT-service; de app schrijft SSID +
  wachtwoord naar een characteristic. Geen netwerk-geswitch, maar alleen Chrome/Edge.

**Voorstel:** begin met **A (SoftAP)** — het minst gevoelig voor browser/OS-verschillen en
prima voor 8 apparaten bij plaatsing. Als de Feather `POST /provision` levert, vul dan die
ene call in `provisionWifi()` in; de UI-stap op `/vloot/koppelen` staat al.

### 3. Koppelcode op de sticker
Print de **QR** (uit `/vloot/koppelen`) op de behuizing; de QR is
`<origin>/koppel?code=DEVICE-XXXX`. De code kan ook los als tekst voor handmatig intikken.

## Wat de app-kant al klaar heeft
- `/api/ingest` (per-device token, rate-limited, service-role insert). **Live** zodra
  migratie `20260806120400` is toegepast.
- Token + ingest-URL zichtbaar per sensor in `/vloot/koppelen` (org-only).
- Backfill van pre-claim metingen bij koppelen.
- Provisioning-, koppel-, huisprofiel- en foto-flow (PR device-provisioning).

## Openstaande beslissingen (volgende week, mét de firmware)
- WiFi-methode definitief (A of B) → `provisionWifi()` invullen.
- Meetinterval + welke velden de sensor stuurt (VOC/NOx meenemen?).
- Token-rotatie/intrekken: nu één token per device in `devices.ingest_token`; als rotatie
  nodig is, verplaats naar een `device_ingest_tokens`-tabel met `revoked_at`.
- Uitfaseren van de anon-sync-policy zodra de live-sensor op een token draait.
- Bulk-provisioning UI (8 sensoren in één keer) als handmatig te traag blijkt.

## Toepassen
Migratie `20260806120400` (+ de eerdere provisioning-migraties) reviewen en toepassen tegen
een Supabase-branch vóór prod. Zie [device-provisioning-progress.md](./device-provisioning-progress.md).
