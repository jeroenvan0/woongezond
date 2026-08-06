# Calculation methodology — status & documentation

**Status: v1, not yet validated.** Every formula below was ported 1:1 from an earlier
Flask/Dash app (`calculations.py`, `mould_models.py`, `report.py`, `ml/*.py` — reportedly still
living at `/var/www/woongezond-dev` per `CLAUDE.md`). The port preserved the numbers exactly, but
**no one has yet validated these numbers against ground truth** (a building inspector's
assessment, visible mould in a pilot home, a resident's own comfort perception, etc.). That
validation is explicitly what the 10-device pilot is for. This document exists so every constant,
threshold, and modelling decision is written down in one place — both to make the pilot's
validation work possible, and so nothing here is "tribal knowledge" living only in a script on a
prior developer's machine.

Read this alongside [ROADMAP.md](ROADMAP.md), which covers infrastructure/security; this document
is scoped to *what the numbers mean and where they come from*.

---

## 1. Overview: what gets computed, and where

| Score/metric | Formula location | Shown on | Physical basis |
|---|---|---|---|
| Dewpoint | `lib/calculations.ts::dewpoint` | Dashboard, scenarios, schimmelrisico | Magnus formula |
| Absolute humidity | `lib/calculations.ts::absHumidityGkg`/`rhFromAbs` | Scenario simulator | Tetens equation |
| Wall-surface T/RH | `lib/calculations.ts::calcWallConditions` | Schimmelrisico page | ISO 6946 |
| **Mould risk (dashboard)** | `lib/calculations.ts::mouldRisk` | Dashboard KPI tile | Heuristic margin, fixed wall offset |
| **Mould risk (scenarios)** | `lib/calculations.ts::mouldRiskScenario` | What-if calculator | Heuristic margin, outdoor-temp-aware wall offset |
| **Mould risk (trends/report)** | `lib/trends.ts::mouldRiskWd` | Trends, monthly stats, report diagnosis | Heuristic margin, diurnal (time-of-day) wall offset |
| **Mould risk (Schimmelrisico page)** | `lib/mouldModels.ts` (VTT + WUFI-Bio) | Dedicated Schimmelrisico page | Two published building-physics models |
| Health Score | `lib/calculations.ts::healthScore` | Dashboard, trends, monthly stats | Weighted composite of CO₂/RH/mould-risk bands |
| Night CO₂ outlook | `lib/nightForecast.ts` | Dashboard/chat | Empirical — resident's own recent nights |
| Report diagnosis | `lib/reportAnalytics.ts` | `/report` page | Rule-based thresholds on CV, ACH, trend p-values |
| CO₂/RH forecast (ML) | `lib/ml/*` | Dashboard ML card | From-scratch Ridge regression |
| Alert thresholds | `app/api/notifications/check/route.ts` | Email/notification alerts | Fixed defaults, per-user override |

**The single most important thing to understand from this table**: *there are four different
"mould risk" numbers in this app*, computed four different ways, and they are not the same
metric even though they'd all reasonably be read as "how much mould risk do I have." This is
detailed in §4.

---

## 2. Core physics primitives

### 2.1 Dewpoint — Magnus formula
`lib/calculations.ts::dewpoint(temp, rh)`
```
γ = (a·T)/(b+T) + ln(RH/100),  a = 17.625, b = 243.04
Td = (b·γ)/(a−γ)
```
RH is clamped to [1, 100] before use. Standard, widely-used approximation; not itself a
questionable choice.

### 2.2 Saturation vapour pressure — three separate implementations
There isn't one shared "saturation vapour pressure" function — there are **three**, in three
files, all Magnus/Tetens-family approximations that should agree closely but are literally
different code:
- `lib/calculations.ts::satVaporPressure` (kPa): `0.6108·exp(17.27·T/(T+237.3))` — feeds absolute
  humidity conversions for the scenario simulator.
- `lib/calculations.ts::pSat` (hPa): `6.1078·10^(7.5·T/(237.3+T))` — feeds `calcWallConditions`
  (the wall-surface model).
- Implicitly, `dewpoint()`'s own Magnus form is a third parameterisation of the same physics.

**Decision needed during validation**: these should probably be unified into one function once
someone confirms they don't diverge meaningfully across the temperature range this app cares
about (roughly 0–30°C indoor/outdoor). Not flagged as a correctness bug — just duplication that
makes future changes error-prone (a fix to one won't propagate to the others).

### 2.3 Absolute humidity
`lib/calculations.ts::absHumidityGkg` / `rhFromAbs` — standard conversion via vapour pressure and
a fixed atmospheric pressure of 101.3 kPa (sea-level assumption; the Netherlands is close enough
to sea level that this is a reasonable simplification, not something the pilot needs to revisit).

### 2.4 Wall-surface temperature/RH — ISO 6946
`lib/calculations.ts::calcWallConditions(T_binnen, RH_binnen, T_buiten, R_totaal)`
```
T_wand = T_binnen − (T_binnen − T_buiten)·(Rsi / R_totaal)
RH_wand = min(100, RH_binnen · pSat(T_binnen)/pSat(T_wand))
```
- `Rsi = 0.13 m²K/W` — ISO 6946 standard interior surface resistance. Not house-specific; a
  textbook constant.
- `R_totaal` — wall thermal resistance, looked up from `devices.insulation`:

  | Class | R_totaal (m²K/W) | Era (Dutch housing stock) |
  |---|---|---|
  | poor | 0.35 | pre-1975, uninsulated |
  | moderate | 0.90 | 1975–2000, cavity wall |
  | good | 2.50 | post-2000 |
  | excellent | 4.00 | post-2015, near-energy-neutral |

  **These four numbers are the single biggest unvalidated assumption in the wall-surface model.**
  They're plausible engineering estimates for "typical" Dutch construction eras, but they are
  *not* measured for any specific pilot house — a real post-2000 house with an especially bad
  detail (thermal bridge, poor window seal) could have much worse actual wall performance than
  "good" implies, and vice versa. **Every pilot device defaults to `insulation = 'poor'`** (the
  conservative/worst-case assumption) until someone sets it — worth confirming during device
  onboarding that this gets set correctly per home, since it silently and significantly changes
  every wall-surface-derived score.
- **Outdoor temperature source**: the Schimmelrisico page (`app/schimmelrisico/page.tsx`) matches
  each indoor reading to the *nearest hourly* outdoor reading from `city_weather`, but only trusts
  it within a 3-hour window (`MAX_OUTDOOR_GAP_MS`); beyond that, or with no weather history at all,
  it falls back to a **hardcoded 5°C outdoor temperature** (`DEFAULT_OUTDOOR_C`) — a "safe" cold
  assumption chosen so the model doesn't understate risk when weather data is missing, but it
  means any period without weather-ingest coverage silently uses a fixed 5°C rather than the
  real outdoor temperature for that day.

---

## 3. Health Score (dashboard composite, 0–100)
`lib/calculations.ts::healthScore(nightCo2, indoorRh, mouldRisk)` — a weighted blend:
```
score = 0.4·CO2_band + 0.3·RH_band + 0.3·mould_band
```
| CO₂ (ppm) | band score | RH (%) | band score | Mould risk | band score |
|---|---|---|---|---|---|
| <800 | 100 | 40–60 | 100 | <30 | 100 |
| <1000 | 70 | 30–70 | 70 | 30–60 | 60 |
| <1200 | 40 | 20–75 | 40 | 60–80 | 25 |
| ≥1200 | 10 | else | 10 | ≥80 | 5 |

The 40/30/30 weighting and the exact band cut-points are **not derived from any cited standard**
— they read as reasonable engineering judgement (CO₂ weighted highest since it's the most
directly health-relevant and best-measured signal) but should be treated as a hypothesis to test
against pilot residents' own subjective comfort/health reports (the app already has a `feedback`
table that could be cross-referenced against Health Score during the pilot).

`healthLabel`: ≥85 "Uitstekend", ≥65 "Goed", ≥40 "Matig", else "Slecht" — again, round-number
judgement calls, not calibrated against anything external yet.

---

## 4. Mould risk — four implementations (the key open decision)

### 4.1 `mouldRisk(temp, rh, wallDelta=3.5)` — dashboard KPI
```
margin = (temp − wallDelta) − dewpoint(temp, rh)
risk = clip((5 − margin)/8 · 100, 0, 100)
```
Wall is assumed to sit a **fixed 3.5°C colder** than indoor air, regardless of season, time of
day, insulation, or actual outdoor temperature. This is the simplest and least physically-aware
of the four models. Used for the dashboard's always-visible mould KPI tile.

### 4.2 `mouldRiskScenario(indoorTemp, indoorRh, outdoorTemp)` — what-if calculator
Uses the *real* `wallTemp()` (linear approximation, `indoorTemp − (indoorTemp−outdoorTemp)·0.35`
— note: **this 0.35 factor is a different, simpler stand-in for insulation than the ISO
6946/R_totaal approach in §2.4**, and does not vary by the device's actual insulation class).
Then:
```
if wallT < dewpoint + 3:  risk = min(85, 60 + (dewpoint + 3 − wallT)·8)
else:                     risk = max(5, (indoorRh − 42)·1.2)
```
A step-function shape (jumps to a 60–85 band once the wall gets within 3°C of dewpoint) rather
than the smooth margin curve in §4.1. Used only in the scenario/what-if simulator.

### 4.3 `mouldRiskWd(temp, rh, wallDelta)` with diurnal `wallDelta(hours)` — trends/report
```
wallDelta(hours) = 3.5 − 2.5·sin((hours−14)·π/12)
```
i.e. the wall is modelled as coldest around 2am and warmest mid-afternoon, oscillating between
1.0°C and 6.0°C colder than indoor air over the day — a middle ground between §4.1's fixed offset
and the full ISO 6946 model. Used for the health timeline, monthly stats, period comparisons, and
— importantly — **the `/report` page's legal/evidentiary diagnosis** (§6).

### 4.4 VTT Mould Index + WUFI-Bio — Schimmelrisico page
`lib/mouldModels.ts`, fed by the ISO 6946 wall-surface conditions from §2.4 (not a heuristic
offset at all). Two independently-published models:

**VTT Mould Index** (Hukka & Viitanen 1999; Ojanen et al. 2010; VTT Technical Research Centre of
Finland) — simulates biological mould growth on a 0–6 scale with memory (growth accumulates,
decays slowly when conditions improve):
```
RH_crit(T) = max(80, −0.00267·T³ + 0.16·T² − 3.13·T + 100)
k1 = 1 if 0≤T≤50 and RH≥RH_crit, else 0
A = 0.3·(RH − RH_crit)/(100 − RH_crit)
dM/dt = k1·k2·[1/(7·e^A + 1) − (M·0.5/6)] · dt_hours,  clipped to [0,6]
```
`k2` is a material-class multiplier the user can pick on the Schimmelrisico page: wood 2.0,
gypsum 1.0 (default), concrete 0.5, treated/painted 0.2.

**WUFI-Bio** (Fraunhofer IBP) — water-activity-based growth potential, 0–100 "SER" scale:
```
aw = RH/100,  aw_crit(T) = max(0.70, 0.80 − 0.0007·T)
if aw ≥ aw_crit and 0≤T≤40:  GP += (aw − aw_crit)·dt
else:                         GP = max(0, GP − 0.05·dt)
SER = min(100, GP/50·100)
```

**Combined "WoonScore"**: `0.6·(MI/6·100) + 0.4·SER` — the 60/40 weighting between the two models
is, again, a judgement call with no cited derivation; it seems chosen to let the (slower-moving,
memory-based) VTT index dominate while WUFI-Bio's faster water-activity response contributes the
rest.

**This is the most rigorous of the four models** — it's the only one built on two independently
published, peer-reviewed building-physics models rather than an ad hoc formula, and the only one
that actually accounts for a specific home's insulation class and real outdoor-temperature
history. It's also the only one presented with an in-app explanation panel (`Explanation()` in
`app/schimmelrisico/page.tsx`) showing users the formulas and citing sources — a good pattern,
currently only applied to this one page.

### 4.5 Open decision for the pilot
Right now a user could see a "20/100" mould-risk tile on the dashboard and a "65/100 — hoog
risico" WoonScore on the Schimmelrisico page *at the same moment*, because they're different
models measuring different things (indoor-air heuristic vs. wall-surface physics). That's not
necessarily wrong — a quick KPI tile and a rigorous diagnostic page can reasonably use different
fidelity — but it needs to be an *explicit, documented* decision, not an accident of incremental
development. Recommended options to resolve during/after the pilot:
1. Keep both, but label the dashboard tile clearly as "quick estimate" and link it to the
   Schimmelrisico page for the rigorous number (cheapest fix).
2. Replace §4.1/§4.3 with a cheap call into the same wall-surface + VTT/WUFI pipeline everywhere,
   now that `calcWallConditions` + per-device insulation exist — the original heuristics predate
   that infrastructure (see the "Fix 1" comment in `lib/calculations.ts`, which explicitly says
   the VTT/WUFI models were being fed indoor-air RH before this wall-surface conversion existed).
3. Use the pilot data to check whether §4.1/§4.3's heuristic outputs and §4.4's model outputs
   actually correlate well in practice — if they track each other closely, the simpler formula is
   fine for cheap KPIs; if they diverge often, that's a sign the dashboard tile is actively
   misleading and should be replaced.

---

## 5. Scenario simulator (what-if calculator)
`lib/calculations.ts::scenarioOutputs` — lets a user adjust ventilation rate (ACH), occupants,
outdoor conditions, heating, and window-opening habit, and see projected indoor conditions:
```
indoorTemp = 20.5 if heating else max(outdoorTemp + 2.0, 14.0)
effACH = max(ach + habitBonus, 0.1)         habitBonus: never=0, occasional=0.15, daily=0.45
co2Night = 420 + (18/effACH)·occupants·1.2
co2Day   = 420 + (18/effACH)·0.5
indoorRH = min(rhFromAbs(indoorTemp, absHumidity(outdoorTemp, outdoorRH)) + loadPct, 99)
  loadPct = 8 if effACH < 0.7 else 3
```
The `18` constant is a per-occupant CO₂ generation proxy (not derived from a cited metabolic CO₂
production rate — worth checking against a standard figure, e.g. ASHRAE's ~0.005 L/s per person,
if this simulator is going to be used to make real ventilation recommendations). The `+2.0°C`/
`14.0°C` floor for unheated rooms and the `8%`/`3%` humidity load bump are similarly round-number
placeholders rather than measured/cited constants.

---

## 6. Report diagnosis (`/report` page) — the highest-stakes calculation in the app
`lib/reportAnalytics.ts` produces a "diagnosis" with real Dutch-language legal framing —
including the literal conclusion string **"Bouwkundig gebrek — verhuurder verantwoordelijk"**
("Structural defect — landlord responsible"). Given `lib/coverage.ts`'s own comments frame this
whole report as designed to have *evidentiary value* in a landlord dispute, this is the part of
the app where an unvalidated number could most directly affect someone's real housing situation —
worth being explicit about exactly what triggers that conclusion.

- **Humidity coefficient-of-variation (CV) classification** (`cvRh`): classifies the *pattern* of
  humidity, not just its level —
  - `CV < 0.05` and mean RH `> 70%` → **"LEKKAGE"** (leak) — humidity is high *and* barely
    fluctuates, which reads as a constant moisture source rather than activity-driven.
  - `CV > 0.08` and mean RH `< 65%` → **"GEDRAG"** (behaviour) — humidity spikes (cooking/showers)
    without a chronically high baseline.
  - mean RH `> 65%` (otherwise) → **"BOUWKUNDIG"** (structural) — chronically high without either
    of the above patterns.
  - else → **"NORMAAL"**.
  - The `0.05`/`0.08`/`65%`/`70%` cut-points are the entire basis for distinguishing "your
    landlord is responsible" from "this is your own ventilation habits" in the generated report.
    **These four numbers have not been validated against any known-leak vs. known-behavioural
    case** — this is exactly the kind of claim the pilot's 10 real homes could actually test, if
    any of them have a documented/suspected leak or a building inspector's assessment to compare
    against.
- **Night-vs-day CO₂ ratio** (`nachtCo2`): flags a problem when average night CO₂ `> 1500 ppm`
  *and* night/day ratio `> 1.3`.
- **Long-term trend** (`langetermijntrend`): a real OLS linear regression with a proper two-sided
  Student-t p-value (the file implements the regularised incomplete beta function from scratch to
  match `scipy.stats.linregress` rather than approximating it) — this part is standard, correct
  statistics, not a heuristic. Flags CO₂ trend if `p < 0.1` and total rise `> 120 ppm` over the
  period; RH trend if `p < 0.1` and rise `> 4%`.
- **Ventilation rate (ACH) from CO₂ decay** (`berekenAch`): detects a CO₂ peak above 1200 ppm
  followed by a sustained decay, fits `ln(CO₂ − 450) = a − t/τ` by log-linear regression, and
  reports `ACH = 60/τ`. Compared against **Bouwbesluit's 0.9 ACH legal minimum** — this is a real
  cited Dutch building-code threshold, not an invented one, which makes it the most defensible
  number in this file. When no clean decay event is found in the data, it falls back to a rough
  concentration-based estimate (`τ ≈ clip(60·CO2mean/800, 20, 200)`) explicitly labelled
  `"schatting (geen decay-events gevonden)"` in the output — good practice (it doesn't hide that
  it fell back to a guess), worth preserving in any rewrite.
- **Overall diagnosis conclusion**: red ("structural defect, landlord responsible") if the leak
  pattern *or* mould-risk-over-60 occurs `>30%` of the time; amber ("attention/behaviour") for the
  other flagged patterns; green ("no structural problem") otherwise, downgraded to amber ("let op")
  if anything was flagged at all so the headline never contradicts the findings list.

**Recommendation for the pilot**: given the legal framing, it would be worth having a building
physics/legal-adjacent professional sanity-check these specific thresholds (CV 0.05/0.08, RH
65%/70%, mould->60% for 30%-of-time) against a small number of real cases before residents rely on
this report in an actual dispute. This is flagged here, not fixed, because it's a domain-expertise
question, not a coding one.

---

## 7. Night CO₂ outlook (`lib/nightForecast.ts`)
Deliberately **not** model-based — it learns the resident's *own* recent overnight pattern
(median peak and median rise across nights with ≥4 night-time readings) and projects tonight's
peak from either a live evening reading (if one exists within the last 2 hours during 19:00–02:00)
or the historical median. Thresholds: `≥1500 ppm` → "critical" (ventilate now), `≥1000 ppm` →
"warning" (ventilate before bed), else "ok". This is a reasonable, low-risk design — it makes no
claims beyond "your own house has historically done X," which sidesteps most of the validation
concerns above. Needs at least 24 readings and 2 full nights of history before it activates.

---

## 8. Alert thresholds (`app/api/notifications/check/route.ts`)
Defaults (overridable per-user via the `thresholds` table): **CO₂** warning 1000 ppm / critical
1500 ppm; **humidity** warning 65% / critical 75%. Rate-limited to one alert per `{user, metric,
severity}` combination per 2 hours.

**Two things worth flagging for the multi-device pilot specifically** (not calculation-methodology
issues, but they live in this same code path):
- The check reads the single most recent `air_quality` row for the user with **no `device_id`
  filter** — if an account has multiple devices (per our earlier discussion, this is the intended
  model for the pilot), an alert check is really only ever looking at whichever device happened to
  report most recently, silently ignoring the others. This needs to become per-device before the
  pilot, or one loud device will mask a quiet problem on another.
- Thresholds are stored per-`user_id`, not per-`device_id` — one set of CO₂/RH thresholds applies
  to every device on the account, even if e.g. a bedroom and a living room reasonably warrant
  different comfort targets.

The AI chat assistant (`lib/chatTools.ts`) hardcodes its own copy of similar-but-not-identical
thresholds (CO₂ 800/1000, RH 40–60 ideal / 60–70 elevated) for conversational framing — worth
reconciling with the alert-system numbers above so the chat and the alerts don't describe the same
reading differently.

---

## 9. ML forecasting (`lib/ml/`)
A from-scratch (no external ML library) **Ridge regression** predicting CO₂ and RH ~1 hour ahead:
```
features: CO₂ lags (1h/3h/6h), RH lag (1h), 24h rolling mean+std of CO₂,
          cyclic hour/day-of-week/month encodings (sin+cos), 
          outdoor temp/RH/wind, window-open flag, occupant count (0 when unknown)
w = (XᵀX + λI)⁻¹Xᵀy,  λ = 0.01, intercept unregularised, z-scored inputs/targets
holdout: last 20% chronologically, reports MAE/RMSE
confidence: soft function of sample count — capped at 0.5 below 200 samples, →0.95 near 5000
```
Trained per-user (one model, `ml_models` table keyed by `user_id`) via a manual "Hertrainen"
button today — no automated retrain schedule exists yet (noted in `lib/ml/README.md` and in
[ROADMAP.md](ROADMAP.md) Milestone 3). For the pilot's multi-device model, this needs the same
per-device (not per-user) reconsideration as the alert thresholds above, since one Ridge model
trained on a blend of two different rooms' dynamics would learn a confused average of both.

---

## 10. Summary: decisions to make or validate during the pilot

1. **Resolve or explicitly document the four mould-risk models** (§4.5) — pick one path rather
   than letting the discrepancy be accidental.
2. **Validate the four wall-insulation R-values** (§2.4) against at least a few pilot homes' real
   construction — and make sure device onboarding actually sets `insulation` correctly instead of
   silently defaulting to the conservative `'poor'`.
3. **Sanity-check the report's legal-conclusion thresholds** (§6: CV 0.05/0.08, RH 65%/70%,
   mould>60% for >30% of time) against any pilot home with an independently known moisture
   problem or building inspection.
4. **Make alerting and ML training device-scoped, not just user-scoped** (§8, §9) — currently
   both silently assume one device per account.
5. **Unify the three saturation-vapour-pressure implementations** (§2.2) — low priority, no known
   correctness impact, but a maintenance hazard.
6. **Cross-check the Health Score weighting (0.4/0.3/0.3) and band cut-points** (§3) against
   residents' own subjective comfort feedback, which the app already collects via the `feedback`
   table.
7. **Verify the scenario simulator's CO₂-per-occupant constant** (§5, the `18` in
   `co2Night/co2Day`) against a cited metabolic CO₂ generation rate if the simulator's numeric
   *outputs* (not just its relative comparisons) are going to be relied on.

None of the above are "bugs" in the sense of the code not matching its own stated formula — the
port from the Flask app looks faithful everywhere it was checked. They are, instead, exactly the
kind of real-world calibration questions that only 10 real homes' worth of data — and, ideally,
a little outside expertise on the legal/building-physics claims in §6 — can actually answer.
