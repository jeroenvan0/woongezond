// Woongezond sensor — Adafruit Feather ESP32-S3 + Sensirion SCD41
// Firmware v2: één image voor alle sensoren. Niets per apparaat in de code.
//
//   • Identiteit (device-token, ingest-URL, nummer) staat in NVS (Preferences) en wordt
//     eenmalig via de seriële monitor gezet:   SET TOKEN wgd_…   SET URL http://…   SET NUMBER 3
//   • WiFi kiest de bewoner zelf: zonder opgeslagen netwerk opent de sensor het open netwerk
//     "Woongezond-0N" met een captive portal (WiFiManager). Kies daar het thuisnetwerk.
//   • Verkeerd wachtwoord ingetypt: de router weigert, de sensor opent het setup-netwerk meteen
//     weer en zegt op de portalpagina dat het wachtwoord niet klopte. Opnieuw flashen is nooit
//     nodig (een upload wist het WiFi-wachtwoord ook niet).
//   • Elke 60 s een meting naar <URL>/api/ingest met header x-device-token.
//     Body: co2, temperature, humidity, rssi, fw, boot_count, uptime_s (docs/pilot-feather-s3-plan.md).
//   • Stroom eraf/eraan: alles blijft (WiFi-gegevens én token staan in flash). De sensor
//     verbindt na een herstart gewoon opnieuw en wist NOOIT uit zichzelf iets.
//   • WiFi wijzigen (nieuw wachtwoord/router): BOOT-knop 10 s ingedrukt → alleen de WiFi-
//     gegevens weg, token en nummer blijven, alle data blijft één reeks. Setup-netwerk opent.
//   • Overdragen aan een nieuwe bewoner gebeurt op de website (QR opnieuw scannen).
//   • "Sensor resetten" op de website: de server geeft in het antwoord op de volgende meting
//     {"cmd":"reset_wifi"} mee → sensor wist alleen WiFi en opent het setup-netwerk.
//     Het token wordt nooit op afstand gewist.
//   • Rode LED: 2× knipperen = geen WiFi / setup-modus, 4× = WiFi-wachtwoord afgewezen
//     (setup-netwerk staat open), 3× = server weigert token (401), 1 korte flits = meting verstuurd.
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

#define FW_VERSION "2.2.0"

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
static const unsigned long PORTAL_RETRY_MS = 60000;  // setup-netwerk open: zo vaak het bekende netwerk proberen
static const int           WIFI_PATIENCE   = 4;      // pogingen (~2 min) bij "netwerk niet gevonden" vóór het portal
static const unsigned long BUTTON_HOLD_MS  = 10000;
static const int           HTTP_RETRIES    = 2;

