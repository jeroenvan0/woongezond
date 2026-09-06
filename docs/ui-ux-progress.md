# UI/UX implementation — progress log

Working doc tracking the implementation of [ui-ux-plan.md](./ui-ux-plan.md) on branch
`ui-improvements`. Updated as work lands. **Read this first tomorrow.**

## TL;DR (end of session)
Phases **1, 2, 3, 5 essentially complete; 4 mostly; 6.1/6.2 partial as scoped.**
Everything builds: `npm test` 92 pass, typecheck clean, `npm run build` clean.
Verified running locally via `npx next start -p 3002` (login renders, signup/reset
present, no Google-Fonts origins, /api/health 200). **What's genuinely left is small**
— see "Still open" at the bottom. Biggest remaining: the Phase-0 baseline scripts
(need a running signed-in server) and per-device *chart* scoping (blocked on a DB
migration to the `air_quality_bucketed` RPC).

## Decisions taken (Part 4)
- **D-1 Remove** Tailwind + swr — idiom stays inline styles + CSS-variable tokens.
- **D-2 Diagnosis** — the report keeps its evidentiary/diagnostic tone ("gebrek"). The auto-generated complaint letter to the landlord was removed on 2026-09-06: the focus shifted to working *with* VvE's and housing corporations rather than against a landlord.
- **D-3** Implement 6.1 + 6.2 now; defer 6.3–6.5.
- **D-4 Yes** — logo rebranded green→teal.

## Verification gate (run before trusting anything)
```bash
npm test && npm run typecheck && npm run build
```
All green as of last commit: **92 tests, typecheck clean, build clean.**

## Status by phase

### Phase 0 — Baseline
- [ ] **0.1** `scripts/ui-baseline.mjs` Puppeteer 48-shot capture + `--compare` — **NOT DONE**.
      Deferred: needs a running signed-in server; the iCloud `next dev` hang risk makes
      this awkward to run unattended. Start here tomorrow if a visual baseline is wanted.
- [ ] **0.2** axe-core per-route JSON baseline — **NOT DONE** (same reason).

### Phase 1 — Truthfulness — **DONE**
- [x] 1.1 Freshness contract — `lib/freshness.ts` (unit-tested, shares the 60-min
      `device_offline` threshold). KPI cards desaturate + drop status when offline;
      "gemeten 14:32 · 2 min geleden" line; footer no longer claims "elke 60s".
- [x] 1.2 `DeviceHealthChip` surfaces `/api/health` in the sidebar footer.
- [x] 1.3 Demo data: schimmel hero shows `Voorbeeldweergave`, no fabricated WoonScore
      in hero type; charts labelled "voorbeelddata".
- [x] 1.4 `DataBanner` on **all five data pages** (dashboard, trends, schimmel, report;
      scenarios surfaces recommendation errors in-card). 429/5xx/network, with retry.
- [x] 1.5 Score reconciliation via `InfoHint` (dashboard health, trends daily, schimmel
      WoonScore relabelled "hoger = meer risico").

### Phase 2 — Design system — **DONE**
- [x] 2.1 Removed tailwind/@tailwindcss/postcss/swr, deleted postcss.config.mjs.
- [x] 2.2 Token file landed in `app/globals.css` (colour + type + spacing + radius + focus).
- [x] 2.3 Literals → tokens across app/ + components/. **Remaining hex literals are intentional:**
      `Logo.tsx` (excluded by plan), `components/ReportChart.tsx` + `app/report/page.tsx`
      (the printed document is deliberately fixed-light — a court exhibit must print the
      same regardless of theme), and `components/HourHeatmap.tsx` gradient *stops* (RGB
      arrays, not hex; a legitimate continuous data-viz ramp). Verify with:
      `grep -rEl '#[0-9A-Fa-f]{6}' app components`.
- [x] 2.4 Primitives in `components/ui/`: Card, SectionHeading, Stat, SegmentedControl,
      Button, InfoHint. Period controls unified on SegmentedControl (B4). "Smoothing"→
      "Afvlakking" (H1). Confirm-on-delete for interventions + scenarios (F2).
