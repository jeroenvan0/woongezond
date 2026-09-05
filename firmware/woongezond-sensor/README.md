# Woongezond sensor-firmware v2

Eén image voor alle sensoren. Per apparaat alleen data (token, URL, nummer) via de seriële
monitor; WiFi stelt de bewoner zelf in via het setup-netwerk. Vervangt de sketch met
hardcoded WiFi/anon-key uit `~/Documents/Arduino/Jannouk`.

## Eenmalig: Arduino IDE klaarzetten
1. Board: **Adafruit Feather ESP32-S3** (esp32-core 3.x, staat al geïnstalleerd).
2. Library Manager → installeer **WiFiManager** (tzapu) en **Sensirion I2C SCD4x** (staat al).
3. Open `woongezond-sensor.ino`, kies de poort, Upload.

## Per sensor (aan je bureau, < 1 minuut)
1. Seriële monitor op 115200, "Newline" als regeleinde.
2. Typ (token en code uit `npm run pilot:seed` / de cockpit):
   ```
   SET NUMBER 1
   SET URL http://192.168.2.6:3005        ← lokaal testen (LAN-IP van je Mac)
   SET TOKEN wgd_…
   SHOW
   ```
   Voor productie: `SET URL https://woongezond.com/admin` (dev: `https://dev.woongezond.com/admin`).
3. De sensor opent nu het setup-netwerk **Woongezond-01**. Plak de sticker met hetzelfde nummer.

## Bewoner (thuis)
Stekker erin → telefoon op WiFi **Woongezond-0N** → portal opent vanzelf → thuisnetwerk +
wachtwoord → sensor herstart en meet. Op de website (`/start?code=…`) springt het scherm op groen.

## Seriële commando's
| Commando | Doet |
|---|---|
| `SET TOKEN <wgd_…>` | device-token opslaan |
| `SET URL <http(s)://…>` | server-basis (zonder `/api/ingest`) |
| `SET NUMBER <n>` | stickernummer → AP-naam `Woongezond-0n` |
| `SHOW` | huidige configuratie + WiFi-status |
| `RESET WIFI` | alleen WiFi wissen (ook: BOOT-knop 10 s) |
| `RESET ALL` | token, url, nummer én WiFi wissen |

## LED (rode LED op het board)
| Patroon | Betekenis |
|---|---|
| 1 korte flits per minuut | meting verstuurd (200) |
| 2× knipperen | geen WiFi / setup-netwerk actief |
| 3× knipperen | server weigert token (401) of nog geen token/url (SET …) |

## Wat de firmware stuurt
`POST <URL>/api/ingest`, header `x-device-token`, body
`{co2, temperature, humidity, rssi, fw, boot_count, uptime_s}`. `uptime_s` klein = net
herstart; de website gebruikt dat als bewijs dat je de sensor in handen hebt (overschrijven
van een registratie). Zie `docs/pilot-cockpit-plan.md` §2b.

## Bekend / later
- HTTPS zonder certificaatcontrole (`setInsecure`) — prima voor de pilot, later CA-bundle.
- Geen buffer bij WiFi-uitval; metingen tijdens uitval gaan verloren (fase 1 in het plan).
- Alleen 2,4 GHz (hardware). Het portal waarschuwt niet zelf voor 5 GHz-only netwerken.
