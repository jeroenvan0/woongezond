// Woongezond sensor — Adafruit Feather ESP32-S3 + Sensirion SCD41
// Firmware v2: één image voor alle sensoren. Niets per apparaat in de code.
//
//   • Identiteit (device-token, ingest-URL, nummer) staat in NVS (Preferences) en wordt
//     eenmalig via de seriële monitor gezet:   SET TOKEN wgd_…   SET URL http://…   SET NUMBER 3
//   • WiFi kiest de bewoner zelf: zonder opgeslagen netwerk opent de sensor het open netwerk
//     "Woongezond-0N" met een captive portal (WiFiManager). Kies daar het thuisnetwerk.
//   • Elke 60 s een meting naar <URL>/api/ingest met header x-device-token.
//     Body: co2, temperature, humidity, rssi, fw, boot_count, uptime_s (docs/pilot-feather-s3-plan.md).
//   • Stroom eraf/eraan: alles blijft (WiFi-gegevens én token staan in flash). De sensor
//     verbindt na een herstart gewoon opnieuw en wist NOOIT uit zichzelf iets.
//   • WiFi wijzigen (nieuw wachtwoord/router): BOOT-knop 10 s ingedrukt → alleen de WiFi-
//     gegevens weg, token en nummer blijven, alle data blijft één reeks. Setup-netwerk opent.
//   • Overdragen aan een nieuwe bewoner gebeurt op de website (QR opnieuw scannen), niet in
//     de firmware: de sensor zelf hoeft daarvoor niets te vergeten.
//   • Rode LED: 2× knipperen = geen WiFi / setup-modus, 3× = server weigert token (401),
//     1 korte flits = meting verstuurd.
//
// Libraries (Arduino Library Manager): "WiFiManager" (tzapu), "Sensirion I2C SCD4x".
// Board: Adafruit Feather ESP32-S3 (esp32 core 3.x). Zie README.md hiernaast.

#include <Wire.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <SensirionI2cScd4x.h>

#define FW_VERSION "2.0.0"

// ── pinnen (Feather ESP32-S3) ─────────────────────────
static const int SDA_PIN    = 3;
static const int SCL_PIN    = 4;
static const int BUTTON_PIN = 0;             // BOOT-knop
#ifndef LED_BUILTIN
#define LED_BUILTIN 13
#endif

// ── timing ────────────────────────────────────────────
static const unsigned long INTERVAL_MS     = 60000;
static const unsigned long HTTP_TIMEOUT_MS = 10000;
static const unsigned long WIFI_RETRY_MS   = 30000;
static const unsigned long BUTTON_HOLD_MS  = 10000;
static const int           HTTP_RETRIES    = 2;

Preferences      prefs;                       // namespace "wg"
SensirionI2cScd4x scd4x;
WiFiManager      wm;

String  cfgToken, cfgUrl;
int     cfgNumber = 0;
uint32_t bootCount = 0;
bool    scd41Ok = false;
unsigned long lastSend = 0, lastWifiTry = 0, buttonDownAt = 0;

// ── LED ───────────────────────────────────────────────
void blink(int times, int onMs = 120, int offMs = 160) {
  for (int i = 0; i < times; i++) { digitalWrite(LED_BUILTIN, HIGH); delay(onMs); digitalWrite(LED_BUILTIN, LOW); delay(offMs); }
}

// ── configuratie in NVS ───────────────────────────────
void loadConfig() {
  prefs.begin("wg", true);
  cfgToken  = prefs.getString("token", "");
  cfgUrl    = prefs.getString("url", "");
  cfgNumber = prefs.getInt("number", 0);
  bootCount = prefs.getUInt("boots", 0);
  prefs.end();
}
void saveConfig(const char* key, const String& val) { prefs.begin("wg", false); prefs.putString(key, val); prefs.end(); }
void saveNumber(int n)                              { prefs.begin("wg", false); prefs.putInt("number", n); prefs.end(); }
void bumpBootCount()                                { prefs.begin("wg", false); bootCount = prefs.getUInt("boots", 0) + 1; prefs.putUInt("boots", bootCount); prefs.end(); }
bool configured() { return cfgToken.length() > 8 && cfgUrl.startsWith("http"); }

