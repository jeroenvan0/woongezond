# Huisprofiel: bewonersgedrag scheiden van woningprestatie

**Wens van Jeroen, 2026-09-14.** Staat op de [wenslijst](../WISHLIST.md) als §5. Dit document is
het plan plus mijn feedback en de literatuur. Fase 0 (detector, admin-tab Analyse, CLI-script)
is gebouwd op 2026-09-14; zie §4 voor de stand.

> Kern van de wens, in één zin: de sensor moet herkennen wanneer er in zijn kamer gelucht wordt,
> daaruit afleiden hoe vaak en hoe lang een huishouden lucht, en het huis daarmee afzetten tegen
> wat je bij die luchtfrequentie, dat gebouw en dat buitenweer mag verwachten. Blijft het huis
> daar ver onder, dan zit het probleem in de woning; zit het erboven, dan is het een goed huis.
> Zonder dit geven we open deuren ("we zien een piek om 23:00") en onderscheiden we ons niet.

---

## 1. Feedback op het plan

**De richting klopt en is precies waar de sector om vraagt.** Het hele debat rond vocht en schimmel
in huurwoningen gaat over toerekening: is het het gebouw of de bewoning? Corporaties én
bewoners hebben nu alleen een inspecteur die "meer luchten" adviseert. Een systeem dat per woning
zegt "bij het luchtgedrag van dit huishouden zou deze kamer op X moeten zitten en zit op Y" is
een ander product dan een CO₂-meter met een grafiek. Dit is bovendien de ontbrekende schakel
in wat er al ligt: het schimmelmodel in `lib/mouldRisk.ts` heeft al een tweeassig huisprofiel
(koude plekken = gebouw, vochtlast = bewoning), maar de vochtlast Δv0 is nog een *uitkomst* die
niets zegt over de *oorzaak*: veel vocht in de lucht kan komen door veel produceren, door weinig
luchten of door een lek. Dit plan splitst die as.

**Vijf correcties of aanscherpingen op de formulering:**

1. **De sensor ziet geen raam; hij ziet een verandering in luchtwisseling.** Wat we meten is
   dat de luchtverversing van *die kamer* even sterk toeneemt. Een raam, een deur naar de gang,
   een mechanische afzuiging die aanslaat en een bewoner die de kamer verlaat geven allemaal een
   daling. Het onderscheid zit in de *snelheid* (een raam geeft 3–15 wisselingen per uur, de
   achtergrond van een kamer 0,2–1) en in de winter in de temperatuurdip. Dus: "luchtmoment"
   is het eerlijke woord, niet "raam open", en de detectie is alleen betrouwbaar in de kamer
   waar de sensor hangt. Voor de pilot is dat de slaapkamer, en dat is ook waar het schimmel-
   risico zit, dus dat is geen probleem, maar we moeten het zo zeggen.

2. **CO₂ is de tracer, niet de vochtigheid.** Of de RV daalt bij luchten hangt van het
   buitenweer af: in de winter daalt hij, in een vochtige zomer kan hij stijgen. Reken daarom
   met absolute vochtigheid (g/m³, `vAbs` bestaat al) en met het verschil binnen-buiten Δv.
   Juist dat geeft de tweede, onderscheidende meting: **bij een luchtmoment moet Δv even snel
   dalen als CO₂.** Daalt CO₂ wel en Δv niet of nauwelijks, dan komt het vocht niet van de
   bewoners maar uit een doorlopende bron (lekkage, optrekkend vocht, kruipruimte). Dat is
   een signaal dat de huidige rapportheuristiek (CV van de RV) probeert te benaderen zonder er
   de fysica voor te hebben.

3. **Het onderscheid "gedrag – gebouw" is niet één as maar drie gebouwassen en twee
   bewonersassen.** "Constructief niet goed" kan drie heel verschillende dingen betekenen die
   een andere partij en een andere ingreep vragen:
   - *Ventilatievoorziening*: de kamer wisselt bij gesloten raam vrijwel geen lucht (geen
     roosters, kapotte of dichtgezette MV-box). Een dichte schil is op zich goed; zonder
     voorziening is het een gebrek.
   - *Vochtbron in het gebouw*: Δv blijft hoog ongeacht luchten (punt 2).
   - *Koude plekken*: f laag, schimmel bij een normale vochtlast (zit al in het model).
   
   En aan de bewonerskant: *luchtfrequentie en -duur* (gedrag) en *vochtproductie* (was
   binnen, douchen, koken, en het aantal bewoners: dat laatste is geen gedrag maar een
   gegeven). Het profiel moet die vijf apart laten zien. Anders krijg je weer één stoplicht
   dat "bewoner" of "verhuurder" zegt en dat is precies wat in de UK juridisch is afgeschoten
   (zie §5).