// ── captive portal in huisstijl ───────────────────────
static const char PORTAL_CSS[] PROGMEM = R"CSS(
<style>
body{background:#FBFAF7;color:#1A211E;font-family:-apple-system,Inter,"Segoe UI",Roboto,sans-serif;margin:0;padding:18px 14px}
.wrap{max-width:420px;margin:0 auto;background:#fff;border:1px solid rgba(26,33,30,.09);border-radius:18px;padding:22px 20px;box-shadow:0 8px 32px rgba(26,33,30,.10);text-align:left}
h1{font-size:22px;letter-spacing:-.02em;margin:0 0 6px} h1:before{content:"";display:inline-block;width:14px;height:14px;border-radius:4px;background:#12B886;margin-right:9px}
h2,h3{font-size:15px;margin:14px 0 6px} p,li,label,div{font-size:15px;line-height:1.5}
button,input[type=submit]{display:block;width:100%;background:linear-gradient(135deg,#12B886,#0B7A5C);color:#fff;border:0;border-radius:12px;padding:13px;font-weight:700;font-size:16px;margin:10px 0;cursor:pointer}
input[type=text],input[type=password]{display:block;width:100%;box-sizing:border-box;border:1px solid rgba(26,33,30,.18);border-radius:12px;padding:12px;font-size:16px;margin:4px 0 12px;background:#FAF9F5}
a{color:#0B7A5C;font-weight:600;text-decoration:none} .q{color:#0B7A5C;font-weight:600}
.msg{background:#ECFDF6;border:1px solid #A7EDD3;color:#0A6249;border-radius:12px;padding:10px 12px;margin:8px 0}
.msg.D,.msg.P{background:#FDECEC;border-color:#F5B5B5;color:#B91C1C}
.wg-help{color:#4A5A53;font-size:14px;margin:0 0 6px}
</style>)CSS";
static const char PORTAL_HOME[] PROGMEM = R"HTML(
<p class="wg-help">Kies hieronder je eigen WiFi-netwerk en vul het wachtwoord in. De sensor onthoudt het en verbindt daarna zelf. Werkt alleen op 2,4 GHz.</p>
<form action="/wifi" method="get"><button>WiFi instellen</button></form>
<p class="wg-help" style="margin-top:14px">Klaar? Ga terug naar de Woongezond-pagina op je telefoon; die springt op groen zodra de sensor meet.</p>)HTML";

Preferences      prefs;                       // namespace "wg"
SensirionI2cScd4x scd4x;
WiFiManager      wm;

String  cfgToken, cfgUrl;
int     cfgNumber = 0;
uint32_t bootCount = 0;
bool    scd41Ok = false;
unsigned long lastSend = 0, lastWifiTry = 0, buttonDownAt = 0;

// WiFi-status (zie wifiTick). Staat hier boven alle functies: de Arduino-builder zet zijn
// automatische prototypes vóór de eerste functie, en die gebruiken WifiFail al.
enum WifiFail : uint8_t { WF_NONE, WF_PASSWORD, WF_NOT_FOUND, WF_OTHER };
volatile uint8_t discReason = 0;          // laatste betekenisvolle disconnect-reden (WiFi-event)
volatile bool    discNew    = false;
WifiFail wifiFail  = WF_NONE;
int      wifiTries = 0;                   // mislukte pogingen sinds de laatste verbinding
bool     wifiUp    = false;
String   failSsid, portalHome;            // WiFiManager bewaart alleen de pointer naar portalHome

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
    else if (line == "SHOW")                 { Serial.printf("[cfg] fw=%s number=%d url=%s token=%s… boots=%u wifi=%s ip=%s portal=%s fout=%s\n", FW_VERSION, cfgNumber, cfgUrl.c_str(), cfgToken.substring(0, 8).c_str(), bootCount, wm.getWiFiSSID(true).c_str(), WiFi.localIP().toString().c_str(), wm.getConfigPortalActive() ? "open" : "dicht", failText(wifiFail)); }
    else if (line == "RESET WIFI")           { Serial.println("[cfg] wifi gewist, herstart…"); wm.resetSettings(); delay(300); ESP.restart(); }
    else if (line == "RESET ALL")            { prefs.begin("wg", false); prefs.clear(); prefs.end(); wm.resetSettings(); Serial.println("[cfg] alles gewist, herstart…"); delay(300); ESP.restart(); }
    else if (line.length())                  { Serial.println("[cfg] onbekend. Gebruik: SET TOKEN <t> | SET URL <u> | SET NUMBER <n> | SHOW | RESET WIFI | RESET ALL"); }
    line = "";
  }
}

// ── WiFi via captive portal ───────────────────────────
// Het setup-netwerk "Woongezond-0N" (portal op 192.168.4.1) draait naast de loop (WiFiManager
// non-blocking), dus BOOT-knop en seriële commando's werken altijd. Wanneer het opengaat:
//   • geen opgeslagen netwerk                → meteen;
//   • router weigert het wachtwoord          → meteen, met die melding op de portalpagina;
//   • netwerk niet gevonden / andere fout    → na ~2 min geduld (router die na een
//                                               stroomstoring trager opkomt dan de sensor).
// Het portal blijft open tot er verbinding is. Zolang niemand ermee verbonden is, probeert de
// sensor elke minuut het opgeslagen netwerk opnieuw. Opgeslagen gegevens worden nooit gewist.
WifiFail classifyReason(uint8_t r) {
  switch (r) {
    case WIFI_REASON_AUTH_EXPIRE: case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT:
    case WIFI_REASON_AUTH_FAIL:   case WIFI_REASON_HANDSHAKE_TIMEOUT:
      return WF_PASSWORD;
    case WIFI_REASON_NO_AP_FOUND: case WIFI_REASON_NO_AP_FOUND_W_COMPATIBLE_SECURITY:
    case WIFI_REASON_NO_AP_FOUND_IN_AUTHMODE_THRESHOLD: case WIFI_REASON_NO_AP_FOUND_IN_RSSI_THRESHOLD:
      return WF_NOT_FOUND;
    default:
      return WF_NONE;
  }
}
const char* failText(WifiFail f) {
  return f == WF_PASSWORD ? "wachtwoord afgewezen" : f == WF_NOT_FOUND ? "netwerk niet gevonden" : f == WF_OTHER ? "geen verbinding" : "-";
}

String htmlEsc(const String& s) {
  String o; for (char c : s) { if (c == '<') o += "&lt;"; else if (c == '>') o += "&gt;"; else if (c == '&') o += "&amp;"; else if (c == '"') o += "&quot;"; else o += c; }
  return o;
}

// Startpagina van het portal, met bovenaan wat er misging.
void setPortalHome() {
  String ssid = "<b>" + htmlEsc(failSsid) + "</b>";
  String msg;
  if (wifiFail == WF_PASSWORD)       msg = "<div class='msg D'><b>Het wachtwoord klopte niet</b> voor " + ssid + ". Kies het netwerk opnieuw en typ het wachtwoord nog eens. Let op hoofdletters.</div>";
  else if (wifiFail == WF_NOT_FOUND) msg = "<div class='msg D'>Netwerk " + ssid + " is niet gevonden. Staat de router aan? De sensor werkt alleen op 2,4 GHz.</div>";
  else if (wifiFail == WF_OTHER)     msg = "<div class='msg D'>Verbinden met " + ssid + " lukte niet. Probeer het opnieuw.</div>";
  portalHome = msg + PORTAL_HOME;
  wm.setCustomMenuHTML(portalHome.c_str());
}

void noteFailure(WifiFail f) {
  wifiFail = f;
  failSsid = wm.getWiFiSSID(true);
  Serial.printf("[wifi] %s: %s (reden %u)\n", failSsid.c_str(), failText(f), discReason);
  if (wm.getConfigPortalActive()) setPortalHome();
}

void openPortal() {
  Serial.println("[wifi] setup-netwerk " + apName() + " open (192.168.4.1)");
  WiFi.setAutoReconnect(false);          // geen eigen herverbind-pogingen terwijl iemand in het portal zit
  setPortalHome();
  wm.startConfigPortal(apName().c_str());
  lastWifiTry = millis();
}

void setupWiFi() {
  // Driver starten vóór getWiFiIsSaved()/getWiFiSSID(): die lezen de opgeslagen config via
  // esp_wifi_get_config, en dat geeft vóór de init rommel terug.
  WiFi.mode(WIFI_STA);
  wm.setConfigPortalBlocking(false);
  wm.setEnableConfigPortal(false);       // autoConnect alleen laten verbinden; het portal openen we zelf
  wm.setConfigPortalTimeout(0);
  wm.setConnectTimeout(20);
  wm.setConnectRetries(1);
  wm.setTitle("Woongezond");
  wm.setDarkMode(false);
  // Portal in Woongezond-stijl: eigen CSS, alleen de WiFi-knop (geen Info/Update/Exit),
  // Nederlandse uitleg op de startpagina. De velden op /wifi blijven Engels (SSID/Password).
  wm.setCustomHeadElement(PORTAL_CSS);
  std::vector<const char*> menu = {"custom"};
  wm.setMenu(menu);
  wm.setCustomMenuHTML(PORTAL_HOME);
  wm.setShowInfoUpdate(false);
  wm.setShowInfoErase(false);
  wm.setShowStaticFields(false);
  wm.setShowDnsFields(false);
  wm.setScanDispPerc(true);
  // Alleen redenen die iets zeggen bewaren; de disconnects die we zelf veroorzaken (portal
  // starten, opnieuw proberen) zouden "wachtwoord afgewezen" anders overschrijven.
  WiFi.onEvent([](arduino_event_id_t, arduino_event_info_t info) {
    uint8_t r = info.wifi_sta_disconnected.reason;
    if (classifyReason(r) != WF_NONE) { discReason = r; discNew = true; }
  }, ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
}

// Elke loop: nooit langer blokkeren dan één verbindingspoging (≤ 20 s).
void wifiTick() {
  if (WiFi.status() == WL_CONNECTED) {
    if (wm.getConfigPortalActive()) wm.stopConfigPortal();
    if (!wifiUp) {
      Serial.printf("[wifi] verbonden met %s, ip %s, rssi %d\n", WiFi.SSID().c_str(), WiFi.localIP().toString().c_str(), WiFi.RSSI());
      WiFi.setAutoReconnect(true);
    }
    wifiUp = true; wifiTries = 0; wifiFail = WF_NONE; discNew = false;
    return;
  }
  if (wifiUp) { wifiUp = false; lastWifiTry = millis(); Serial.println("[wifi] verbinding weg"); }

  if (wm.getConfigPortalActive()) {
    wm.process();                                   // portal + DNS; een opgeslagen poging blokkeert ≤ 20 s
    if (discNew) { discNew = false; noteFailure(classifyReason(discReason)); }
    static unsigned long lastBlink;
    if (millis() - lastBlink > 5000) { lastBlink = millis(); if (wifiFail == WF_PASSWORD) blink(4, 60, 90); else blink(2, 60, 90); }
    // Niemand in het portal: stil het bekende netwerk opnieuw proberen (router weer terug).
    if (WiFi.softAPgetStationNum() == 0 && wm.getWiFiIsSaved() && millis() - lastWifiTry > PORTAL_RETRY_MS) {
      lastWifiTry = millis();
      WiFi.begin();
    }
    return;
  }

  if (lastWifiTry && millis() - lastWifiTry < WIFI_RETRY_MS) return;
  lastWifiTry = millis();
  if (!wm.getWiFiIsSaved()) { Serial.println("[wifi] nog geen netwerk opgeslagen"); openPortal(); return; }

  Serial.println("[wifi] verbinden met " + wm.getWiFiSSID(true) + "…");
  blink(2);
  discNew = false; discReason = 0;
  if (wm.autoConnect(apName().c_str())) return;   // één poging; het portal openen we zelf
  wifiTries++;
  noteFailure(discNew ? classifyReason(discReason) : WF_OTHER);
  discNew = false;
  if (wifiFail == WF_PASSWORD || wifiTries >= WIFI_PATIENCE) openPortal();
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
    if (code > 0) {
      Serial.printf("[http] %d %s\n", code, resp.substring(0, 120).c_str());
      // Eenmalige opdracht van de server (uit "Sensor resetten" op de website).
      if (code == 200 && resp.indexOf("\"cmd\":\"reset_wifi\"") >= 0) {
        Serial.println("[cmd] reset_wifi ontvangen → wifi wissen, herstart naar setup-netwerk");
        blink(5, 60, 60); wm.resetSettings(); delay(300); ESP.restart();
      } else if (code == 200 && resp.indexOf("\"cmd\":\"restart\"") >= 0) {
        Serial.println("[cmd] restart ontvangen"); delay(300); ESP.restart();
      }
      return code;
    }
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

  setupWiFi();
  // Nog geen token/url (aan het bureau): nog geen WiFi of setup-netwerk. Dat komt vanzelf
  // (wifiTick in de loop) zodra de config er staat.
  if (!configured()) {
    Serial.println("[cfg] geen token/url. Typ in de seriële monitor:");
    Serial.println("      SET TOKEN wgd_…    SET URL https://woongezond.com/admin    SET NUMBER 3");
  }
}

void loop() {
  handleSerial();
  handleButton();
  if (!configured()) { static unsigned long t; if (millis() - t > 5000) { t = millis(); blink(3, 60, 120); Serial.println("[cfg] wacht op SET TOKEN / SET URL"); } delay(50); return; }
  wifiTick();

  if (millis() - lastSend >= INTERVAL_MS || lastSend == 0) {
    lastSend = millis();
    if (!scd41Ok) { Serial.println("[scd41] niet beschikbaar"); return; }
    bool ready = false;
    if (scd4x.getDataReadyStatus(ready) != 0 || !ready) { Serial.println("[scd41] data nog niet klaar"); lastSend = millis() - INTERVAL_MS + 5000; return; }
    uint16_t co2; float temp, rh;
    if (scd4x.readMeasurement(co2, temp, rh) != 0 || co2 == 0) { Serial.println("[scd41] ongeldige meting"); return; }
    Serial.printf("[meting] CO2 %u ppm · %.2f °C · %.2f %%\n", co2, temp, rh);
    if (WiFi.status() != WL_CONNECTED) { Serial.println("[wifi] geen verbinding, meting overgeslagen"); return; }
    int code = postReading(co2, temp, rh);
    if (code == 200)      blink(1, 40, 0);
    else if (code == 401) { Serial.println("[http] token afgewezen — SET TOKEN opnieuw"); blink(3); }
    else if (code == 429) Serial.println("[http] te snel — server vraagt te wachten");
  }
  delay(wm.getConfigPortalActive() ? 5 : 50);   // portal open: DNS/HTTP vlot bedienen
}