String apName() {
  char buf[24];
  if (cfgNumber > 0) snprintf(buf, sizeof(buf), "Woongezond-%02d", cfgNumber);
  else               snprintf(buf, sizeof(buf), "Woongezond-%04X", (uint16_t)(ESP.getEfuseMac() & 0xFFFF));
  return String(buf);
}

// Seriële provisioning: regels als "SET TOKEN wgd_…", "SET URL https://…", "SET NUMBER 3",
// "SHOW", "RESET WIFI", "RESET ALL". Werkt altijd, ook als de sensor al meet.
void handleSerial() {
  static String line;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c != '\n') { line += c; if (line.length() > 200) line = ""; continue; }
    line.trim();
    if (line.startsWith("SET TOKEN "))       { cfgToken = line.substring(10); cfgToken.trim(); saveConfig("token", cfgToken); Serial.println("[cfg] token opgeslagen"); }
    else if (line.startsWith("SET URL "))    { cfgUrl = line.substring(8); cfgUrl.trim(); while (cfgUrl.endsWith("/")) cfgUrl.remove(cfgUrl.length() - 1); saveConfig("url", cfgUrl); Serial.println("[cfg] url opgeslagen: " + cfgUrl); }
    else if (line.startsWith("SET NUMBER ")) { cfgNumber = line.substring(11).toInt(); saveNumber(cfgNumber); Serial.println("[cfg] nummer opgeslagen: " + String(cfgNumber) + " → AP " + apName()); }
    else if (line == "SHOW")                 { Serial.printf("[cfg] fw=%s number=%d url=%s token=%s… boots=%u wifi=%s ip=%s\n", FW_VERSION, cfgNumber, cfgUrl.c_str(), cfgToken.substring(0, 8).c_str(), bootCount, WiFi.SSID().c_str(), WiFi.localIP().toString().c_str()); }
    else if (line == "RESET WIFI")           { Serial.println("[cfg] wifi gewist, herstart…"); wm.resetSettings(); delay(300); ESP.restart(); }
    else if (line == "RESET ALL")            { prefs.begin("wg", false); prefs.clear(); prefs.end(); wm.resetSettings(); Serial.println("[cfg] alles gewist, herstart…"); delay(300); ESP.restart(); }
    else if (line.length())                  { Serial.println("[cfg] onbekend. Gebruik: SET TOKEN <t> | SET URL <u> | SET NUMBER <n> | SHOW | RESET WIFI | RESET ALL"); }
    line = "";
  }
}

// ── WiFi via captive portal ───────────────────────────
// Eerste keer (of na RESET WIFI): open netwerk "Woongezond-0N", portal op 192.168.4.1.
// Het portal controleert het wachtwoord vóór opslaan; bij fout blijft het portal open.
bool ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  if (millis() - lastWifiTry < WIFI_RETRY_MS && lastWifiTry != 0) return false;
  lastWifiTry = millis();
  // Geduldig: eerst ruim proberen op het bekende netwerk (router die na een stroomstoring
  // trager opkomt dan de sensor), pas dan het setup-netwerk. Opgeslagen creds worden nooit
  // gewist; als het portal na 5 min sluit, proberen we het bekende netwerk gewoon opnieuw.
  wm.setConnectTimeout(30);
  wm.setConnectRetries(4);                 // 4 × 30 s ≈ 2 min voordat het portal opent
  wm.setConfigPortalTimeout(300);
  wm.setTitle("Woongezond sensor");
  wm.setDarkMode(false);
  Serial.println("[wifi] verbinden… (geen creds → setup-netwerk " + apName() + ")");
  blink(2);
  bool ok = wm.autoConnect(apName().c_str());   // blokkeert tot verbonden of portal-timeout
  if (ok) Serial.printf("[wifi] verbonden met %s, ip %s, rssi %d\n", WiFi.SSID().c_str(), WiFi.localIP().toString().c_str(), WiFi.RSSI());
  else    Serial.println("[wifi] niet verbonden; volgende poging over 30 s");
  return ok;
}

// BOOT-knop 10 s vasthouden → alleen WiFi wissen.
void handleButton() {
  bool down = digitalRead(BUTTON_PIN) == LOW;
  if (down && buttonDownAt == 0) buttonDownAt = millis();
  if (!down) buttonDownAt = 0;
  if (down && millis() - buttonDownAt > BUTTON_HOLD_MS) {
    Serial.println("[btn] 10 s ingedrukt → wifi wissen, herstart");
    blink(5, 60, 60);
    wm.resetSettings(); delay(300); ESP.restart();
  }
}