4. **De benchmark kan de eerste twee winters niet uit de vloot komen.** "Hoe zou dit huis
   met deze kenmerken bij deze luchtfrequentie moeten presteren" vraagt óf een fysisch model
   óf tientallen woningen per klasse. Met 8–10 pilotwoningen is een statistische norm
   onmogelijk; met de vragenlijst en de CO₂-massabalans is een fysische verwachting per
   woning wél haalbaar, met eerlijke onzekerheid. Voorstel: fysica nu, statistiek later, en de
   kenmerken nu al per dag per sensor opslaan zodat de vlootbenchmark
   ([fleet-analytics-roadmap.md](fleet-analytics-roadmap.md) F3) vanzelf data krijgt.

5. **Formuleer de uitkomst als "wat kan de bewoner doen, en is dat genoeg".** Dat is
   letterlijk wat Jeroen vraagt ("inschatten dat bewonersgedrag niet genoeg kan zijn") en
   het is de formulering die juridisch houdbaar is: geen diagnose, wel een verwachting.
   "Als u twee keer per dag tien minuten lucht, komt deze kamer in januari op ~78% RV in de
   hoek. Dat is niet genoeg; deze kamer heeft ook bij goed luchten een voorziening nodig."
   Het what-if in het schimmelmodel (−1,5 g/m³ voor "ventilatie") wordt dan gevoed door de
   *gemeten* ventilatie-effectiviteit van dit huis in plaats van een vast getal.

**Waar het plan echt onderscheidend is.** Niet in de luchtmomentdetectie op zich (dat doen
onderzoeksgroepen al tien jaar, zie §5) maar in de combinatie: minuutdata + buitenweer per uur
+ vragenlijst + het koude-plekmodel, per woning, over een heel stookseizoen, met als uitkomst
een verwachting die de bewoner en de corporatie allebei kunnen lezen. Commerciële producten
(Airthings, Netatmo) geven alleen niveaus; de sociale-huur-sensoren in de UK (HomeLINK,
Switchee) geven een risicoscore en soms "bewoning vs. woning", zonder gepubliceerde validatie.

---

## 2. Wat er al ligt (en wat we ervan kunnen hergebruiken)

| Wat | Waar | Bruikbaar? |
|---|---|---|
| CO₂, T, RV elke **60 s** (SCD41), VOC/NOx-index | `air_quality`, firmware `INTERVAL_MS` | Ja. Minuutresolutie is ruim genoeg voor decays van 5–120 min. |
| Buitenweer per uur: T, RV, druk, **wind** | `city_weather` | Ja. Wind en ΔT sturen infiltratie (§3.4). |
| Huisprofiel: kamer, bewoners 's nachts, bouwperiode, glas, renovatie, ventilatiesysteem, verwarming, was binnen, huishoudgrootte | `lib/houseProfile.ts` | Ja. Bewoners 's nachts is de CO₂-bronsterkte; ventilatietype is de verwachte achtergrondwisseling. |
| ACH uit CO₂-decay (piek > 1200 ppm, log-lineaire fit, `ACH = 60/τ`) | `lib/reportAnalytics.ts::berekenAch` | Deels. Middelt luchtmomenten en achtergrond in één getal en vergelijkt dat met Bouwbesluit 0,9 — dat vergelijkt appels met peren (§3.2). |
| Vochtlast Δv0 (seizoensgeschaald) en huisprofiel type (koud/vochtig/balans) | `lib/mouldRisk.ts` | Ja. Wordt de "vochtbron"-as; krijgt er de oorzaak bij. |
| CV-heuristiek LEKKAGE/GEDRAG/BOUWKUNDIG | `lib/reportAnalytics.ts::cvRh` | Vervangen. Ongevalideerd en juridisch geladen ([WISHLIST §3a](../WISHLIST.md)). |
| ML-feature `window_open` | `lib/ml/types.ts` | Staat altijd op 0. Wordt gevuld door de detector. |
| Scenario-simulator (ACH, bewoners) | `lib/calculations.ts::scenarioOutputs` | Zelfde massabalans; constanten (18) zijn ongeciteerd. Vervangen door §3.3. |

