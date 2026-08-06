# Device provisioning — progress log

Branch `feat/device-provisioning`. Volgt [device-provisioning-design.md](./device-provisioning-design.md).
**Lees dit eerst bij hervatten.**

## TL;DR
Corporatie-gedreven onboarding: sensor toevoegen aan een woning met huisprofiel, QR-koppelcode,
plaatsingsfoto, en een WiFi-stap. QR-koppeling + huisprofiel + foto's zijn **functioneel**;
de WiFi-handshake is **gescaffold** (firmware-contract, geen fake). Migratie **nog niet toegepast**.
`npm test` 97 pass, typecheck + build clean.

## Status
### Functioneel (na toepassen migratie)
- [x] **Migratie** [`20260806120300_add_device_provisioning.sql`](../supabase/migrations/20260806120300_add_device_provisioning.sql):
      devices `org_id`/`build_year`/`house_type`/`placement_note` + `user_id` nullable;
      `device_claim_codes`; `device_photos`; org-lid RLS op devices; `device_in_my_org()`,
      `redeem_device_claim()`; Storage-bucket `device-photos` + object-policies. **Niet toegepast.**
- [x] **Corporatie-scherm** `/vloot/koppelen` (+ `app/api/devices/provision`): sensor aanmaken
      met huisprofiel → QR + koppelcode; plaatsingsfoto uploaden (Supabase Storage); lijst met
      koppelstatus. Bereikbaar via link op `/vloot`.
- [x] **Bewoner-koppelpagina** `/koppel?code=…` (+ `app/api/devices/claim`): QR-deeplink of
      handmatige code → `redeem_device_claim` koppelt de sensor aan de woning.
- [x] **QR** — client-side gegenereerd (`components/ui/QrImage.tsx`, dep `qrcode`), codeert
      `<origin>/koppel?code=DEVICE-XXXX`.

### Gescaffold (wacht op firmware)
- [~] **WiFi-provisioning** — `lib/wifiProvision.ts` is een bewuste stub die de payload
      voorbereidt en het contract documenteert (SoftAP HTTP óf BLE/WebBluetooth). De UI-stap
      op `/vloot/koppelen` roept 'm aan en toont nu de "wacht op firmware"-melding. Zodra de
      firmware één endpoint levert, is alleen die adapter in te vullen.

### Per-device ingest (gedaan — pilot-schrijfpad, Feather S3)
- [x] **`/api/ingest`** + `devices.ingest_token` (migratie `20260806120400`): elke sensor
      schrijft met een eigen token i.p.v. de anon-key ("DEVICE SYNC HOLE"). Token + ingest-URL
      zichtbaar per sensor in `/vloot/koppelen`. Koppelen backfillt pre-claim metingen.
      Volledig firmware-contract: [pilot-feather-s3-plan.md](./pilot-feather-s3-plan.md).

### Nog te doen
- [ ] Firmware-endpoint kiezen + `provisionWifi` invullen (zie design §WiFi).
- [ ] Anon-sync-policy uitfaseren zodra de live-sensor op een token draait.
- [ ] Foto's tonen in het rapport / bij grond-waarheid (B1, `device_photos.kind='observation'`).
- [ ] Bulk-provisioning (meerdere sensoren in één keer) voor grotere uitrol.

## Toepassen (jouw review + run — NOOIT direct prod)
```bash
supabase db push            # of MCP apply_migration, tegen een branch/preview
npm run typecheck && npm run build && npm test
```
Let op: deze migratie raakt **security-kritieke** dingen — devices-RLS (org-tak),
`user_id` nullable, en **Storage-policies**. Review de policies expliciet. Storage-bucket
`device-photos` is private; foto's zijn alleen zichtbaar voor org-leden van het apparaat en
de bewoner-eigenaar.

### Seed / test (na toepassen)
```sql
-- Vereist een org + org_member (zie corporatie-fleet-progress.md).
-- Daarna in de app: /vloot/koppelen → sensor aanmaken → QR verschijnt.
-- Log in als bewoner, open de QR-link (/koppel?code=…) → sensor gekoppeld.
select * from devices where org_id is not null;         -- geprovisioned apparaten
select * from device_claim_codes where used_at is null;  -- open codes
```

## Commits
- (deze branch) Device provisioning: migratie + provision/claim API + /vloot/koppelen + /koppel + QR + WiFi-stub
