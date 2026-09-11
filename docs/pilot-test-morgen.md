# Pilot-test: eerste echte sensor door de hele flow

**Doel:** één Feather ESP32-S3 (jouw "Jeroen Sensor", nu **Sensor 1**, code `DEVICE-2LEMY4`)
met de nieuwe firmware, via `https://dev.woongezond.com/admin`, precies zoals het straks in
productie werkt. Reken op 30 minuten.

## Vooraf (5 min)
- [ ] `git checkout dev && git pull` — de stickers, firmware en handleiding staan op `dev`.
- [ ] `npm run pilot:seed` → noteer het **token** van sensor 1 (regel `1  Sensor 1 (Jeroen) … token wgd_…`).
- [ ] Stickers liggen klaar: `~/Desktop/woongezond-stickers/` (wijzen al naar dev.woongezond.com).
      Opnieuw maken: `npm run pilot:stickers -- --base https://dev.woongezond.com/admin`.
- [ ] Handleiding voor de bewoner: `~/Desktop/woongezond-stickers/handleiding-bewoner.pdf`.

## 1. Firmware flashen (10 min)
- [ ] Arduino IDE → open `firmware/woongezond-sensor/woongezond-sensor.ino`.
- [ ] Board **Adafruit Feather ESP32-S3** (2MB PSRAM), juiste poort. Library **WiFiManager** staat al geïnstalleerd.
- [ ] Upload. Seriële monitor op **115200**, regeleinde **Newline**. Je ziet `=== Woongezond sensor fw 2.0.0 ===`
      en `[cfg] geen token/url`.
- [ ] Typ, één regel per keer:
  ```
  SET NUMBER 1
  SET URL https://dev.woongezond.com/admin
  SET TOKEN wgd_…            ← uit pilot:seed
  SHOW
  ```
- [ ] De sensor opent nu het WiFi-netwerk **Woongezond-01** (rode LED knippert 2×).
- [ ] Plak sticker **01** op de behuizing.

## 2. Als bewoner (10 min) — volg de handleiding letterlijk
- [ ] Telefoon: scan sticker 01 → `dev.woongezond.com/admin/start?code=DEVICE-2LEMY4` → "Welkom! Dit is sensor 01."
- [ ] "Beginnen" → WiFi-scherm wacht.
- [ ] Telefoon → Instellingen → WiFi → **Woongezond-01** → portal opent → kies je thuisnetwerk + wachtwoord.
      (Opent het portal niet vanzelf: open `http://192.168.4.1` in de browser.)
- [ ] Seriële monitor: `[wifi] verbonden met … rssi …` en daarna `[http] 200 {"ok":true…}`. LED: 1 flits per minuut.
- [ ] Terug naar de webpagina → springt op **groen** (binnen ~5 s na de eerste meting).
- [ ] Tien vragen → controlestap → vinkje voorwaarden → Opslaan.
- [ ] Rapport-stap: naam + e-mail invullen (of overslaan) → "Klaar, bedankt!".

## 3. Controleren (5 min)
- [ ] Scan de sticker nog een keer → "Deze sensor is al geregistreerd op …" (keuze overschrijven / alleen WiFi).
- [ ] Database: `npm run pilot:seed` toont sensor 1; in Supabase → `devices` → rij sensor 1 heeft
      `house_profile`, `terms_accepted_at`, `last_seen_at`, `fw_version = 2.0.0`, `last_rssi`.
- [ ] `device_contacts` heeft (als je e-mail invulde) één rij voor sensor 1.
- [ ] Log in op dev.woongezond.com/admin → dashboard toont de nieuwe metingen van Jeroen Sensor
      (dit apparaat is nog aan jouw account gekoppeld, dus je ziet 'm gewoon in je eigen dashboard).

## Als iets niet werkt
| Symptoom | Kijk naar |
|---|---|
| Serial: `[http] 401` | token verkeerd → `SET TOKEN` opnieuw (kopieer zonder spaties) |
| Serial: `[http] -1` / verbindingsfout | URL zonder `/api/ingest` erachter? `SHOW` moet `url=https://dev.woongezond.com/admin` geven |
| Portal opent niet | ga handmatig naar `http://192.168.4.1`; telefoon soms even mobiele data uit |
| Netwerk niet in de lijst | 5 GHz-only; kies het 2,4 GHz-netwerk van je router |
| Webpagina blijft wachten | `curl https://dev.woongezond.com/admin/api/devices/status?code=DEVICE-2LEMY4` → `last_seen` gevuld? |
| Opnieuw beginnen | Serial `RESET WIFI` (alleen WiFi) of `RESET ALL` (ook token) |

## Daarna
- Werkt alles → `dev` → `main` PR, prod uitrollen (`ops/vps/deploy.sh prod`), stickers opnieuw
  met `--base https://woongezond.com/admin`, en `SET URL https://woongezond.com/admin` op de sensor.
- Dan de oude anon-policy droppen (zie audit) — deze sensor gebruikt 'm niet meer.
- Zeven overige boards: zelfde stappen, `SET NUMBER 2..8`.