**Eén valkuil in de sensor.** De SCD41 heeft automatische zelfkalibratie (ASC) standaard aan
(firmware roept `startPeriodicMeasurement` zonder ASC uit te zetten). ASC neemt aan dat de
sensor elke week een keer ~400 ppm ziet. In een slaapkamer die nooit gelucht wordt drijft de
nullijn dan omlaag en wordt "nooit onder 700" na een paar weken "keurig 450". Dat maskeert
precies de huizen waar het om gaat. Voor het pilotseizoen: ASC uit en één keer buiten
kalibreren bij de installatie, óf ASC aan en de weekminima loggen zodat we drift zien. Beslissing
nodig vóór de uitrol; achteraf is het niet te herstellen.

---

## 3. Hoe het werkt (voorstel)

Alles serverkant, op ruwe minuutrijen, per `device_id`, één keer per dag (en voor "vandaag"
op verzoek). Uitkomst per dag in een nieuwe tabel `device_daily_features`. Dit sluit aan bij
[WISHLIST §4](../WISHLIST.md) (features per sensor uit ruwe rijen, model per huishouden).

### 3.1 Luchtmomentdetectie

Een luchtmoment is een periode waarin CO₂ sneller daalt dan de achtergrond kan verklaren.

1. 5-minuutgemiddelden, alleen segmenten zonder gat > 10 min.
2. Kandidaat: CO₂ daalt ≥ 150 ppm binnen 15 min én de fit `ln(C − C_buiten) = a − t/τ` geeft
   τ < 30 min (ACH > 2/h). `C_buiten` niet vast op 450 maar het 2-percentiel van de laatste
   7 dagen van *deze* sensor (ASC-drift, zie boven).
3. Bevestiging (winter, buiten < 12 °C): temperatuur daalt ≥ 0,5 °C in dezelfde 15 min. Buiten
   het stookseizoen is de temperatuurdip afwezig en is de detectie minder zeker; markeer dat.
4. Einde: het moment dat CO₂ weer stijgt of de daling afvlakt naar de achtergrond-τ.
5. Onderscheid met "bewoner verlaat de kamer": dan verdwijnt de bron maar blijft τ die van de
   achtergrond (> 60 min). Steile daling = luchtwisseling; trage daling = bron weg. 's Nachts
   (bewoners aanwezig volgens de vragenlijst) is elke steile daling een luchtmoment.
6. Per dag: aantal luchtmomenten, totale duur, mediane ACH tijdens luchten, verdeling over de
   dag (ochtend/avond/nacht), en de Δv-daling tijdens die momenten (§3.3).

Verwacht: goed herkenbaar in de winter, onzeker bij warm weer en in kamers met balansventilatie
(WTW houdt CO₂ vlak, er is dan weinig te zien; dat is op zich ook informatie).

### 3.2 Achtergrondwisseling: de gebouweigenschap

Twee onafhankelijke schatters, allebei zonder raam open:

- **Trage decay.** Decays met τ > 60 min (bron weg, raam dicht): `n_achtergrond = 1/τ`.
- **Nachtplateau.** Bij een constante bron stelt CO₂ zich in op `C_ss − C_buiten = G/(n·V)`.
  G uit het aantal bewoners 's nachts (slapende volwassene ≈ 0,0028 L/s ≈ 10 L/h, Persily &
  De Jonge 2017, afhankelijk van lichaamsgewicht; kinderen ongeveer de helft), V uit de kamer
  (slaapkamer ~30 m³, woonkamer ~80 m³; later een vraag). Dan `n = G/(V·(C_ss − C_buiten))`.
  G en V zijn elk ±30% onzeker, dus n is ±50%: goed genoeg voor *laag / normaal / hoog*, niet
  voor een getal met twee decimalen. Referentie: in 500 Deense kinderslaapkamers was de
  nachtelijke wisseling mediaan 0,46/h en zat 57% onder 0,5/h (Bekö 2010), dus "laag" is
  eerder regel dan uitzondering.

Per week: mediaan en spreiding. **Dit getal, niet het gemengde ACH van vandaag, hoort tegenover
de Bouwbesluit-eis** (0,9 dm³/s per m² ≈ 0,7–1 wisseling/uur voor een slaapkamer). Zit de
achtergrond ver onder 0,3/h met "roosters" of "mechanisch" in de vragenlijst, dan is dat het
signaal *ventilatievoorziening werkt niet*.

### 3.3 Vochtbalans: waar komt het vocht vandaan

Zelfde massabalans voor waterdamp: `V·dv/dt = P − n·V·(v_in − v_uit)`. Met n uit §3.1/§3.2
en Δv gemeten volgt de vochtproductie P (g/h) per dag en per nacht.

