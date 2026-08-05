# UI/UX implementation — progress log

Working doc tracking the implementation of [ui-ux-plan.md](./ui-ux-plan.md) on branch
`ui-improvements`. Updated as work lands. **Read this first tomorrow.**

## Decisions taken (Part 4)
- **D-1 Remove** Tailwind + swr — idiom stays inline styles + CSS-variable tokens.
- **D-2 Diagnosis** — the report keeps its evidentiary/diagnostic tone (complaint letter, "gebrek").
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
- [x] 1.4 `DataBanner` on dashboard + trends (429/5xx/network, retry). *TODO: also add to
      schimmel + report + scenarios fetches for full coverage (currently they `.catch` silently).*
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

### Phase 3 — Accessibility — **MOSTLY DONE**
- [x] 3.1 Global `:focus-visible` ring (globals.css `--focus`).
- [x] 3.2 tabs→`role=tablist` (SegmentedControl); notification rows→`<button>`; nav
      `aria-label`+`aria-current`; skip link. **TODO: HourHeatmap cells are still `<div title>`
      — make an accessible grid with per-cell labels.**
- [x] 3.3 `aria-live` on KPI region, chat transcript, save confirmations, banners.
- [ ] **3.4 "Toon als tabel"** under each chart — **NOT DONE.** This is the biggest
      remaining a11y item (plan says all 9 charts). Suggested approach: a `<ChartTable>`
      component (a `<details>` wrapping a `<table>` built from the series) dropped under
      each ChartCard. Start here for Phase 3 completion.
- [x] 3.5 Login: autoComplete, Dutch error mapping, announced errors.
- [x] 3.6 Three-way theme (systeem/licht/donker) that follows the OS live on "systeem".

### Phase 4 — Responsive — **MOSTLY DONE**
- [x] 4.1 Chat panel `width:min(360px,calc(100vw-32px))` + height-clamped sheet, FAB clear
      of the tab bar (globals.css `.wz-chat-panel`).
- [x] 4.2 Report inside AppShell (B3) with print-only stylesheet (globals.css `@media print`
      hides shell chrome); stat grid 4→2→1, Kv rows stack.
- [ ] **4.3 Synchronized cursor/tooltip across the 3 stacked dashboard charts** — **NOT DONE.**
      Aspect-ratio chart heights also not done (charts still fixed px). Requires lifting a
      shared hover index across the three SensorCharts (Recharts `syncId` is the easy win:
      give the three metingen-tab charts the same `syncId` prop).
- [ ] 4.4 Re-run the viewport matrix — depends on 0.1.

### Phase 5 — Data layer & perf — **PARTIAL**
- [x] 5.4 `next/font/google` Inter self-hosted; two Google Fonts CSP origins removed (KI-5).
- [x] F4 saved scenarios persist via `useStickyState`.
- [x] 5.2 (partial) `DeviceHealthChip` pauses its poll on hidden tabs.
- [ ] **5.1** One `useSeries(minutes)` hook with request cache + dedupe — **NOT DONE.**
      Dashboard still fires ~4 `/api/data` calls on mount (period, NightOutlook 14d,
      MLPrediction 3d, ContinuityChip 30d) + the direct latest query. Biggest perf item.
- [ ] **5.2** Pause the dashboard/trends polls on hidden tabs, refetch on focus — **NOT DONE**
      (only DeviceHealthChip does this so far).
- [ ] **5.3** Skeletons shaped like the final layout — **NOT DONE** (still "—"/"Laden…").
- [ ] **5.5** Single notification-check owner per browser (BroadcastChannel) — **NOT DONE.**
      `NotificationBell` still POSTs `/api/notifications/check` every 120s per open tab
      (client half of KI-4). Suggested: a leader-election via BroadcastChannel, or only
      sweep on focus.

### Phase 6 — Product UX (only 6.1 + 6.2 in scope per D-3)
- [x] 6.1 (partial) `DeviceSwitcher` in shell + `useSelectedDevice` store; dashboard
      headline reading scopes to the selected device. **Per-device CHART scoping is
      blocked** — `/api/data`'s `air_quality_bucketed` RPC has no device param; that needs
      a DB migration (plan defers DB work; see A3). Document/ship the identity + KPI
      scoping; note charts still merge devices.
- [x] 6.2 (partial) Signup + password reset on `/login`. **First-run states** ("de
      nacht-vooruitblik verschijnt na 3 nachten meten" etc., H3) — schimmel has one
      (DemoNotice); the dashboard's five negative empty-states are NOT yet unified into
      positive first-run messaging. Consider a shared `<FirstRun what=… when=…>` component.

## Fold-ins
- [x] H1 Smoothing→Afvlakking · [x] F2 confirm-delete (interventions + scenarios) ·
      [x] F4 persist scenarios · [ ] A3 (DB — deliberately out of this branch).

## Suggested order for tomorrow
1. **5.1 `useSeries` hook** (biggest perf + unblocks 5.2/5.3) and **5.5** (KI-4 client half).
2. **3.4 ChartTable** across the charts (a11y exit criterion).
3. **4.3 syncId** on the three dashboard charts (cheap, high value).
4. **HourHeatmap a11y** (3.2 remainder).
5. **DataBanner** on the remaining 3 pages; **skeletons** (5.3).
6. Optional: **0.1/0.2 baseline** scripts if a measured visual/a11y record is wanted.

## Commits so far (newest last), one per step group
- UI 2.1 remove tailwind+swr
- UI 2.2 + 5.4 tokens + self-hosted Inter
- UI 2.4 + 2.5 primitives + component/chart token migration
- UI 1.1–1.4 + 1.2/6.1 + shell a11y (freshness, banners, device identity)
- UI schimmel/trends/login migration (demo honesty, onboarding, tokens)
- UI scenarios + report (report into AppShell, print CSS, persist scenarios) ← in progress
