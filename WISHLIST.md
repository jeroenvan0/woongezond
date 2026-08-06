# Woongezond — Wishlist (not yet scheduled)

Ideas captured for later. Nothing here is committed to a milestone yet. See
[ROADMAP.md](ROADMAP.md) for the sequenced plan and [CALCULATIONS.md](CALCULATIONS.md)
for the model methodology.

---

## 1. Woningcorporatie portal (portfolio view)

**Requested 2026-08-04.** The paying customer is a woningcorporatie (housing association),
not the individual resident. They need a view of their *whole portfolio*, not one dwelling.

### What it needs to do

- **Corporation login** — an account that sees every device belonging to that corporation,
  across a city and eventually nationwide.
- **Map visual** — devices plotted geographically, coloured by current risk (WoonScore band:
  <30 low / 30–60 elevated / >60 high). This is the headline view: "where in my portfolio is
  the risk right now."
- **Portfolio summaries** — aggregate roll-ups so a portfolio manager can review at a glance:
  how many dwellings in each risk band, trend direction over the heating season, worst-N
  dwellings, which complexes/postcodes cluster badly.
- **Current state + trends per dwelling** — drill down from the map/summary into the
  individual dwelling's current readings and its trajectory.
- **Device return/rotation tracking** — which devices are due to come back, when, and from
  where. This falls straight out of the rental business model (sensor stays Woongezond
  property, follows the tenant-mutation cycle for roughly the first ~3 critical months),
  so the portal must answer "what's deployed, what's coming back, what's available to
  redeploy."

### Why this is a bigger change than it looks

Three structural gaps between this and what exists today — worth knowing before scoping:

1. **There is no "corporation" concept in the data model at all.** Today the hierarchy is
   flat: `auth.users` → `devices` → `air_quality`, with RLS scoped to `auth.uid() = user_id`.
   A portfolio view needs an organisation layer above the user (corporation → dwellings →
   devices → readings), plus RLS that lets a corporation user see every dwelling they own
   without seeing other corporations'. That's a genuine multi-tenancy redesign, not a new page.
   (Note: a `create_organizations` migration exists in the DB history from the *previous* quiz
   app that shared this project — it's long dropped, so there's nothing to reuse, but the name
   showing up in `list_migrations` is a red herring worth not chasing.)

2. **Device rotation breaks the current reading↔dwelling link.** `air_quality` rows carry
   `device_id` and `user_id`, but nothing records *which dwelling a device was in at the time*.
   Move a sensor from house A to house B after three months and its history silently merges two
   different buildings. For a portfolio product — and for the evidentiary value the report
   claims — readings need to bind to a **deployment period** (device + dwelling + start/end),
   not just to a device. This is the single most important schema change the rental model
   implies, and it is cheaper to introduce before 10 devices start moving around than after.

3. **Roles exist but are unused.** `profiles.role` already has a
   `CHECK (role IN ('admin','user','viewer'))` constraint and is not read anywhere in the app.
   A corporation portal is the natural consumer of that column (`viewer` for a portfolio
   manager who shouldn't mutate anything). Worth building on rather than inventing a parallel
   mechanism.

### Open questions for later

- Does a corporation user see **raw resident data** (CO₂ curves imply occupancy patterns:
  when someone is home, asleep, showering) or only **aggregated risk scores**? This is a
  privacy/AVG question with a DPIA attached, not just a UI choice — the Marco doc already
  flags a verwerkersovereenkomst + DPIA as prerequisites before the first paying customer.
  Aggregate-only for the landlord, detail-only for the resident, is the defensible default.
- Map at what zoom — per-dwelling pins reveal exactly which homes have a problem, which is
  sensitive if a corporation employee can browse it casually. Postcode-level clustering until
  drill-down may be the safer default.
- Nationwide implies many cities; today `city_weather` is ingested per distinct city with an
  active device, which already scales that way (cost is O(cities), not O(devices)) — good.

---

## 2. QR-code self-install for devices

Already noted in [ROADMAP.md](ROADMAP.md) Milestone 2 as a post-pilot follow-on. Repeated here
so the wishlist is complete: a resident scans a QR code and the device provisions itself into
the right account, with no manual flashing per household. Milestone 2's per-device credential
design is being built to allow an "unclaimed until scanned" state so this doesn't need reworking.

---

## 3. Two things found in the product doc that need your decision

Not features — these are inconsistencies between the business framing and the current code.
Recording them here so they don't get lost.

### 3a. The report contradicts the stated legal positioning

The overview document is explicit and deliberate:

> *"Bewuste woordkeuze — 'risico-monitoring', geen 'diagnose'. ... het woord 'diagnose' zou een
> zorgplicht en aansprakelijkheid creëren. We leveren objectieve risicosignalering en documentatie."*

But `lib/reportAnalytics.ts` contains a function literally named `buildDiagnosis()` whose output
includes the conclusion string **"Bouwkundig gebrek — verhuurder verantwoordelijk"** ("structural
defect — landlord responsible"), derived from unvalidated heuristic thresholds (see
[CALCULATIONS.md](CALCULATIONS.md) §6). That is a diagnosis assigning legal liability — precisely
the thing the positioning says the product does not do.

There's a second wrinkle: that conclusion is written *for the tenant, against the landlord*,
while the landlord is the paying customer. The app's report reads as built for a resident in a
dispute; the business sells portfolio risk-monitoring to the corporation. Both products can
exist, but they can't share one un-flagged report screen.

**Decision needed (yours, not mine):** soften the report's language to risk-signalling, gate it
behind a tenant-facing context, or keep it and accept the liability position deliberately.

### 3b. Pilot success criteria have no instrumentation behind them

The doc sets measurable pilot criteria: **≥8/10 devices continuously online** and **≥90% of
measurements received**. Nothing in the system currently measures either. There is no uptime
tracking, no per-device "last seen", and no alert when a device goes quiet.

This is not theoretical: **the single live sensor stopped reporting on 2026-08-03 at 11:12 and
nobody noticed** — found incidentally during the Milestone 1 audit, over a day later. With one
device that's an annoyance; with ten devices across ten households over a full heating season,
silent dropout is how the pilot fails its own success criteria without anyone realising until
the data is analysed in April.

Milestone 3 already covers server-side alerting and a `/api/health` endpoint. Worth explicitly
adding **per-device liveness monitoring and a coverage metric** to that milestone, since the
pilot is contractually judged on exactly those two numbers.