- **Nachtproductie** met bekend aantal slapers (~40–50 g/h per persoon) is een ijkpunt: komt
  er 's nachts veel meer uit dan de slapers verklaren, dan is er een andere bron.
- **Δv-daling tijdens luchtmomenten**: hoort dezelfde τ te hebben als CO₂. Ratio
  `τ_Δv / τ_CO₂` ≈ 1 → vocht zit in de lucht (bewoning); ≫ 1 of geen daling → doorlopende
  bron of nat materiaal dat nadampt (gebouw). Dit is de vervanger van de CV-heuristiek.
- **Dagproductie** (was, douchen, koken) als restpost: verschil met wat de vragenlijst
  (was binnen: soms/vaak) doet verwachten.

### 3.4 Weergevoeligheid: de lekkagesignatuur van de schil

Infiltratie hangt af van wind en van het binnen-buiten-temperatuurverschil (schoorsteeneffect).
Regressie van de wekelijkse achtergrond-n op windsnelheid en ΔT geeft per woning een helling:
een dichte schil met roosters heeft een lage, weerongevoelige n; een lekke oude woning een n
die met de wind oploopt. Pas zinvol na een paar maanden winter. Fase 3.

### 3.5 De verwachting: "zo zou dit huis moeten presteren"

Gegeven: bewoners (vragenlijst), gemeten luchtgedrag (§3.1), buitenweer (uur), en een
*referentie-achtergrondwisseling* die bij het opgegeven ventilatietype hoort (geen: 0,2/h;
roosters: 0,5; mechanisch: 0,7; WTW: 0,9; onzekerheid ±40%). Dan rekent de massabalans uit
wat CO₂ 's nachts en Δv in januari *zouden zijn* als de voorziening werkte en er geen extra
vochtbron was. Vergelijk met gemeten:

| Gemeten t.o.v. verwacht | Betekenis | Wie |
|---|---|---|
| CO₂ en Δv rond verwacht | huis doet wat het moet; luchtgedrag bepaalt de rest | bewoner (advies) |
| CO₂ hoog, Δv naar rato | achtergrondwisseling te laag: voorziening | corporatie |
| CO₂ normaal, Δv hoog, τ-ratio ≫ 1 | vochtbron in het gebouw | corporatie |
| CO₂ normaal, Δv hoog, τ-ratio ≈ 1, P > verwacht | vochtproductie (was, huishoudgrootte) | bewoner / gesprek |
| alles normaal, koude plek f < 0,6 | koude plekken (bestaand model) | corporatie |

Daaronder de zin die Jeroen wil: "Als u [gemeten gedrag] volhoudt, komt de hoek in januari
op X% RV. Meer luchten brengt dat naar Y. [Dat is (niet) genoeg.]" Het what-if in
`assessMould` gebruikt dan de gemeten n en de gemeten P in plaats van −1,5 g/m³.

### 3.6 Het huisprofiel op het scherm

Vijf balkjes, elk laag/normaal/hoog met betrouwbaarheid (zoals nu bij de vochtlast), twee
onder "bewoning", drie onder "woning": luchten, vochtproductie | ventilatievoorziening,
vochtbron, koude plekken. Eén samenvattende zin per profiel. Nooit het woord "verantwoordelijk".
Op het dashboard een tegel "Gelucht: 2× vandaag, 25 min" met "voorlopig" tot de detector
gevalideerd is. In het rapport en de weekmail vervangt dit de CV-heuristiek.

---

## 4. Fasering

**Fase 0 — detector en dagkenmerken (2–3 dagen, kan nu).**
- [x] `lib/ventilationEvents.ts` (2026-09-14): pure functies, 13 tests op synthetische reeksen
  met bekende τ. Vier labels: *gelucht (raam of deur)*, *achtergrond (raam dicht)*,
  *vochtpiek*, *bezetting*. Elk moment krijgt een **95%-interval op de ACH** (standaardfout van
  de log-lineaire helling, verbreed met de nullijn-onzekerheid ±30 ppm) en een **zekerheid
  0–1 voor het label** met de bewijsonderdelen als tekst. Dagsamenvatting: luchtmomenten,
  minuten, achtergrond-ACH, nachtplateau en de nacht-ACH uit slapers × 10 L/h in ~30 m³
  (±50 %). Zie CALCULATIONS.md §11.
