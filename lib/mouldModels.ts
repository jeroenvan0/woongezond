// VTT Mould Index + WUFI-Bio water-activity mould risk models.
// Ported 1:1 from the Flask app's mould_models.py.
//
// Sources:
//   VTT:      Hukka & Viitanen (1999), Ojanen et al. (2010), VTT Technical Research Centre of Finland.
//   WUFI-Bio: Fraunhofer IBP.
//
// All functions are pure (no I/O) and independently testable.

// ── Material class k₂ factors (VTT model) ──────────────────────────────────
export const MATERIAL_K2: Record<string, number> = {
  wood: 2.0, // bare / unprotected wood
  gypsum: 1.0, // gypsum board / default interior surface
  concrete: 0.5, // concrete / masonry
  treated: 0.2, // surface-treated or painted
}

export const MATERIAL_LABELS: Record<string, string> = {
  wood: 'Hout (onbehandeld)',
  gypsum: 'Gips / standaard',
  concrete: 'Beton / metselwerk',
  treated: 'Behandeld / geschilderd',
}

// ── VTT Mould Index ─────────────────────────────────────────────────────────

/** Critical RH (%) below which VTT mould growth is zero. */
export function rhCrit(tempC: number): number {
  return Math.max(80.0, -0.00267 * tempC ** 3 + 0.16 * tempC ** 2 - 3.13 * tempC + 100.0)
}

/** Advance VTT Mould Index by one timestep. Returns new MI (0–6). */
export function vttStep(
  tempC: number,
  rhPct: number,
  mPrev: number,
  dtHours: number,
  k2 = 1.0,
): number {
  const rhC = rhCrit(tempC)
  const k1 = tempC >= 0.0 && tempC <= 50.0 && rhPct >= rhC ? 1.0 : 0.0

  if (k1 === 0.0) {
    // Slow biological decline (~50% per 6 days) when conditions improve
    const dm = -Math.max(0.0, (mPrev * 0.5) / 6.0) * dtHours
    return Math.max(0.0, mPrev + dm)
  }

  const a = (0.3 * (rhPct - rhC)) / Math.max(100.0 - rhC, 1e-9)
  const w = Math.max(0.0, mPrev * 0.5)
  const dm = k1 * k2 * (1.0 / (7.0 * Math.exp(a) + 1.0) - w / 6.0) * dtHours
  return Math.min(6.0, Math.max(0.0, mPrev + dm))
}

// ── WUFI-Bio ──────────────────────────────────────────────────────────────

/** Advance WUFI-Bio growth potential (GP) by one timestep. */
export function wufiStep(tempC: number, rhPct: number, gpPrev: number, dtHours: number): number {
  const aw = rhPct / 100.0
  const awC = Math.max(0.7, 0.8 - 0.0007 * tempC)
  if (aw >= awC && tempC >= 0.0 && tempC <= 40.0) {
    return gpPrev + (aw - awC) * dtHours
  }
  return Math.max(0.0, gpPrev - 0.05 * dtHours)
}

/** Convert GP to Surface Emission Rate (0–100, capped). */
export function gpToSer(gp: number): number {
  return Math.min(100.0, (gp / 50.0) * 100.0)
}

// ── Combined score ──────────────────────────────────────────────────────────

/** Combined WoonScore (0–100, higher = worse risk). */
export function woonScore(mi: number, ser: number): number {
  return 0.6 * ((mi / 6.0) * 100.0) + 0.4 * ser
}

export interface MouldSeries {
  mi: number[]
  ser: number[]
  woonScore: number[]
}

/** Run VTT + WUFI-Bio over parallel T/RH time series (timestamps in ms). */
export function runModels(
  timestampsMs: number[],
  temps: number[],
  rhs: number[],
  k2 = 1.0,
): MouldSeries {
  const miArr: number[] = []
  const serArr: number[] = []
  const wsArr: number[] = []

  let mi = 0.0
  let gp = 0.0

  for (let i = 0; i < temps.length; i++) {
    let dtH: number
    if (i === 0) {
      dtH = 0.5
    } else {
      dtH = (timestampsMs[i] - timestampsMs[i - 1]) / 3_600_000
      dtH = Math.min(Math.max(dtH, 1e-4), 24.0)
    }

    mi = vttStep(temps[i], rhs[i], mi, dtH, k2)
    gp = wufiStep(temps[i], rhs[i], gp, dtH)
    const ser = gpToSer(gp)

    miArr.push(+mi.toFixed(4))
    serArr.push(+ser.toFixed(2))
    wsArr.push(+woonScore(mi, ser).toFixed(1))
  }

  return { mi: miArr, ser: serArr, woonScore: wsArr }
}

// ── Demo data ────────────────────────────────────────────────────────────────

// Mulberry32 — small deterministic PRNG so the demo curve is stable across renders.
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gauss(rand: () => number, mean: number, sd: number): number {
  // Box–Muller
  const u1 = Math.max(rand(), 1e-9)
  const u2 = rand()
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2)
  return mean + z * sd
}

export interface DemoSeries {
  timestampsMs: number[]
  temps: number[]
  rhs: number[]
}

/**
 * Realistic Dutch bedroom T/RH series at 30-min intervals.
 * Temperature ~17–20°C diurnal; humidity ~68–78% with nocturnal peaks.
 */
export function generateDemoData(days = 28): DemoSeries {
  const rand = mulberry32(42)
  const end = new Date()
  end.setSeconds(0, 0)
  const n = days * 24 * 2 // 30-min steps
  const timestampsMs: number[] = []
  const temps: number[] = []
  const rhs: number[] = []

  for (let i = 0; i < n; i++) {
    const ts = end.getTime() - 30 * 60 * 1000 * (n - 1 - i)
    const h = new Date(ts).getHours()
    const temp = 18.5 + 1.5 * Math.sin(((h - 6) * Math.PI) / 12.0) + gauss(rand, 0, 0.3)
    const rh = 73.0 + 5.0 * Math.sin(((h - 3) * Math.PI) / 12.0) + gauss(rand, 0, 1.5)
    timestampsMs.push(ts)
    temps.push(+temp.toFixed(1))
    rhs.push(+Math.max(40.0, Math.min(95.0, rh)).toFixed(1))
  }

  return { timestampsMs, temps, rhs }
}

// ── Labelling helpers ─────────────────────────────────────────────────────────

export function woonScoreLabel(ws: number): { label: string; color: string; bg: string } {
  if (ws < 30) return { label: 'Laag risico', color: '#16A34A', bg: 'rgba(22,163,74,0.09)' }
  if (ws < 60) return { label: 'Verhoogd risico', color: '#D97706', bg: 'rgba(217,119,6,0.09)' }
  return { label: 'Hoog risico', color: '#DC2626', bg: 'rgba(220,38,38,0.09)' }
}
