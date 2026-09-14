// Bucketkeuze voor de meetreeks van /api/data.
//
// Tot september 2026 hing de blokgrootte alleen aan de GEVRAAGDE periode: "1 jaar" gaf
// altijd 12-uursblokken, ook als de sensor pas drie dagen meet. Dan bleef er één of twee
// punten over en zag je niets. Nu bepaalt de periode alleen het PLAFOND (nooit grover dan
// vroeger) en kiest de data die er echt is de blokgrootte: het kleinste blok uit de ladder
// dat de gemeten spanne in ≤ TARGET_POINTS punten laat passen. Vult de data de hele
// periode, dan komt er precies de oude ladder uit (1000 punten × 2 min ≈ 24 uur, enz.).
//
// De SQL-functie air_quality_bucketed (migratie 20260914120000) rekent op dezelfde manier;
// de fallback in app/api/data/route.ts gebruikt deze code. Houd ze gelijk.
//
// Per blok gaan ook het laagste en hoogste punt mee (min/max), zodat pieken en dalen die het
// gemiddelde afvlakt in de grafiek als band zichtbaar blijven.

export const BUCKET_LADDER_SEC = [60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400] as const

/** Zoveel punten mikken we op; ruim voldoende voor een breed scherm, licht genoeg voor mobiel. */
export const TARGET_POINTS = 1000

/** Het plafond per gevraagde periode: de oude vaste ladder. Nooit grover dan dit. */
export function windowBucketSeconds(windowMinutes: number): number {
  if (windowMinutes <= 360) return 60        // ≤6h   → 1 min
  if (windowMinutes <= 1440) return 120      // ≤24h  → 2 min
  if (windowMinutes <= 4320) return 300      // ≤3d   → 5 min
  if (windowMinutes <= 10080) return 900     // ≤7d   → 15 min
  if (windowMinutes <= 43200) return 3600    // ≤30d  → 1 h
  if (windowMinutes <= 129600) return 10800  // ≤90d  → 3 h
  if (windowMinutes <= 525600) return 43200  // ≤1yr  → 12 h
  return 86400                               // >1yr  → 1 d
}

/**
 * Blokgrootte (seconden) voor een gevraagde periode en de spanne van de data die er echt
 * is (eerste t/m laatste meting in de periode, in seconden). `null` of 0 = geen of één
 * meting: dan het fijnste blok, er valt toch niets samen te voegen.
 */
export function pickBucketSeconds(windowMinutes: number, spanSeconds: number | null): number {
  const cap = windowBucketSeconds(windowMinutes)
  if (spanSeconds == null || !(spanSeconds > 0)) return Math.min(cap, BUCKET_LADDER_SEC[0])
  const need = spanSeconds / TARGET_POINTS
  const step = BUCKET_LADDER_SEC.find((s) => s >= need) ?? BUCKET_LADDER_SEC[BUCKET_LADDER_SEC.length - 1]
  return Math.min(step, cap)
}

export interface BucketedRow {
  created_at: string
  co2: number | null
  temperature: number | null
  humidity: number | null
  co2_min: number | null
  co2_max: number | null
  temperature_min: number | null
  temperature_max: number | null
  humidity_min: number | null
  humidity_max: number | null
  n: number
}

interface RawRow { created_at: string; co2: number | string | null; temperature: number | string | null; humidity: number | string | null }

/** Ruwe metingen → blokken met gemiddelde, laagste en hoogste. Mirror van de SQL. */
export function aggregateRows(rows: RawRow[], bucketSec: number): BucketedRow[] {
  if (!rows.length) return []
  type Acc = { key: number; co2: number[]; temperature: number[]; humidity: number[] }
  const buckets = new Map<number, Acc>()
  for (const r of rows) {
    const key = Math.floor(new Date(r.created_at).getTime() / 1000 / bucketSec)
    let b = buckets.get(key)
    if (!b) { b = { key, co2: [], temperature: [], humidity: [] }; buckets.set(key, b) }
    if (r.co2 != null) b.co2.push(+r.co2)
    if (r.temperature != null) b.temperature.push(+r.temperature)
    if (r.humidity != null) b.humidity.push(+r.humidity)
  }
  const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null)
  const lo = (a: number[]) => (a.length ? Math.min(...a) : null)
  const hi = (a: number[]) => (a.length ? Math.max(...a) : null)
  return [...buckets.values()]
    .sort((a, b) => a.key - b.key)
    .map((b) => ({
      created_at: new Date(b.key * bucketSec * 1000).toISOString(),
      co2: mean(b.co2), co2_min: lo(b.co2), co2_max: hi(b.co2),
      temperature: mean(b.temperature), temperature_min: lo(b.temperature), temperature_max: hi(b.temperature),
      humidity: mean(b.humidity), humidity_min: lo(b.humidity), humidity_max: hi(b.humidity),
      n: Math.max(b.co2.length, b.temperature.length, b.humidity.length),
    }))
}

/** Spanne van een reeks in seconden (eerste t/m laatste), of null bij < 2 rijen. */
export function spanSeconds(rows: { created_at: string }[]): number | null {
  if (rows.length < 2) return null
  let lo = Infinity, hi = -Infinity
  for (const r of rows) { const t = new Date(r.created_at).getTime(); if (t < lo) lo = t; if (t > hi) hi = t }
  return (hi - lo) / 1000
}
