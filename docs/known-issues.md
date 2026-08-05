# Known issues — found, diagnosed, not yet fixed

Running list of defects that are understood but deliberately not fixed yet, so the
diagnosis isn't lost between sessions. Each entry carries the root cause and the
proposed fix, not just the symptom. Fixed entries move out of this file and into
[../DECISIONS.md](../DECISIONS.md) if the fix was non-obvious.

Scheduled into Milestone 4 (pilot UX polish) in [../ROADMAP.md](../ROADMAP.md).

---

## KI-1 — The smoothing slider lies about its unit (misleading data)

**Reported by Jeroen, 2026-08-05.** "It is smoothing the data automatically based on the
time frame, which is fine, but when the smoothing slider is used, it gives the wrong
impression."

**Severity: high.** This is the one class of bug this product cannot afford — the app
positions its output as evidentiary (see `lib/coverage.ts`, [../CALCULATIONS.md](../CALCULATIONS.md)),
and today the headline numbers on the dashboard change when you drag a cosmetic-looking
slider.

### There are two separate defects here

#### KI-1a — The slider is labelled in minutes but applies *samples*

The automatic smoothing Jeroen refers to is correct and intentional: `/api/data`
buckets server-side by requested period, and returns the bucket size it used
([app/api/data/route.ts:5-12](../app/api/data/route.ts#L5-L12)):

| Period requested | Bucket size returned |
|---|---|
| ≤ 2 days | 1 min |
| ≤ 7 days | 5 min |
| ≤ 30 days | 15 min |
| ≤ 90 days | 60 min |
| ≤ 365 days | 360 min |
| > 365 days | 720 min |

The route reports this to the client as `bucketMinutes` ([route.ts:54](../app/api/data/route.ts#L54)).
**The dashboard throws it away** — `fetchData` keeps only `d.rows`
([app/dashboard/page.tsx:86](../app/dashboard/page.tsx#L86)).

Then `applyMA` passes the slider's minute value straight into `movingAverage` as a
**window size in array elements** ([app/dashboard/page.tsx:46-54](../app/dashboard/page.tsx#L46-L54)
→ [lib/calculations.ts:220-229](../lib/calculations.ts#L220-L229)):

```ts
const n = Math.max(2, Math.round(windowMin))   // "minutes" used as a sample count
const co2 = movingAverage(rows.map((x) => x.co2), n)
```

So the true smoothing window is `sliderMinutes × bucketMinutes`. The label is only
correct on the 30-min…24-hour views, where buckets happen to be 1 minute wide (the
sensor writes ~every 60 s — 1,424 rows/day observed, see KI-3):

| View | Slider says | Actually smooths over | Error |
|---|---|---|---|
| 24 uur | 60 min | 60 min | ✅ correct |
| 7 dagen | 60 min | 5 hours | 5× |
| 30 dagen | 60 min | 15 hours | 15× |
| 1 jaar | 60 min | **15 days** | 360× |
| 1 jaar | 180 min (max) | **45 days** | 360× |

#### KI-1b — The KPI cards read from the smoothed series, not the measurements

`last` is taken from the *smoothed* array
([app/dashboard/page.tsx:108-116](../app/dashboard/page.tsx#L108-L116)):

```ts
const displayed = useMemo(() => applyMA(rows, maMin), [rows, maMin])
const last = displayed[displayed.length - 1]
```

Everything derived from `last` — the CO₂ / temperature / humidity / mould / dewpoint
metric cards, their status colours, and the **health score** — therefore moves when the
slider moves. Nothing on screen tells the user the "current" reading is no longer a
reading.

It compounds: `movingAverage` is a **centred** window (`i - half` … `i + half`), so at
the final index the window is truncated to its trailing half. The "now" figure is an
average of roughly the *previous* `n/2` samples. On the 1-year view at max slider that
makes the headline "current CO₂" an average of the preceding ~22 days.

### Proposed fix

1. Keep `bucketMinutes` from the API response in state.
2. Convert in `applyMA`: `const n = Math.max(2, Math.round(windowMin / bucketMinutes))`,
   so the label means what it says at every period.
3. Clamp/step the slider to multiples of `bucketMinutes`, and show the effective window
   (`"2 uur (8 punten)"`) rather than a raw minute count. When `windowMin < bucketMinutes`
   the slider can do nothing — disable it and say so.
4. **Drive the KPI cards from `rows`, never `displayed`.** Smoothing is a chart-reading
   aid; it must not touch the reported current value or the health score. If a smoothed
   headline is ever wanted, it needs an explicit label.
5. Consider a trailing rather than centred average for anything labelled "current", since
   a centred window at the last index is neither one thing nor the other.

### Related, found while diagnosing

`rawCount` in the RPC fast path is set to the **bucketed** row count, not the raw one
([app/api/data/route.ts:54](../app/api/data/route.ts#L54)) — `rawCount: rows.length`,
where `rows` is already aggregated. The JS fallback gets it right (`all.length`,
[line 76](../app/api/data/route.ts#L76)). This defeats commit `1d7bf04` ("Show raw
measurement count separately from graph points"). The dashboard footer separately shows
`rows.length` ("meetpunten", [line 269](../app/dashboard/page.tsx#L269)), which is the
bucket count too — so on the 1-year view "meetpunten" understates reality by ~360×.

---

## KI-2 — Notification centre opens off-screen

**Reported by Jeroen, 2026-08-05.** Confirmed by measurement, not just inspection.

**Severity: medium.** The feature is effectively unusable on desktop; threshold settings
sit at the bottom of a panel whose bottom is below the fold.

### Root cause

The bell lives in the **sidebar footer** ([components/AppShell.tsx:107-111](../components/AppShell.tsx#L107-L111)),
i.e. bottom-left of the viewport. The sidebar is `position:fixed; left:0; bottom:0;
width:230px` ([app/globals.css:69](../app/globals.css#L69)).

The dropdown is positioned as if it were hanging off a top-right header button
([components/NotificationBell.tsx:176-192](../components/NotificationBell.tsx#L176-L192)):

```ts
position: 'absolute',
top: 'calc(100% + 8px)',   // opens DOWNWARD from a button already at the bottom
right: 0,                  // grows LEFTWARD 320px from a button at x≈16..57
width: 320,
maxHeight: 460,            // fixed, ignores viewport height
```

Both axes are wrong for where the button actually sits. Measured with headless Chrome
against the real sidebar CSS, at 1440×900 **and** 1280×720 (identical, because the
sidebar is bottom-anchored):

| | value |
|---|---|
| Button box | x 16 → 57 |
| Panel box | x **−263** → 57, y 838 → 961 |
| Viewport | 1440 × 900 |
| Clipped off the left | **263 px** |
| Clipped below the fold | **61 px** |

Only 57 px of a 320 px panel is on screen — and that is with an *empty* notification
list. With notifications loaded, or the ⚙ Drempelwaarden section expanded, the panel
grows toward `maxHeight: 460` and the bottom overflow grows with it.

Repro harness and screenshots: `scratchpad/repro.mjs`, `scratchpad/repro-*.png`
(scratchpad is session-local; the script is ~40 lines and trivially re-creatable from
the numbers above).

### Proposed fix

Position it for where the anchor actually is:

```ts
bottom: 0,            // instead of top: calc(100% + 8px)
left: 'calc(100% + 8px)',   // instead of right: 0
maxHeight: 'min(460px, calc(100vh - 32px))',
```

i.e. fly out **to the right of the rail and upward**, the conventional pattern for a
bottom-of-sidebar menu. Also:

- The same component renders in the **mobile top bar** ([AppShell.tsx:125-134](../components/AppShell.tsx#L125-L134)),
  where `top`/`right: 0` *is* correct. The fix must be placement-aware — either a prop
  (`placement="side" | "top"`) or CSS driven by the parent — not a blanket flip.
- `width: 320` is wider than the 74 px collapsed rail and near the 375 px mobile
  viewport; clamp with `width: 'min(320px, calc(100vw - 24px))'`.
- Verify with Puppeteer at 1440×900, 1280×720, collapsed rail, and 390×844 mobile, per
  [../CLAUDE.md](../CLAUDE.md).

---

## KI-4 — Every notification is written twice (pre-existing race)

**Found 2026-08-05** while testing the M3 alert sweep. **Not** introduced by it — the
duplication is visible in rows going back months.

**Severity: medium.** Cosmetic today (a doubled bell count). It gets worse once the
15-minute timer runs alongside browser polling, and with 10 households it becomes
duplicate *emails*, which is the kind of thing that gets an alert channel muted.

### Evidence

Every row has a twin milliseconds apart, across unrelated alert types and dates:

| created_at | type |
|---|---|
| 2026-08-05 15:11:17.665781 / **.667839** | `device_offline` |
| 2026-08-05 15:11:17.262757 / **.263397** | `device_offline` |
| 2026-07-31 08:58:43.174406 / **.178838** | `threshold_humidity_warning` |
| 2026-06-30 03:56:10.372726 / **.410314** | `threshold_co2_warning` |

### Root cause

Check-then-act with no atomicity. The sweep reads recent notifications to decide whether
an alert is rate-limited, then inserts. Two concurrent callers — two browser tabs, or
React StrictMode's double-invoke, or soon a tab *and* the systemd timer — both read
"nothing recent" before either has committed, so both pass the check and both insert.

The 2-hour and 12-hour rate limits do not help: the two requests are ~2 ms apart, well
inside any window. No database constraint prevents it.

### Proposed fix

Move the guarantee into Postgres, since that is the only place both callers meet:

```sql
CREATE UNIQUE INDEX notifications_dedupe
  ON public.notifications (user_id, device_id, type, date_trunc('hour', created_at AT TIME ZONE 'UTC'));
```

(`AT TIME ZONE 'UTC'` makes the expression immutable, which a plain `date_trunc` on
`timestamptz` is not, and an index expression must be.)

Then make the insert `.upsert(…, { onConflict: …, ignoreDuplicates: true })` so a losing
race is a no-op rather than a 500.

**Blocked on a decision, not on effort:** creating a unique index requires the existing
duplicate rows to be removed first, and that is a destructive change to production data.
It needs an explicit go-ahead. The dedupe query would be a standard
`DELETE … USING … WHERE a.id > b.id` over the twins.

An hour-granularity index is a slightly blunt instrument — it also collapses two
*legitimate* alerts of the same type for the same device inside one clock hour. Given
the existing rate limits are 2 h and 12 h, nothing legitimate is lost.

---

## KI-5 — Inter is loaded from Google Fonts

**Severity: low.** Noted while writing the CSP, which had to be widened to
`style-src https://fonts.googleapis.com` and `font-src https://fonts.gstatic.com`
purely for this ([app/layout.tsx:13-15](../app/layout.tsx#L13-L15)).

Switching to `next/font/google` self-hosts the font at build time: it removes two
third-party origins from the CSP, one external dependency from the critical render path,
and the privacy question of every resident's browser announcing itself to Google on
every page load. Small change, worth doing when someone next touches the layout.

---

## KI-3 — Live sensor silent since 2026-08-03, nothing noticed

**Severity: high for the pilot** — not a code bug, but proof of the gap Milestone 3 exists
to close.

`air_quality` observations as of 2026-08-05:

| Device | Rows | Last reading |
|---|---|---|
| `3f1380c9…` Jeroen Sensor (slaapkamer_jeroen) | 105,462 | **2026-08-03 11:12:14Z** |
| `084c71f1…` Jannouk Sensor (slaapkamer_jannouk) | 10,019 | **2026-05-25 18:44:56Z** |
| `a1000000…` Feather S3 (Slaapkamer) | 0 | never |

The active sensor was writing 1,424 rows/day (≈ every 60 s) with no degradation, then
stopped **mid-day, abruptly** — the shape of a power cut, Wi-Fi drop or unplug, not a
failing sensor. The database holds nothing further to diagnose it; this is device-side.

The second device has been dead for 2½ months and the third has never reported. **Nobody
noticed any of it.** With 10 households this is the difference between a pilot and an
outage. This is exactly what M3's `/api/health` (last ingest per device) and
server-side alerting are for — and it argues for device-liveness alerting landing in M3
rather than being deferred, per the M2 design doc's §7 note.