- [x] 2.5 lucide everywhere (retired 🔔⚙▴🔮↻📍✚🕘✕↑💬👍👎⬇✨▾). Chart gridlines unified on
      `--c-grid` via `lib/useChartColors.ts` (resolves tokens→rgb, re-resolves on theme
      flip — needed because `var()` doesn't resolve inside SVG presentation attributes).

### Phase 3 — Accessibility — **DONE**
- [x] 3.1 Global `:focus-visible` ring (globals.css `--focus`).
- [x] 3.2 tabs→`role=tablist` (SegmentedControl); notification rows→`<button>`; nav
      `aria-label`+`aria-current`; skip link. HourHeatmap grid is `role=img` with a summary
      + a `ChartTable` (Maand/Uur/Gemiddelde) text alternative.
- [x] 3.3 `aria-live` on KPI region, chat transcript, save confirmations, banners.
- [x] 3.4 "Toon als tabel" — `components/ui/ChartTable` (`<details>`+`<table>`) under all
      nine charts (dashboard ×5, trends timeline + monthly, schimmel MI/SER/binnenklimaat)
      plus the heatmap.
- [x] 3.5 Login: autoComplete, Dutch error mapping, announced errors.
- [x] 3.6 Three-way theme (systeem/licht/donker) that follows the OS live on "systeem".
- Exit criterion (axe-core 0 serious/critical) is **not machine-verified** — depends on 0.2.

### Phase 4 — Responsive — **MOSTLY DONE**
- [x] 4.1 Chat panel `width:min(360px,calc(100vw-32px))` + height-clamped sheet, FAB clear
      of the tab bar (globals.css `.wz-chat-panel`).
- [x] 4.2 Report inside AppShell (B3) with print-only stylesheet (globals.css `@media print`
      hides shell chrome); stat grid 4→2→1, Kv rows stack.
- [x] **4.3 Synchronized cursor** — the three "Metingen" dashboard charts share a Recharts
      `syncId="wz-dash"`, so hovering one moves the cursor/tooltip on all three.
      *Aspect-ratio chart heights NOT done — charts are still fixed px (200/220). Low value;
      would need the ResponsiveContainer parents to drive height from `aspect-ratio`.*
- [ ] 4.4 Re-run the viewport matrix — depends on 0.1 (not done).

### Phase 5 — Data layer & perf — **DONE**
- [x] 5.1 `lib/useSeries.ts` — shared response cache (TTL) keyed by window + in-flight
      dedupe. Wired into dashboard, NightOutlook (14d), MLPrediction (3d), ContinuityChip
      (30d), trends, report. Same-window requests now share one fetch; navigation reuses cache.
- [x] 5.2 `useSeries` pauses polling on hidden tabs and refetches on focus.
- [x] 5.3 `components/ui/Skeleton` (Skeleton/MetricCardSkeleton/ChartSkeleton, reduced-motion
      aware). Dashboard KPI grid shows card-shaped skeletons while loading.
- [x] 5.4 `next/font/google` Inter self-hosted; two Google Fonts CSP origins removed (KI-5).
- [x] 5.5 `lib/notificationSweep.ts` — single sweep owner per browser via the Web Locks API
      + BroadcastChannel refresh. Three tabs → one sweep (client half of KI-4). Per-tab fallback.
- [x] F4 saved scenarios persist via `useStickyState`.
- Note: the four *different-window* dashboard fetches (period/14d/3d/30d) don't collapse to
  one — they're genuinely different windows — but they share the cache and no longer duplicate.

### Phase 4 — Responsive — **MOSTLY DONE** (see 4.3/4.4 notes above)

### Phase 6 — Product UX (only 6.1 + 6.2 in scope per D-3)
- [x] 6.1 (partial) `DeviceSwitcher` in shell + `useSelectedDevice` store; dashboard
      headline reading scopes to the selected device. **Per-device CHART scoping is
      blocked** — `/api/data`'s `air_quality_bucketed` RPC has no device param; that needs
      a DB migration (plan defers DB work; see A3). Document/ship the identity + KPI
      scoping; note charts still merge devices.
- [x] 6.2 Signup + password reset on `/login`. First-run states (H3): schimmel `DemoNotice`
      + `components/FirstRunNotice` replaces the dashboard's five day-one negative empty
      states with one positive "what appears and when" card (shown only when truly empty).

## Fold-ins
- [x] H1 Smoothing→Afvlakking · [x] F2 confirm-delete (interventions + scenarios) ·
      [x] F4 persist scenarios · [ ] A3 (DB — deliberately out of this branch).

## Still open (what to pick up)
Ranked; all are optional polish or blocked, none block the core plan.
1. **0.1 / 0.2 baseline scripts** (`scripts/ui-baseline.mjs` + axe-core). Deferred because
   they need a running, signed-in server and the iCloud `next dev` hang makes unattended
   runs risky. Would give the measured before/after visual + a11y record. Puppeteer isn't a
   dep yet. Local prod server works fine: `npm run build && npx next start -p 3002`.
2. **Per-device CHART scoping (6.1 remainder)** — blocked on a DB migration: the
   `air_quality_bucketed` RPC needs a `device_id` param. Device *identity* + KPI scoping
   already ship. Schedule with the next migration (same one as A3's rawCount fix).
3. **Aspect-ratio chart heights (4.3 remainder)** — charts are fixed px; low value.
4. **axe-core exit criterion (3.x)** — believed met by construction, not machine-verified
   (needs 0.2).
5. **A3 rawCount** — DB work, deliberately out of this branch.

## How to run locally
```bash
npm run build && npx next start -p 3002   # http://localhost:3002 (.env.local has creds)
# next dev hangs in this iCloud folder — use the built server, never wait dev out.
```

## Commits (newest last), one per step group
- UI 2.1 remove tailwind+swr
- UI 2.2 + 5.4 tokens + self-hosted Inter
- UI 2.4 + 2.5 primitives + component/chart token migration
- UI 1.1–1.4 + 1.2/6.1 + shell a11y (freshness, banners, device identity)
- UI schimmel/trends/login migration (demo honesty, onboarding, tokens)
- UI scenarios + report (report into AppShell, print CSS, persist scenarios)
- UI 5.1/5.2/5.5 shared cached data path + single notification sweep owner
- UI 3.4 + 4.3 + heatmap a11y (chart tables, synced cursor)
- UI 5.3 + H3 skeletons + first-run dashboard
- UI 1.4 DataBanner coverage on report + schimmel