- [x] **Admin-tab Cockpit › Analyse** (`/cockpit/analyse`, `/api/cockpit/analyse`): alle
  sensoren van de vloot in één grafiek (CO₂, T, RV, vochtoverschot; 1/2/7 dagen), klik op een
  sensor om de gelabelde momenten als vlakken te zien, tabel met interval, zekerheid en
  bewijs. Alleen org-admins; bewust niet voor bewoners zolang het ongevalideerd is.
  Rekent per aanvraag op ruwe minuutrijen (7 dagen × 10 sensoren ≈ 100k rijen, enkele
  seconden); een dagelijkse job naar `device_daily_features` is de volgende stap zodra de
  labels een winter hebben meegedraaid.
- [x] **Eerste echte data** (`npm run analyse -- --device 1 --days 30`, script
  `scripts/analyse-device.mts`; `--list` toont alle sensoren). Sensor 1 (Jeroen, augustus):
  2–4 luchtmomenten per dag van 15–30 min met ACH 3–7/h, intervallen ±40 %; op 21–23
  augustus stond de kamer 24 uur op buitenniveau (raam permanent open), dus terecht geen
  momenten. Sensor 2: nachtplateau 1988 ppm op 10 september → 0,42/h [0,25–0,68]; de trage
  decay van 9 september gaf onafhankelijk 0,45/h [0,22–0,64]. Twee schatters die het eens
  zijn is het eerste teken dat de achtergrondwisseling als gebouwgetal bruikbaar is. Wat
  opviel: de fit op 5-minuutbuckets gaf onbruikbare intervallen (3 punten, df = 1); de fit
  loopt nu op de ruwe minuutrijen. Een vochtpiek vlak vóór een luchtmoment in de zomer is
  vaak vochtige buitenlucht; dat staat nu als voorbehoud in het bewijs. **Sensor 2 heeft
  geen `city_id`**, dus geen buitenweer en geen temperatuurweging; zie open vraag 5.
- [ ] Dagelijkse job (systemd-timer zoals de weekmail) → `device_daily_features`.
- [ ] Dashboardtegel "Gelucht" met "voorlopig" (pas na fase 1). ML-feature `window_open` vullen.
- [ ] `berekenAch` in het rapport splitsen in achtergrond en luchtmomenten; de Bouwbesluit-
  vergelijking alleen nog tegen de achtergrond.
- [ ] **Beslissing ASC** (§2) vóór de uitrol van de volgende sensoren.

**Wat de sensor niet kan (en hoe we daarmee omgaan).** Raam versus deur naar de gang is met één
sensor niet hard te scheiden. Twee zwakke aanwijzingen staan in het bewijs per moment: bij een
raam in de winter daalt de temperatuur en zakt de CO₂ tot het buitenniveau; bij een deur blijft
de temperatuur gelijk en vlakt de CO₂ af op het huisniveau. "Altijd raam open" komt niet als
momenten terug maar als een hoge achtergrondwisseling en een laag nachtplateau; was drogen als
vochtpiek. Alle pilotsensoren hangen in een slaapkamer, dus het label "gelucht" gaat over de
slaapkamer en de nacht-ACH gebruikt de slapers uit de vragenlijst.

**Fase 1 — valideren in de winter (december–februari, pilot).**
- **Raamcontact** in 2–3 pilotwoningen (Zigbee-contactsensor, ~€15, op het slaapkamerraam;
  loggen via een goedkope hub of ESPHome). Dat is de grondwaarheid voor §3.1. Zonder dit
  blijft de detector een aanname. Alternatief: een "ik heb gelucht"-knop in de app of in de
  weekmail; goedkoper, maar mensen vergeten het.
- Eén avond "kamer dicht" per woning geeft een schone decay voor §3.2.
- IR-meting van f (staat al in het validatieplan van het schimmelmodel §4.4b).
- Drempels (150 ppm, τ < 30 min, 0,5 °C) bijstellen; precisie/recall vastleggen.

**Fase 2 — verwachting en profiel (na de validatie, ~1 week).**
- §3.3 vochtbalans en τ-ratio, §3.5 verwachtingsmodel, §3.6 profiel.
- CV-heuristiek en "verhuurder verantwoordelijk" uit het rapport; tekst laten meelezen door
  iemand van een corporatie of een bouwfysicus.
- Vragen erbij op /start: kamervolume (klein/normaal/groot), "hoe vaak zet u het raam open"
  (om zelfrapportage naast meting te leggen), datum laatste onderhoud MV.

**Fase 3 — vloot (bij tientallen woningen).**
- Weergevoeligheid §3.4, cohortbenchmark (fleet-analytics F3): "woningen van vóór 1975 met
  roosters halen mediaan n = 0,4; deze 0,15".
