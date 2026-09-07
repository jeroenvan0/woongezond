# Sensoren flashen en klaarzetten (pilot, 8 stuks)

Stand 2026-09-07: sensor 1 (Jeroen) en sensor 2 (Faber/Lemke) draaien op firmware 2.1.1.
Sensor 3 t/m 8 moeten nog. Eén firmware-image voor alle sensoren; per sensor verschillen
alleen het **nummer** en het **token**, en die zet je via de seriële monitor, niet in de code.

## 0. Eenmalig op de Mac (is gedaan, alleen checken)

**Niet in iCloud werken.** `~/Documents` (en `~/Documents/Arduino`) staat in iCloud. Daardoor
bleef "Compiling sketch…" minutenlang hangen zonder dat er een compiler draaide. De werkkopie
staat daarom buiten iCloud:

```
~/Arduino/woongezond-sensor/woongezond-sensor.ino   ← kopie van firmware/woongezond-sensor/
~/Arduino/libraries/                                 ← WiFiManager, Sensirion I2C SCD4x, Sensirion Core
```

Arduino IDE → Settings (⌘,) → **Sketchbook location** = `/Users/jeroenvanoostendorp/Arduino`,
daarna de IDE herstarten. Compileren duurt dan ~35 s, uploads daarna ~20 s.

Wijzig je de firmware in de repo, kopieer hem dan opnieuw:

```
cat "firmware/woongezond-sensor/woongezond-sensor.ino" > ~/Arduino/woongezond-sensor/woongezond-sensor.ino
```

## 1. Tokens en codes ophalen

De acht apparaten staan al in de database (org "Pilot"). Dit print ze, en maakt niets nieuws
aan zolang de nummers bestaan:

```
cd "/Users/jeroenvanoostendorp/Developer/woongezond code/woongezond"
npm run pilot:seed -- --admin woongezond@vostech.group --count 8
```

Per regel: nummer, naam, **koppelcode** (voor de sticker/QR) en **token** (`wgd_…`, voor de
sensor). Tokens niet in docs of chats plakken; ze zijn de identiteit van de sensor.

| Nr | Koppelcode | Status |
|---|---|---|
| 1 | DEVICE-2LEMY4 | draait (Jeroen) |
| 2 | DEVICE-NPNCNF | draait (Faber/Lemke, faber@test.nl) |
| 3 | DEVICE-A9BB94 | te flashen |
| 4 | DEVICE-94R25R | te flashen |
| 5 | DEVICE-VVLY3Z | te flashen |
| 6 | DEVICE-B6RGC5 | te flashen |
| 7 | DEVICE-DV7SLW | te flashen |
| 8 | DEVICE-8BK79E | te flashen |

## 2. Per sensor: flashen (Arduino IDE)

1. Sensor via USB-C aan de Mac.
2. Board/poort bovenin: **Adafruit Feather ESP32-S3** op **/dev/cu.usbmodem…**. Nooit de
   regel met `Bluetooth-Incoming` of `debug-console`.
3. Upload (→). Weigert het board: BOOT ingedrukt houden, kort op Reset, loslaten, opnieuw uploaden.
4. Tools → Serial Monitor, **115200 baud**, regeleinde **Newline**. Je ziet
   `=== Woongezond sensor fw 2.1.1 · boot #1 ===` en `[cfg] wacht op SET TOKEN / SET URL`.

Alternatief zonder IDE (zelfde resultaat, handig als de IDE de poort vasthoudt):

```
CLI="/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli"
export ARDUINO_DIRECTORIES_USER=$HOME/Arduino
"$CLI" compile --fqbn esp32:esp32:adafruit_feather_esp32s3 --build-path ~/Arduino/build-woongezond ~/Arduino/woongezond-sensor
"$CLI" upload  --fqbn esp32:esp32:adafruit_feather_esp32s3 -p /dev/cu.usbmodem101 --input-dir ~/Arduino/build-woongezond ~/Arduino/woongezond-sensor
```

## 3. Per sensor: nummer, URL en token zetten

In de Serial Monitor, regel voor regel (Enter na elke regel), met het nummer en token van
die sensor uit stap 1:

```
SET NUMBER 3
SET URL https://woongezond.com/admin
SET TOKEN wgd_<token van nummer 3>
SHOW
```

- De monitor bevestigt elke regel (`[cfg] … opgeslagen`). `SHOW` toont de opgeslagen stand.
- De URL is de voordeur; dev en productie schrijven naar dezelfde database. Kies een adres
  dat de hele pilot blijft bestaan. De URL is later **alleen via USB** te wijzigen.
- Sinds firmware 2.1.1 reageert de sensor meteen op SET-commando's; hij opent pas het
  setup-netwerk als token en URL er staan. Daarna zie je `StartAP with SSID: Woongezond-03`.
  `No wifi saved, skipping` is normaal: het thuisnetwerk kiest de bewoner zelf.
- Verkeerd geplakt token: 3× knipperen + `401` in de monitor → `SET TOKEN` opnieuw.

Sticker met het nummer en de QR (`npm run pilot:stickers` of `npm run pilot:qr -- --code DEVICE-… --number 3`)
op de sensor. USB los, volgende sensor.

## 4. Testen aan het bureau (aanrader, 2 minuten)

Telefoon op WiFi **Woongezond-03** → portal opent → eigen netwerk kiezen. Na een minuut in de
monitor `[http] 200` en in de cockpit (dev.woongezond.com/admin/cockpit) staat de sensor op
**online**. Daarna `RESET WIFI` in de monitor: thuisnetwerk weg, token en nummer blijven,
sensor is weer "schoon" voor de bewoner.

## 5. Bij de bewoner

1. Stekker erin → telefoon op **Woongezond-0N** → portal → thuisnetwerk + wachtwoord (alleen 2,4 GHz).
2. QR scannen → `/start?code=…` → wizard (naam, e-mail voor het weekrapport, vragenlijst).
   Het weekrapport gaat elke **vrijdag 08:00** naar dat adres.
3. Account voor de bewoner: normaal maakt hij die zelf via de wizard. Voor sensor 2 is het
   handmatig gedaan (auth-user aangemaakt, `devices.user_id` gezet, koppelcode op gebruikt).
   Een bewoner ziet alleen zijn eigen sensor; het admin-account (woongezond@vostech.group) ziet
   alle acht in de cockpit én in het dashboard.

## Valkuilen van de eerste avond

- **Compileren hangt** → sketch of libraries staan in iCloud (zie §0).
- **Seriële monitor leeg / poort "Resource busy"** → een andere monitor houdt de poort vast
  (IDE-monitor of een script). Eén tegelijk.
- **Dashboard toont "nog geen metingen"** terwijl de sensor stuurt → je bent ingelogd als een
  account dat de sensor niet mag zien. Sinds 2026-09-07 mag de org-admin alles; ververs.
- **Grafiek met één punt** → periode op 30 dagen = 1 punt per uur. Zet op 6 of 24 uur.
- **RSSI rond −79 dBm** (sensor 2) is zwak; verwacht af en toe een gemiste minuut. Dichter bij
  de router als het kan.
