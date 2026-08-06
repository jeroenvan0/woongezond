# Device provisioning — corporatie-gedreven onboarding, QR-koppeling, foto's, WiFi

**Ontwerp, 2026-08-06.** Branch `feat/device-provisioning`. Sluit aan op
[corporatie-fleet-design.md](./corporatie-fleet-design.md) en
[firmware-provisioning.md](./firmware-provisioning.md).

> **Status:** migratie + app-code geschreven, **migratie nog niet toegepast**. WiFi-handshake
> is firmware-gekoppeld en hier gescaffold + gecontracteerd, niet gefaket. Zie
> [device-provisioning-progress.md](./device-provisioning-progress.md).

## De verschuiving
De onboarding wordt **door de corporatie** gedaan bij plaatsing, niet door de bewoner:
1. Corporatie voegt een sensor toe aan een woning en vult **huisgegevens** in
   (isolatie, bouwjaar, woningtype, kamer, plaatsingsnotitie).
2. Corporatie maakt een **plaatsingsfoto** (waar hangt de sensor).
3. De sensor draagt een **QR-code**; scannen **koppelt** het apparaat aan de woning/bewoner.
4. Bij plaatsing wordt het apparaat **met de WiFi verbonden** (firmware-flow, hieronder).

## Datamodel (migratie 20260806120300)
```
devices  (uitbreiding)
  org_id        uuid  -> organizations   -- corporatie die dit apparaat beheert (nullable)
  user_id       uuid                      -- WORDT NULLABLE: een geprovisioned maar nog niet
                                          --   geclaimd apparaat heeft nog geen bewoner
  build_year    int                       -- huisprofiel
  house_type    text                      --   ('portiek','eengezins','appartement',…)
  placement_note text                     -- "hangt in de hal, 1.5m hoog"

device_claim_codes                        -- QR/handmatige koppelcode (spiegelt org_invites)
  id, device_id -> devices, code unique, expires_at, used_at, redeemed_by, created_at

device_photos                             -- plaatsingsfoto's (+ later grond-waarheid B1)
  id, device_id -> devices, storage_path, caption, kind ('placement'|'observation'),
  created_by, created_at
```
Plus een Supabase **Storage-bucket** `device-photos` met RLS: alleen org-leden van het
apparaat en de bewoner-eigenaar mogen lezen/schrijven.

### RLS-uitbreiding op `devices`
Additief naast de bestaande owner-policies (OR-semantiek): **org-leden** mogen apparaten met
`org_id` in hun org(en) SELECT/INSERT/UPDATE (via `is_org_member(org_id)`). Zo kan de
corporatie provisionen en beheren; de bewoner blijft eigenaar van geclaimde apparaten.
`user_id` nullable maken is veilig: de owner-policy `auth.uid() = user_id` matcht nooit op
NULL, dus een ongeclaimd apparaat is onzichtbaar voor bewoners en alleen zichtbaar voor de
beherende corporatie — precies goed.

### Koppel-RPC
`redeem_device_claim(p_code)` — SECURITY DEFINER, draait als de bewoner: valideert de code,
zet `devices.user_id = auth.uid()`, markeert de code gebruikt. Zo claimt een bewoner het
apparaat door de QR te scannen (deep-link `/koppel?code=…`) of de code in te tikken.

## App-oppervlak
- **Corporatie** — provisioning op `/vloot/koppelen` (of sectie): apparaat toevoegen aan
  woning, huisprofiel invullen, plaatsingsfoto uploaden, QR/koppelcode genereren + tonen.
  API `app/api/devices/provision` (POST create+code), `app/api/devices/photos` (upload/list).
- **Bewoner** — `/koppel` (QR-deeplinkdoel): code inwisselen → apparaat gekoppeld.
  API `app/api/devices/claim` (POST redeem).
- **QR** — codeert `<origin>/koppel?code=DEVICE-XXXX`. Genereren client-side met een kleine
  QR-lib (geen netwerk-afhankelijkheid); zie progress-doc voor de dependency-keuze.

## WiFi-provisioning — firmware-contract (gescaffold, niet gefaket)
De web-app kan een ESP-sensor niet zelf op WiFi zetten zonder firmware-medewerking. Twee
gangbare patronen; kies er één in de firmware (`docs/firmware-provisioning.md`):

1. **SoftAP + captive HTTP** — de sensor opent bij eerste boot een AP `Woongezond-XXXX`.
   De installateur verbindt de telefoon met die AP en de app POST't de thuis-WiFi-creds naar
   `http://192.168.4.1/provision` (device-lokaal endpoint). Simpel, werkt zonder WebBluetooth,
   maar vergt handmatig van/naar-AP wisselen.
2. **BLE (WebBluetooth)** — de sensor adverteert een GATT-service; de app schrijft SSID +
   wachtwoord naar een characteristic. Alleen Chrome/Edge (WebBluetooth), maar geen
   netwerk-geswitch. De QR kan het BLE-pairingsecret dragen.

**In deze fase:** de provisioning-flow heeft een WiFi-stap die het contract uitlegt en de
gekozen methode aanroept via een dunne client-adapter (`lib/wifiProvision.ts`, nu een
gedocumenteerde stub die de payload voorbereidt). Zodra de firmware één van beide endpoints
levert, is alleen die adapter in te vullen — de rest van de UI staat.

## Wat NIET in deze fase
- De echte WiFi-handshake (wacht op firmware-endpoint/GATT-contract).
- Automatische device-creatie door firmware bij eerste boot (blijft: corporatie provisiont).
- Grond-waarheid-observaties (B1) hergebruiken `device_photos.kind='observation'` later.

## Toepassen
Zie [device-provisioning-progress.md](./device-provisioning-progress.md) — migratie +
Storage-bucket reviewen en toepassen tegen een Supabase-branch vóór prod.