- Hiërarchisch model: gedeeld basismodel per huistype, per woning bijgetraind (WISHLIST §4.3).

---

## 5. Literatuur en bestaande aanpakken

Gezocht op 2026-09-14. Per onderwerp de bronnen die er voor ons toe doen, wat ze vonden en de
kanttekening. Getallen uit één gebouw of één lab zijn optimistisch; dat staat er dan bij.

### 5.1 Raam-open-detectie met één binnensensor

- **Change-point-detectie op T/RV/CO₂** (Energy & Buildings 2018; Building & Environment 2018):
  ~97% en 99,7% nauwkeurigheid voor raam open, douchen, koken. Eén gebouw, raamcontacten als
  grondwaarheid; optimistisch.
  https://www.sciencedirect.com/science/article/abs/pii/S0378778818306066 ·
  https://www.sciencedirect.com/science/article/abs/pii/S036013231830605X
- **Deep learning op T + CO₂ in het stookseizoen** (Building & Environment 2023): beste RNN
  F1 = 0,78; binnentemperatuur alleen vangt al 84–88% van de open-tijd. Realistischer getal
  voor wat wij kunnen verwachten: **80–90% van de luchtmomenten**.
  https://www.sciencedirect.com/science/article/abs/pii/S036013232300046X
- **Raam-open-*oppervlak* detecteren** (Building & Environment 2023): LightGBM 87%; 65% van de
  openingen was gewoonte, niet reactie op het binnenklimaat. Relevant: luchtgedrag is grotendeels
  een vaste routine per huishouden, dus goed te meten in een paar weken.
  https://www.sciencedirect.com/science/article/abs/pii/S0360132323008442
- **De valkuil** die overal terugkomt (o.a. arXiv 2403.06643, 2024): een CO₂-daling alleen is
  dubbelzinnig tussen "raam open" en "mensen weg". Alleen de gelijktijdige daling van
  temperatuur en absolute vochtigheid richting buitenwaarde maakt het onderscheid. Dat is
  §3.1 stap 3 en 5.

### 5.2 Luchtwisseling uit CO₂-decay

- **ASTM E741 / ISO 12569** (decay-methode): ~5% onzekerheid onder gecontroleerde condities
  (Cui et al. 2015), maar de aannames (constante wisseling, vaste buitenwaarde) gelden niet in
  natuurlijk geventileerde woningen.
  https://www.sciencedirect.com/science/article/abs/pii/S0360132314003606
- **Bekö et al. 2010 (DTU)**: nachtelijke slaapkamerwisseling uit CO₂ in 500 Deense
  kinderslaapkamers: geometrisch gemiddelde 0,46/h, 57% onder 0,5/h, slechts 32% van de
  kamers gemiddeld onder 1000 ppm. Precies onze methode §3.2, op schaal bewezen.
  https://www.sciencedirect.com/science/article/abs/pii/S0360132310001216
- **Few & Elwell 2021 (UCL)**: automatische decay-selectie in 4 bewoonde woningen, >100 decays;
  9–13% onzekerheid per decay, maar **4–46% van de decays moest worden afgekeurd** door een
  drijvende buitenwaarde, en in een appartement was 32% van de uitkomsten < 0,1/h, niet te
  onderscheiden van lucht uit de buren. Buiten-CO₂ meten noemen zij essentieel; wij hebben
  dat niet, vandaar het 2-percentiel per sensor in §3.1 en de ASC-beslissing in §2.
  https://discovery.ucl.ac.uk/id/eprint/10136217/
- **CO₂-productie per persoon**: Persily & De Jonge 2017 (Indoor Air): oudere kentallen zitten
  er tientallen procenten naast; productie hangt af van gewicht, leeftijd en activiteit
  (slapend ≈ 0,0028 L/s per volwassene). Batterman 2017 (review) noemt de onbekende activiteit
  de grootste foutbron. Het getal 18 in `scenarioOutputs` moet hierdoor vervangen worden.
  https://onlinelibrary.wiley.com/doi/abs/10.1111/ina.12383 ·
  https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5334699/
- **Onvolledige menging**: simulaties laten zien dat CO₂-afgeleide wisseling 0–51% onder de
  werkelijke totale wisseling kan liggen (2026). Weer een reden voor klassen, niet getallen.
  https://www.sciencedirect.com/science/article/pii/S2352710226000781

### 5.3 Vochtoverschot als indicator productie vs. ventilatie

