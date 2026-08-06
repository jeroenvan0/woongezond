# UI/UX study and improvement plan

**Proposal, 2026-08-05.** Branch `ui-improvements`, cut from `milestone-1-foundation`
at `c4b4bb8`. Nothing in Parts 2–4 is implemented yet — this document is the
specification to implement from.

Scope: `/dashboard`, `/trends`, `/schimmelrisico`, `/scenarios`, `/report`, `/login`,
the app shell and all shared components — evaluated on truthfulness, information
architecture, visual system, accessibility, responsive behaviour, feedback,
performance, language, and functional completeness.

Method: full read of `app/`, `components/`, `app/globals.css`; measured WCAG contrast
ratios; counted style/token drift; traced every data fetch. Findings already tracked
elsewhere keep their existing ID (KI-n) rather than being renamed.

| Part | |
|---|---|
| [Part 0](#part-0--working-method) | Branch, commits, verification gates |
| [Part 1](#part-1--findings) | What is wrong today, with evidence |
| [Part 2](#part-2--the-woongezond-colour-system) | The new colour system, drop-in ready |
| [Part 3](#part-3--the-plan-step-by-step) | Step-by-step plan, each step acceptable on its own |
| [Part 4](#part-4--decisions-i-need-from-you) | Decisions needed before starting |

---

## Part 0 — Working method

### Step 0.A — The branch (done)

```bash
git checkout milestone-1-foundation
git checkout -b ui-improvements          # ✅ created 2026-08-05 at c4b4bb8
```

All work in Parts 2–3 happens on `ui-improvements`. It branches from
`milestone-1-foundation`, not `main`, so the M1/M3/M4 work already landed there is the
baseline — otherwise the CSP, rate limiting and the KI-1/KI-2 fixes would have to be
re-merged.

### Step 0.B — Commit convention

One commit per numbered step in Part 3, so any single step can be reverted without
unpicking the others. Message format matches the existing history:

```
UI 1.1: freshness contract on the KPI cards

<what changed, and the measurement that proves it>
```

### Step 0.C — Gate every phase before moving on

Non-negotiable, because this branch touches every screen:

```bash
npm test && npm run typecheck && npm run build
node scripts/ui-baseline.mjs --compare      # built in step 0.1
```

A phase is done when its acceptance criteria in Part 3 are **measured**, not inspected.
That is the lesson of KI-2: the off-screen panel had been looked at many times; it was
only fixed once someone measured that 263px of it was off the left edge.

### Step 0.D — Merge strategy

Phases 0–5 are internal quality work with no schema and no API change, so they can merge
back to `milestone-1-foundation` as one PR per phase. Phase 6 items each need their own
PR — they change behaviour, not just presentation.

**Do not deploy mid-phase.** Remember `systemctl restart woongezond-react` after any
build that reaches the VPS (port 3001).

---

## Part 1 — Findings

Severity uses the same scale as `known-issues.md`. **High** means: it can make the app
report something untrue, or it blocks a pilot household from using a feature.

### A. Truthfulness of what is displayed

This gets its own section because KI-1 established that this is the one class of defect
this product cannot afford — `lib/coverage.ts`, the complaint letter and
`CALCULATIONS.md` all position the output as evidence — and the same class is still
present in four other places.

| # | Finding | Severity |
|---|---|---|
| **A1** | **No freshness on any reported value.** The KPI cards come from a single-row query with no age check ([dashboard/page.tsx:136-154](../app/dashboard/page.tsx#L136-L154)). During the 56-hour outage of 2026-08-03 → 08-05 the dashboard would have shown that stale reading as the current CO₂, with a green *"Goed"* label, while the footer said *"bijgewerkt elke 60s"*. No timestamp is rendered anywhere near the values. KI-3's blind spot is exactly the screen a resident would have looked at. | **High** |
| **A2** | **Demo data is rendered in the same visual language as measurement.** Under two readings, `generateDemoData(28)` drives the 64px hero WoonScore ([schimmelrisico/page.tsx:284-294](../app/schimmelrisico/page.tsx#L284-L294)), disclaimed only by a small chip below it. A new household sees a fabricated risk score in the largest type on the page. | **High** |
| **A3** | **"meetpunten" understates reality by up to 360×** — KI-1's open tail (`rawCount` is the bucketed count). A database fix, but a UI-visible falsehood, so it stays on this list. | Medium |
| **A4** | **Three different 0–100 scores, never reconciled.** Dashboard *Gezondheid* (`healthScore`), Trends *Huidige score* (daily timeline), Schimmel *WoonScore* (`0.6·MI + 0.4·SER`) — and the third runs in the **opposite direction** (higher = worse). A resident cannot tell whether 72 is good news. | Medium |
| **A5** | **Failures are invisible.** Every fetch error is a `console.error` or a swallowed `.catch(() => {})`. The screen keeps showing previous data as if nothing happened. With rate limiting now live, a 429 renders as "nothing changed". | Medium |

### B. Information architecture

- **B1** The dashboard is one undifferentiated scroll of nine blocks. Four of them
  (ventilation advisor, night outlook, ML prediction, diagnosis) are *advice*, rendered
  at near-identical visual weight with no ranking between them. Nothing separates *what
  is happening now* from *what to do* from *what we predict*.
- **B2** `DiagnoseCard` re-runs the report's `buildDiagnosis` engine and links to the
  report with a raw `<a href>` ([dashboard/page.tsx:439](../app/dashboard/page.tsx#L439))
  — a full page reload instead of `next/link`.
- **B3** `/report` renders outside `AppShell`, with its own hard-coded light palette
  (`#F1F5F9` root, `#fff` sheet, `#0F172A` text). In dark mode it is a white slab with
  no sidebar. It reads as a different product.
- **B4** Four implementations of one concept — period selection: a `<select>` with 7
  options (dashboard), pills with 3 (trends), pills with 4 (schimmel), a `<select>` with
  4 (report). Different controls, different ranges, no shared state.
- **B5** The chat FAB is on four pages and always opens context-free.

### C. Visual design system

| Metric | Count |
|---|---|
| Inline `style={{…}}` objects | **412** |
| Distinct `fontSize` values | **18** (8.5 → 26) |
| Distinct `borderRadius` values | **13** (2 → 20, plus 99) |
| `#3B82F6` written literally | **43×** |
| Status colours literal (`#16A34A`/`#D97706`/`#DC2626`) | 20 / 20 / 24× |

- **C1** The token layer covers colour only — no spacing, radius or type scale. Cards are
  16px radius in `MetricCard`, 14 in `ChartCard`, 12 elsewhere, 20 on login.
- **C2** Icon language is split: `lucide-react` in the nav and some cards, raw emoji
  everywhere else (🔔 💬 🔮 ⚙ ✚ 🕘 ✕ ⬇ ✨ 📍). Emoji render per-platform, can't inherit
  `currentColor`, can't stroke-match the lucide set beside them.
- **C3** **`SensorChart` gridlines are invisible in dark mode** —
  `stroke="rgba(0,0,0,0.05)"` ([SensorChart.tsx:49](../components/SensorChart.tsx#L49)),
  while the other four charts use `rgba(128,128,128,…)`. The three main dashboard charts
  are the ones that lose their grid.
- **C4** **Two dependencies are installed and never used.** No Tailwind utility class
  appears anywhere (the only `className`s are the project's own `wz-*`/`wx-*`), and
  `globals.css` still opens with v3-era `@tailwind` directives under Tailwind 4. `swr`
  has zero imports. Needs decision **D-1**.

### D. Accessibility

- **D1** **There is no focus style in the codebase.** No `:focus-visible` rule exists,
  and inline-styled buttons don't get one for free. A keyboard user cannot see where
  they are on any page.
- **D2** **Measured contrast failures** (AA needs 4.5:1 under 18px):

  | Colour | On | Ratio | |
  |---|---|---|---|
  | `--subtle` `#94A3B8` | white | **2.56:1** | fails |
  | `--subtle` `#4A5568` (dark) | `#1C2130` | **2.13:1** | fails badly |
  | `#16A34A` "Goed" | white | **3.30:1** | fails |
  | `#D97706` "Verhoogd" | white | **3.19:1** | fails |
  | `#3B82F6` | white | **3.68:1** | fails |
  | `#DC2626` "Kritiek" | white | 4.83:1 | passes |
  | `--muted` `#475569` | white | 7.58:1 | passes |

  The status colours are the semantic core of the product — the *Goed / Verhoogd /
  Kritiek* labels on every KPI card, at 11.5px.
- **D3** Non-semantic controls: dashboard tabs are plain buttons with no
  `role="tablist"`/`aria-selected`; notification rows are `<div onClick>` and
  unreachable by keyboard; heatmap cells are `<div>`s with only a `title`.
- **D4** No `aria-live` anywhere — KPI values, chat replies and every "Opgeslagen ✓"
  change silently for a screen reader.
- **D5** No skip link; five nav links precede content on every page.
- **D6** None of the nine charts has a text alternative.
- **D7** Login has no `autoComplete`, doesn't announce errors, and prints the raw
  English Supabase error string into a Dutch interface.
- **D8** The theme toggle is a one-way door out of "system".

### E. Responsive behaviour

- **E1** **The chat panel overflows narrow phones.** Fixed `width: 360` at `right: 24`
  needs 384px ([ChatWidget.tsx:164-178](../components/ChatWidget.tsx#L164-L178)). At
  360×640 — a viewport in your own KI-2 matrix — 24px hangs off the screen.
- **E2** The report's stat grid is `repeat(4,1fr)` at every width and its `Kv` rows use a
  fixed `minWidth: 220` label column. Trends and scenarios tables scroll horizontally
  with no affordance showing they can.
- **E3** Chart heights are fixed at 200/220px from 360px to 1440px+.
- **E4** The chat FAB at `bottom: 96px` sits above a 5-item tab bar, overlapping the last
  card on short screens.

### F. Interaction and feedback

- **F1** No skeletons. Values snap from `—` to numbers; `loading` gates only the KPI
  values, so cards and charts disagree during load.
- **F2** Deleting an intervention has no confirmation and no undo — a destructive action
  on the record the trends page treats as evidence.
- **F3** The notification panel can't delete or group, and **every open tab POSTs
  `/api/notifications/check` every 120 s** — the client-side contributor to KI-4's
  duplicate race and a steady drain on the new rate limiter.
- **F4** Saved scenarios live in React state only; a reload loses them, while every other
  filter persists via `useStickyState`. The cap of 5 silently drops the oldest.
- **F5** Sticky filters double-fetch on load (initial value, then hydration).

### G. Performance and the data layer

- **G1** **Seven independent `/api/data` callers.** The dashboard alone fires four on
  mount — selected period, 14 d (`NightOutlookCard`), 3 d (`MLPredictionCard`), 30 d
  (`ContinuityChip`) — plus a direct Supabase query, then polls two every 60 s forever,
  in every open tab. No cache, no dedupe, no visibility gating.
- **G2** Every page refetches its whole series on mount. Dashboard → Trends → Dashboard
  re-downloads everything.
- **G3** Inter loads from Google Fonts (KI-5) — external origin on the critical path, two
  extra CSP origins, and a font swap that shifts layout.

### H. Language and content

- **H1** Mixed Dutch/English in the chrome: **"Smoothing"** — the one control users have
  already misread — plus "Trends", "Dashboard".
- **H2** Unexplained jargon at point of use: ACH, MI, SER, k₂, "Vocht-profiel",
  "R = 0,90 m²K/W". The Schimmel page's good explanation is collapsed behind a toggle and
  exists only there.
- **H3** **No first-run design.** A household on day one sees five different negative
  messages on the dashboard alone — *"Geen data"*, *"Te weinig data voor diagnose"*,
  *"Nog te weinig nachten gemeten"*, *"Nog geen getraind model"*, *"Nog geen data
  beschikbaar voor heatmap"* — none saying what will appear, or when. This is the first
  impression for all 10 pilot households.

### I. Functional gaps (on the roadmap, restated as UX)

- **I1** No device identity anywhere in the UI; KPI cards silently show the newest
  reading from *any* device on the account (ROADMAP M4).
- **I2** No self-serve signup and no password reset — blocks onboarding 10 households.
- **I3** **M3 built `/api/health` with per-device liveness and no screen shows it.**
- **I4** No way to record ground truth ("visible mould here, this date").
  `CALCULATIONS.md` §10 needs it to validate the models; Interventions is the closest
  existing mechanism.

---

## Part 2 — The Woongezond colour system

### The idea

**Green is the brand.** *Woongezond* is a healthy home — green carries health, air and
growth, and it is what the housing-association customer expects from a wellbeing product.
Today's identity is blue-led (`#3B82F6`, written literally 43 times) with green as a
secondary; this inverts that.

Green alone goes cold and clinical, so the scheme pairs it with two counterweights:

- **A warm sand neutral** instead of the current cool blue-grey slate. This is what makes
  the app read as *home* rather than *hospital*, and it is the single change with the
  biggest perceived effect. Neutrals are 90% of the pixels on screen.
- **Indigo as the accent** — the complementary counterpoint to green (162° vs 245°, near
  the opposite side of the wheel), used for the analytical layer: CO₂, ML, secondary
  actions. It gives the data a voice distinct from the brand chrome.

### The problem this scheme has to solve first

If the brand is green and *"Goed"* is also green, the two collide — a user cannot tell
identity from status. The resolution is threefold and must be respected everywhere:

1. **Brand green is deeper and bluer** (162°) than status green (142°).
2. **Brand green never appears as a status.** It is chrome, nav, primary buttons and
   links only — never a KPI label, dot, or risk fill.
3. **Status is never colour-only.** Every status colour is paired with its word — *Goed
   / Verhoogd / Kritiek* — which `MetricCard` already does. This is also what makes the
   scheme safe for red-green colour blindness, where a green/red status ramp is otherwise
   the classic failure.

### Hue spacing (measured)

```
  26°  amber      warn + schimmel
 142°  green      status ok
 162°  green      BRAND
 193°  cyan       vochtigheid
 245°  indigo     ACCENT + CO₂
 272°  violet     dauwpunt
 345°  rose       temperatuur
```

Every pair is ≥20° apart, and only the brand/ok pair is that close — mitigated by rule 2
above.

### The tokens — drop-in replacement for `app/globals.css`

Every value below is **measured**, not estimated. Ratios are in the table that follows.

```css
:root {
  /* ── Brand — Woongezond green (162°) ───────────────────────────── */
  --brand-50:  #ECFDF6;   --brand-100: #D3F7E8;   --brand-200: #A7EDD3;
  --brand-300: #5FDCB4;   --brand-400: #2DD4A0;   --brand-500: #12B886;
  --brand-600: #0E9A73;   --brand-700: #0B7A5C;   --brand-800: #0A6249;
  --brand-900: #08402F;
  --brand:        var(--brand-700);   /* primary action / link  5.31:1 on white */
  --brand-hover:  var(--brand-600);
  --brand-fill:   var(--brand-50);    /* active nav, subtle tints */
  --brand-mark:   var(--brand-500);   /* logo, gradients          */

  /* ── Accent — indigo (245°), the analytical counterpoint ───────── */
  --accent:      #4338CA;             /* 7.90:1 on white */
  --accent-soft: #4F46E5;
  --accent-fill: #EEF0FE;

  /* ── Warm neutrals — sand + ink. 90% of the pixels. ────────────── */
  --bg:           #FBFAF7;
  --bg-tint:      #F4F2EC;
  --surface:      #FFFFFF;
  --surface-2:    #FAF9F5;
  --surface-tint: #F1EFE8;
  --border:      rgba(26,33,30,0.09);
  --border-soft: rgba(26,33,30,0.05);
  --text:   #1A211E;    /* 16.40:1 */
  --muted:  #4A5A53;    /*  7.30:1 */
  --subtle: #5C6B64;    /*  5.61:1 — replaces #94A3B8 at 2.56:1 */

  /* ── Status. Three roles each: text (AA), fill, dot/border. ────── */
  --ok:        #15803D;  --ok-dot:   #22C55E;  --ok-fill:   #15803D14;
  --warn:      #B45309;  --warn-dot: #F59E0B;  --warn-fill: #B4530914;
  --crit:      #B91C1C;  --crit-dot: #EF4444;  --crit-fill: #B91C1C14;

  /* ── Data series. Never reuse a status colour for a series. ────── */
  --c-co2:   #4338CA;   /* was #3B82F6 */
  --c-temp:  #BE123C;   /* was #EF4444 — collided with crit */
  --c-rh:    #0E7490;   /* was #10B981 — collided with the new brand */
  --c-mould: #B45309;
  --c-dew:   #7E22CE;
  --c-grid:  rgba(26,33,30,0.07);

  /* ── Elevation (unchanged in structure, re-tinted warm) ────────── */
  --shadow-xs: 0 1px 3px rgba(26,33,30,0.06), 0 1px 2px rgba(26,33,30,0.04);
  --shadow-sm: 0 2px 6px rgba(26,33,30,0.08), 0 1px 2px rgba(26,33,30,0.04);
  --shadow-md: 0 4px 16px rgba(26,33,30,0.10), 0 2px 4px rgba(26,33,30,0.06);
  --shadow-lg: 0 8px 32px rgba(26,33,30,0.12), 0 4px 8px rgba(26,33,30,0.06);
}

.dark {
  --brand:       var(--brand-400);    /* 8.31:1 on --surface */
  --brand-hover: var(--brand-300);
  --brand-fill:  rgba(18,184,134,0.13);
  --brand-mark:  var(--brand-400);

  --accent:      #818CF8;             /* 5.30:1 */
  --accent-soft: #A5B4FC;
  --accent-fill: rgba(129,140,248,0.13);

  /* Green-tinted charcoal, not blue slate — keeps the brand family. */
  --bg:           #111614;
  --bg-tint:      #151A18;
  --surface:      #1D2422;
  --surface-2:    #1A211F;
  --surface-tint: #242C29;
  --border:      rgba(232,237,234,0.09);
  --border-soft: rgba(232,237,234,0.05);
  --text:   #E8EDEA;    /* 13.36:1 */
  --muted:  #9FAEA7;    /*  6.84:1 */
  --subtle: #8B9A93;    /*  5.38:1 — replaces #4A5568 at 2.13:1 */

  --ok:   #4ADE80;  --ok-dot:   #22C55E;  --ok-fill:   rgba(74,222,128,0.13);
  --warn: #FBBF24;  --warn-dot: #F59E0B;  --warn-fill: rgba(251,191,36,0.13);
  --crit: #F87171;  --crit-dot: #EF4444;  --crit-fill: rgba(248,113,113,0.13);

  --c-co2:   #818CF8;
  --c-temp:  #FB7185;
  --c-rh:    #22D3EE;
  --c-mould: #FBBF24;
  --c-dew:   #C084FC;
  --c-grid:  rgba(232,237,234,0.08);

  --shadow-xs: 0 1px 3px rgba(0,0,0,0.30);
  --shadow-sm: 0 2px 6px rgba(0,0,0,0.35);
  --shadow-md: 0 4px 16px rgba(0,0,0,0.40);
  --shadow-lg: 0 8px 32px rgba(0,0,0,0.50);
}
```

### Measured contrast — every text token passes AA

| Token | Light on `#FFFFFF` | Dark on `#1D2422` |
|---|---|---|
| `--text` | 16.40 ✅ | 13.36 ✅ |
| `--muted` | 7.30 ✅ | 6.84 ✅ |
| `--subtle` | **5.61** ✅ *(was 2.56 ❌)* | **5.38** ✅ *(was 2.13 ❌)* |
| `--brand` | 5.31 ✅ | 8.31 ✅ |
| `--accent` | 7.90 ✅ | 5.30 ✅ |
| `--ok` | **5.02** ✅ *(was 3.30 ❌)* | 9.83 ✅ |
| `--warn` | **5.02** ✅ *(was 3.19 ❌)* | 10.26 ✅ |
| `--crit` | 6.47 ✅ | 6.19 ✅ |
| `--c-co2` | 7.90 ✅ | 5.30 ✅ |
| `--c-temp` | 6.29 ✅ | 5.88 ✅ |
| `--c-rh` | 5.36 ✅ | 8.75 ✅ |
| `--c-mould` | 5.02 ✅ | 9.47 ✅ |
| `--c-dew` | 6.98 ✅ | 5.99 ✅ |

Every D2 failure is closed by adopting this file. The `-dot` and `-fill` variants keep
today's brighter hues, which is correct — WCAG text rules do not apply to a 7px dot or a
7%-opacity background wash, and the brighter hue reads better at that size.

### Breaking changes this implies

Call these out in the commit; they are deliberate, not drift.

| Change | Why |
|---|---|
| Vochtigheid green `#10B981` → cyan `#0E7490` | Would otherwise collide with the new brand green |
| CO₂ blue `#3B82F6` → indigo `#4338CA` | Blue was the old brand; indigo is the new accent |
| Temperatuur `#EF4444` → rose `#BE123C` | `#EF4444` collided with critical red, and failed AA |
| Logo gradient blue→green becomes green→teal | [Logo.tsx](../components/Logo.tsx) `#3B82F6`→`#10B981` becomes `--brand-500`→`--brand-700` |

### The rest of the design system (no colour)

`globals.css` today has no spacing, radius or type scale — which is why there are 18 font
sizes and 13 radii. Add alongside the colours:

```css
:root {
  /* Type scale — 6 steps replace 18 ad-hoc sizes */
  --fs-2xs: 10.5px;  --fs-xs: 11.5px;  --fs-sm: 12.5px;
  --fs-md:  13.5px;  --fs-lg: 16px;    --fs-xl: 21px;   --fs-hero: clamp(44px,8vw,64px);
  /* Spacing — 4px base */
  --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px;  --sp-4: 16px;
  --sp-5: 20px; --sp-6: 24px; --sp-8: 32px;
  /* Radius — 3 steps + pill */
  --r-sm: 8px;  --r-md: 12px;  --r-lg: 16px;  --r-pill: 99px;
  /* Focus — D1 */
  --focus: 0 0 0 2px var(--surface), 0 0 0 4px var(--brand);
}
```

---

## Part 3 — The plan, step by step

Sizes: **S** ≈ half a day · **M** ≈ 1–2 days · **L** ≈ 3+ days.
Phases 1 and 2 are independent and may be swapped. Everything after depends on Phase 2.

### Phase 0 — Baseline, so this is measurable (S)

| Step | What | Acceptance |
|---|---|---|
| 0.1 | `scripts/ui-baseline.mjs` — Puppeteer (headless, `--no-sandbox`), signed in, capturing 6 routes × {light, dark} × {1440×900, 768×1024, 390×844, 360×640} = 48 shots into `docs/ui-baseline/`. A `--compare` flag diffs against the committed set. | 48 shots committed |
| 0.2 | axe-core pass per route, JSON output committed as the numeric before/after record. | Baseline violation count recorded per route |

Without this, every claim below is opinion.

### Phase 1 — Truthfulness (M) · *closes A1–A5, I3*

| Step | What | Files | Acceptance |
|---|---|---|---|
| 1.1 | **Freshness contract.** Timestamp under the KPI grid (*"gemeten 14:32 · 2 min geleden"*); staleness states at >15 min / >2 h / >24 h that desaturate the cards, replace the status label and state *"Sensor offline sinds …"*. Driven by **the same rule as the `device_offline` alert** so screen and alert can never disagree. | `dashboard/page.tsx`, `MetricCard.tsx`, new `lib/freshness.ts` | Unit tests over the age→state rule; a stale reading never renders a green status |
| 1.2 | **Surface `/api/health`** as a device-liveness chip in the sidebar footer — amber/red when a device is quiet. The screen KI-3 says didn't exist. | `AppShell.tsx`, new `DeviceHealthChip.tsx` | Chip reflects `/api/health` within one poll |
| 1.3 | **Demo data stops looking like measurement.** No demo WoonScore in the hero; an explicit *voorbeeldweergave* state, charts visibly marked synthetic, hero replaced by *"nog geen eigen meting — dit verschijnt na …"*. | `schimmelrisico/page.tsx` | No synthetic number renders in hero type |
| 1.4 | **Errors become visible.** Non-blocking banner for failed/rate-limited fetches with retry; stale data marked stale rather than shown as current. | new `components/DataBanner.tsx`, all 5 pages | A forced 429 and a forced 500 both surface |
| 1.5 | **Reconcile the three scores.** Info popover on each explaining what it measures and its direction; relabel WoonScore on screen as a risk score (*"hoger = meer risico"*). | `dashboard`, `trends`, `schimmelrisico` | Each score states its direction on screen |

### Phase 2 — Design system (M) · *closes C1–C3, D2*

| Step | What | Files | Acceptance |
|---|---|---|---|
| 2.1 | **Decision D-1 first.** Then either adopt Tailwind properly or remove `tailwindcss`, `@tailwindcss/postcss`, `swr` and the dead `@tailwind` directives. | `package.json`, `postcss.config.mjs`, `globals.css` | `npm run build` clean; no unused deps |
| 2.2 | **Land the Part 2 token file** — colour, type, spacing, radius, focus. | `app/globals.css` | Both themes render; visual diff reviewed against the 0.1 baseline |
| 2.3 | **Migrate the literals to tokens** — 43× `#3B82F6`, 64× status colours, 18 font sizes → 6, 13 radii → 3. Mechanical, one page per commit. | all of `app/`, `components/` | `grep -rE '#[0-9A-Fa-f]{6}' app components` returns only `globals.css` and `Logo.tsx` |
| 2.4 | **Extract five primitives** from the 412 inline objects: `Card`, `SectionHeading`, `Stat`, `SegmentedControl`, `Button`. Four are already duplicated 3–4× — consolidation, not new abstraction. Fixes **B4** (one period control everywhere). | new `components/ui/*` | Inline style objects down by ≥60% |
| 2.5 | **Unify iconography** on lucide (retire all 10 emoji); unify chart gridlines on `--c-grid`, fixing the dark-mode grid in `SensorChart` (**C3**). | `ChatWidget`, `NotificationBell`, `MLPredictionCard`, `report`, all 5 charts | No emoji used as an icon; gridlines visible in both themes |

### Phase 3 — Accessibility to WCAG AA (M) · *closes D1, D3–D8*

| Step | What | Acceptance |
|---|---|---|
| 3.1 | Global `:focus-visible` using `--focus`, applied through the Phase-2 primitives. | Every interactive element shows a ring on keyboard focus |
| 3.2 | Real semantics: tabs → `role="tablist"`; notification rows → `<button>`; heatmap → accessible grid with per-cell labels; `<nav aria-label>`; skip link. | Full keyboard traverse of every page |
| 3.3 | `aria-live="polite"` on the KPI region, chat transcript and save confirmations. | Announced in VoiceOver |
| 3.4 | **"Toon als tabel"** under each chart — a real text alternative that doubles as an inspection tool for the evidentiary use case. | All 9 charts |
| 3.5 | Login: `autoComplete`, Dutch error messages, announced errors. | No raw English error strings |
| 3.6 | Three-way theme control (systeem / licht / donker). | "systeem" reachable after toggling |

**Exit criterion: axe-core reports 0 serious/critical on all six routes**, measured
against the 0.2 baseline.

### Phase 4 — Responsive (S–M) · *closes E1–E4, B3*

| Step | What | Acceptance |
|---|---|---|
| 4.1 | Chat panel → `width: min(360px, calc(100vw - 32px))`, full-height sheet under 640px, FAB clear of the tab bar. | Zero clipping at 360×640 |
| 4.2 | Report: stat grid 4→2→1, `Kv` rows stack, tables become cards under 640px — and bring `/report` inside `AppShell` with a print-only stylesheet. | Report usable on a phone; print output unchanged |
| 4.3 | Aspect-ratio chart heights; **one synchronized cursor/tooltip across the three stacked dashboard charts** so CO₂, temperature and RH can be read against each other. | Hovering one chart moves all three |
| 4.4 | Re-run the 0.1 matrix. | Zero clipping on every axis at all four viewports — the KI-2 standard |

### Phase 5 — Data layer and perceived performance (M) · *closes F1, F3, F5, G1–G3*

| Step | What | Acceptance |
|---|---|---|
| 5.1 | One `useSeries(minutes)` hook with request cache + dedupe. | Dashboard drops from **5 requests on mount to 1–2** |
| 5.2 | Pause polling on hidden tabs; refetch on focus. | No network traffic from a background tab |
| 5.3 | Skeletons shaped like the final layout. | No layout shift between loading and loaded |
| 5.4 | `next/font/google` for Inter — closes **KI-5**, removes two CSP origins. | `fonts.googleapis.com` gone from `proxy.ts` |
| 5.5 | One notification-check owner per browser (BroadcastChannel, or a single sweep on focus). | Three open tabs produce one sweep — removes the client half of **KI-4** |

### Phase 6 — Product UX (L) · *each item independently optional*

| Step | What | Note |
|---|---|---|
| 6.1 | **Device switcher** in the shell + per-device scoping of KPIs, charts and thresholds. | Unblocks ROADMAP M4 and A1's "any device" caveat |
| 6.2 | **Onboarding**: signup, password reset, first-run states saying what appears and when (*"de nacht-vooruitblik verschijnt na 3 nachten meten"*). Closes **H3**. | Pilot blocker |
| 6.3 | **Dashboard IA rework**: *Nu* (KPIs + freshness + weather) → *Wat betekent dit* (one severity-ranked advisory card merging the ventilation banner, night outlook, ML card and diagnosis) → *Bewijs* (charts). Closes **B1**, **B2**. | |
| 6.4 | **Report tone** — implements whatever D-2 decides. | Small once decided |
| 6.5 | **Ground-truth capture**: extend Interventions with an "observatie" type (*"zichtbare schimmel hier, deze datum"*, optional photo). | `CALCULATIONS.md` §10 — the pilot can't validate the models without it |

### Also fold in while nearby

- **H1** — rename *"Smoothing"* to *"Afvlakking"* during 2.4.
- **F2** — confirm-on-delete for interventions during 2.4's `Button` extraction.
- **F4** — persist saved scenarios via `useStickyState` during 5.1.
- **A3** — `rawCount` needs the `air_quality_bucketed` RPC to return a true raw count.
  Database work; schedule with the next migration rather than in this branch.

---

## Part 4 — Decisions I need from you

| # | Decision | Blocks | My recommendation |
|---|---|---|---|
| **D-1** | Tailwind: adopt or remove? `swr` likewise. | Step 2.1 — sets the styling idiom for everything after it. | **Remove both.** The idiom is inline styles + CSS variables and it works; extend the tokens instead. Half-migrating is worse than either choice. |
| **D-2** | Is the report a *diagnosis* or *risk signalling*? (WISHLIST §3a) | 6.4, and the wording in 1.5. | Yours — it's a liability position, not a UI choice. |
| **D-3** | How far into Phase 6 before the pilot? | Scheduling. | 6.1 + 6.2 pre-pilot; defer 6.3–6.5. |
| **D-4** | Does the green rebrand apply to the logo too? | Step 2.2. | Yes — a blue mark above a green interface is the drift this plan exists to remove. |

### If you only accept one thing

**Step 1.1** — the freshness contract. A green *"Goed"* on a two-day-old reading is the
same defect as the smoothing slider, in the place where it matters most, and it is the
only finding here that can put an untrue number in front of a landlord.