// ── ingest ────────────────────────────────────────────
// Retourneert HTTP-code (of <0 bij verbindingsfout).
int postReading(uint16_t co2, float temp, float rh) {
  String body = "{\"co2\":" + String(co2) +
                ",\"temperature\":" + String(temp, 2) +
                ",\"humidity\":" + String(rh, 2) +
                ",\"rssi\":" + String(WiFi.RSSI()) +
                ",\"fw\":\"" FW_VERSION "\"" +
                ",\"boot_count\":" + String(bootCount) +
                ",\"uptime_s\":" + String(millis() / 1000) + "}";
  String url = cfgUrl + "/api/ingest";
  int code = -1;
  for (int attempt = 1; attempt <= HTTP_RETRIES; attempt++) {
    HTTPClient http;
    http.setTimeout(HTTP_TIMEOUT_MS);
    bool begun;
    WiFiClientSecure tls;                  // https: zonder CA-bundle (pilot); http: gewone client
    WiFiClient plain;
    if (url.startsWith("https://")) { tls.setInsecure(); begun = http.begin(tls, url); }
    else                            { begun = http.begin(plain, url); }
    if (!begun) { Serial.println("[http] begin() mislukt"); return -1; }
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-device-token", cfgToken);
    code = http.POST(body);
    String resp = code > 0 ? http.getString() : String();
    http.end();
    if (code > 0) { Serial.printf("[http] %d %s\n", code, resp.substring(0, 120).c_str()); return code; }
    Serial.printf("[http] verbindingsfout (%d), poging %d/%d\n", code, attempt, HTTP_RETRIES);
    delay(1500);
  }
  return code;
}

// ── setup / loop ──────────────────────────────────────
void setup() {
  pinMode(LED_BUILTIN, OUTPUT); digitalWrite(LED_BUILTIN, LOW);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  Serial.begin(115200);
  delay(800);
  loadConfig();
  bumpBootCount();
  Serial.printf("\n=== Woongezond sensor fw %s · boot #%u ===\n", FW_VERSION, bootCount);

  Wire.begin(SDA_PIN, SCL_PIN);
  scd4x.begin(Wire, 0x62);
  scd4x.stopPeriodicMeasurement();
  delay(500);
  scd41Ok = scd4x.startPeriodicMeasurement() == 0;
  Serial.println(scd41Ok ? "[scd41] gestart" : "[scd41] FOUT — check bedrading SDA=3 SCL=4");

  if (!configured()) {
    Serial.println("[cfg] geen token/url. Typ in de seriële monitor:");
    Serial.println("      SET TOKEN wgd_…    SET URL https://woongezond.com/admin    SET NUMBER 3");
  }
  ensureWiFi();
}

void loop() {
  handleSerial();
  handleButton();
  if (!configured()) { static unsigned long t; if (millis() - t > 5000) { t = millis(); blink(3, 60, 120); Serial.println("[cfg] wacht op SET TOKEN / SET URL"); } delay(50); return; }

  if (millis() - lastSend >= INTERVAL_MS || lastSend == 0) {
    lastSend = millis();
    if (!scd41Ok) { Serial.println("[scd41] niet beschikbaar"); return; }
    bool ready = false;
    if (scd4x.getDataReadyStatus(ready) != 0 || !ready) { Serial.println("[scd41] data nog niet klaar"); lastSend = millis() - INTERVAL_MS + 5000; return; }
    uint16_t co2; float temp, rh;
    if (scd4x.readMeasurement(co2, temp, rh) != 0 || co2 == 0) { Serial.println("[scd41] ongeldige meting"); return; }
    Serial.printf("[meting] CO2 %u ppm · %.2f °C · %.2f %%\n", co2, temp, rh);
    if (!ensureWiFi()) { Serial.println("[wifi] geen verbinding, meting overgeslagen"); return; }
    int code = postReading(co2, temp, rh);
    if (code == 200)      blink(1, 40, 0);
    else if (code == 401) { Serial.println("[http] token afgewezen — SET TOKEN opnieuw"); blink(3); }
    else if (code == 429) Serial.println("[http] te snel — server vraagt te wachten");
  }
  delay(50);
}