- **ISO 13788 (2012) bijlage A** neemt de IEA Annex 24-klassen (Sanders 1996) over: Δv daalt
  lineair met de buitentemperatuur; klasse 2 ≈ 4 g/m³, klasse 3 ≈ 6, klasse 4 ≈ 8 bij ≤ 0 °C,
  naar 0 bij 20 °C. Dit bevestigt de klassen die al in `lib/mouldRisk.ts` staan (de open
  vraag "check tegen de norm" in CALCULATIONS §4.4.4 kan dicht). **BS 5250:2021** heeft de
  waarden herzien (klasse 2: 5 g/m³ onder 5 °C, 2 g/m³ boven 15 °C).
- **Gemeten verdelingen**: Vinha et al. 2018, 220 Finse woningen, tot 28 maanden: gemiddeld
  vochtoverschot in het koude seizoen 2,8 ± 1,6 g/m³; 90e percentiel 3–8 g/m³ afhankelijk van
  de bewoningsdichtheid. Oreszczyn et al. 2006 (Warm Front, 1.604 Engelse woningen met lage
  inkomens): hogere bezetting gaf een hoger vochtoverschot en werd **niet** gecompenseerd door
  meer ventileren. Dat is de reden om huishoudgrootte als gegeven en niet als gedrag te
  presenteren (§1 punt 3).
  https://researchportal.tuni.fi/en/publications/internal-moisture-excess-of-residential-buildings-in-finland ·
  https://dx.doi.org/10.1177/1420326X06063051
- **Diagnostisch gebruik** (BRE, RICS/isurv): hoog vochtoverschot = productie/ventilatie;
  oppervlak onder dauwpunt = bouwkundig (koudebrug); condensatie heeft beide nodig. Dit is
  exact de tweeassige logica van het bestaande huisprofiel, nu met een derde as (vochtbron)
  erbij. https://bregroup.com/insights/diagnosing-the-causes-of-dampness-in-buildings

### 5.4 Benchmarken van een woning uit meetdata

- **SMETER (UK, 2022) en GHG-SMETER (2025, 2.560 woningen)**: warmteverliescoëfficiënt uit
  slimme-meterdata; zonder binnentemperatuur maar 54–55% plausibele schattingen, met
  binnentemperatuur 66–69%; **alleen bruikbaar op cohorten ≥ 50 woningen, niet per woning**,
  en het slechtst bij onderverwarmde huizen. De belangrijkste les voor ons plan: een
  verwachting per individuele woning is fragiel, een cohortnorm is robuust. Vandaar fysica
  met brede onzekerheid nu, cohorten later (§1 punt 4).
  https://assets.publishing.service.gov.uk/media/68b186f7cc8356c3c882a8e3/GHG-SMETER-summary.pdf
- **Twomes / NeedForHeat (Windesheim, Ter Hofte, 2025)**: open-source grey-box-model (GEKKO)
  dat uit P1-meter + CO₂/T/RV per kamer warmteverlies, thermische massa, windafhankelijke
  infiltratie en ventilatie schat; Brains4Buildings-uitbreiding gebruikt de CO₂-massabalans
  voor bezetting en ventilatie. Nederlands, open, en dicht bij wat wij willen; nog geen
  gepubliceerde nauwkeurigheid. Kandidaat om code of aanpak van te lenen in fase 3.
  https://arxiv.org/pdf/2509.06927 · https://github.com/energietransitie/needforheat-diagnosis-software
- **NTA 8800 qv10 per bouwjaar** als prior voor de luchtdichtheid als er geen meting is
  (klassen > 0,6 basis, 0,3–0,6 goed, < 0,15 dm³/s·m² uitstekend; BENG-default 0,4). Te
  gebruiken als startwaarde voor de achtergrondwisseling per bouwperiode in §3.5.
  https://www.blowerdoorservice.nl/informatie/qv10-meting

### 5.5 Toerekening bewoner vs. gebouw: wat als eerlijk geldt

- **Housing Ombudsman "It's not lifestyle" (2021)**: 410 klachten, 56% maladministratie; het
  woord "lifestyle" moet uit het vocabulaire van verhuurders; bewijsgestuurd en proactief.
  **Awaab's Law** (UK, sinds 27-10-2025): onderzoek binnen 10 werkdagen, schriftelijke
  bevindingen binnen 3, herstel binnen 5. De richting waar de NL-praktijk ook heen gaat.
  https://www.housing-ombudsman.org.uk/wp-content/uploads/2021/10/Spotlight-report-Damp-and-mould-final.pdf
- **GGD-richtlijn schimmel en vocht (RIVM 2012)**: beoordeelt expliciet gedrag (koken,
  douchen, ventileren, stoken) naast bouwkundige oorzaken via consult, huisbezoek en metingen.
  **Aedes-handreiking (2023)**: de meeste gevallen zijn een *combinatie* (koudebrug plus
  onvoldoende ventilatie); de corporatie neemt het gebouw, ondersteunt de bewoner. ~1 op 5
  Nederlandse woningen heeft vocht- of schimmelproblemen (TNO/ABF/GGD).
  https://www.rivm.nl/publicaties/ggd-richtlijn-medische-milieukunde-schimmel-en-vochtproblemen-in-woningen ·
  https://aedes.nl/media/document/aanpak-van-vochtproblemen-woningen2023
- **WHO 2009**: aanhoudend vocht is zelf het gezondheidsrisico; voorkomen gaat boven
  toerekenen. https://www.who.int/publications/i/item/9789289041683

Consequentie voor de teksten: geen oordeel "bewonersgedrag", wel bewijsklassen ("hoge
vochtlast", "lage luchtverversing bij gesloten raam", "koude plek waarschijnlijk") en altijd
de zin dat het meestal een combinatie is.

### 5.6 Wat concurrenten doen

- **Aico HomeLINK** (UK, sociale huur): "structural vs environmental"-inzicht (structureel:
  typische oppervlaktevochtigheid, warmteverlies, natuurlijk-ventilatietekort; omgeving:
  vochtpieken, verwarmingsinstabiliteit, ventilatie-inactiviteit). Geen gepubliceerde
  validatie; casestudies kwalitatief. https://www.aico.co.uk/homelink/solutions/damp-mould/
- **Switchee**: risicoklassen uit T/RV (+CO₂ als "ventilation efficacy"), daarna een
  triagevragenlijst op het display (88–89% respons in 24 uur); van de hoog-risico-woningen had
  55% al zichtbare schimmel. **De toerekening komt uit de vragenlijst en menselijke triage,
  niet uit het algoritme.** https://switchee.com/wp-content/uploads/2023/04/Best-practice-of-mould-triaging.pdf
- **Purrmetrix**: meerdere kamers T/RV/CO₂, benchmark "waar en wanneer"; framing isolatie vs.
  ventilatie vs. vochtbeheer. https://www.purrmetrix.com/solutions/
- **NL**: corporatiepilots met 2-weekse loggers bestaan; Radar berichtte over een "kastje"
  zonder wetenschappelijke onderbouwing. Voor Clairify, Homelyfe en Sero is geen publieke
  validatie gevonden. https://radar.avrotros.nl/artikel/fragment-woningcorporatie-zet-kastje-in-tegen-vochtproblemen-62595

**Conclusie uit de vergelijking:** niemand publiceert detectienauwkeurigheid of ACH-fout. Een
kleine validatieset (raamcontacten in 2–3 woningen, één blowerdoortest) waarmee wij dat wél
kunnen, is op zichzelf al onderscheidend richting corporaties.

---

## 6. Open vragen voor Jeroen

1. **ASC aan of uit** op de SCD41 voor de volgende sensoren (§2)? Mijn advies: uit, met een
   buitenkalibratie bij installatie en een jaarlijkse hercontrole.
2. **Raamcontacten in de pilot**: mogen we 2–3 huishoudens vragen een contactsensor op het
   slaapkamerraam te plakken voor de winter? Dit is de enige manier om de detector te ijken.
3. **Kamervolume** als extra vraag op /start (drie knoppen)? Halveert de onzekerheid van §3.2.
4. **Wie leest de profieltekst mee** voordat het in het rapport gaat (corporatiecontact,
   bouwfysicus)? Dit raakt de positionering uit [WISHLIST §3a](../WISHLIST.md).
5. ~~Sensor 2 heeft geen `city_id`.~~ **Opgelost 2026-09-14:** sensor 2 staat op Amsterdam en
   de vragenlijst (/start) heeft nu een stap *Plaats* (getypt of via de GPS van de telefoon;
   alleen de plaatsnaam wordt bewaard, `lib/geocode.ts`). **Sensor 3, 5 en 7 hebben nog geen
   plaats**: de bewoner kan de vragenlijst opnieuw openen (cockpit › Vragenlijst openen), of
   zet hem met de hand. Zonder plaats geen buitenweer, dus geen vochtoverschot en geen
   temperatuurdip-weging; de cockpit waarschuwt daar nu bij de sensor.
