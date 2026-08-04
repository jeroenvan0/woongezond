/**
 * Winter-condition simulator for the Woongezond mould models.
 *
 * Generates 72 hours of realistic winter indoor climate (poorly heated, badly
 * ventilated room), converts each sample to the *wall surface* condition — which
 * is what the VTT Mould Index + WUFI-Bio models are calibrated for — and runs
 * both models step-by-step so we can validate that risk rises as expected.
 *
 * It is fully self-contained: it only imports the pure science ports and never
 * touches the live app, network, or database (the optional Supabase seed is
 * gated behind --seed and prompts before writing).
 *
 *   npx tsx scripts/simulate-winter.ts            # simulate + report only
 *   npx tsx scripts/simulate-winter.ts --seed     # also offer to seed Supabase
 *
 * Sources: Hukka & Viitanen (1999), Ojanen et al. (2010) [VTT]; Fraunhofer IBP
 * [WUFI-Bio]. Wall-surface model: ISO 6946 (Rsi = 0.13 m²K/W).
 */
import { rhCrit, vttStep, wufiStep, gpToSer, woonScore, woonScoreLabel } from '@/lib/mouldModels'
import { calcWallConditions, rTotaalForInsulation, type InsulationClass } from '@/lib/calculations'

// ── Deterministic PRNG so the scenario is reproducible ──────────────────────
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── Scenario parameters ──────────────────────────────────────────────────────
// Horizon defaults to 72h; override with --hours=N to explore longer windows.
const hoursArg = process.argv.find((a) => a.startsWith('--hours='))
const HOURS = Math.min(Math.max(parseInt(hoursArg?.split('=')[1] ?? '72', 10) || 72, 1), 24 * 60)

// Mean outdoor temperature (°C); a ±1.5°C diurnal swing is layered on top.
const outdoorArg = process.argv.find((a) => a.startsWith('--outdoor='))
const OUTDOOR_MEAN = parseFloat(outdoorArg?.split('=')[1] ?? '4.5')
const INSULATION: InsulationClass = 'poor' // pre-1975, uninsulated → coldest wall
const R_TOTAAL = rTotaalForInsulation(INSULATION)
const K2 = 1.0 // gypsum / standard interior surface (MATERIAL_K2.gypsum)

interface Sample {
  ts: number
  tIn: number // indoor air temperature (°C)
  rhIn: number // indoor air RH (%)
  co2: number // indoor CO₂ (ppm)
  tOut: number // outdoor temperature (°C)
  tWand: number // reconstructed wall-surface temperature (°C)
  rhWand: number // reconstructed wall-surface RH (%)
}

/**
 * Build a realistic poorly-ventilated winter bedroom/bathroom over `hours` hours
 * at 1 sample/hour. Nocturnal RH peak (83–88%, occupants exhaling moisture,
 * windows shut), daytime dip (72–76%), CO₂ peaks morning + evening, outdoor 3–6°C.
 */
function buildScenario(hours: number): Sample[] {
  const rand = mulberry32(20260219) // "winter 2026" seed
  const start = new Date()
  start.setMinutes(0, 0, 0)
  start.setTime(start.getTime() - (hours - 1) * 3_600_000)

  const samples: Sample[] = []
  for (let i = 0; i < hours; i++) {
    const ts = start.getTime() + i * 3_600_000
    const h = new Date(ts).getHours()
    const noise = (sd: number) => (rand() - 0.5) * 2 * sd

    // Indoor temperature: cold dwelling, 17–19°C, warmest mid-afternoon.
    const tIn = +(18.0 + 1.0 * Math.sin(((h - 6) * Math.PI) / 12.0) + noise(0.2)).toFixed(1)

    // Indoor RH: nocturnal peak around 04:00, daytime trough around 16:00.
    // Centre 80%, ±5–6% diurnal swing → roughly 72–76% (day) to 83–88% (night).
    const rhBase = 80.0 + 6.0 * Math.cos(((h - 4) * Math.PI) / 12.0)
    const rhIn = +Math.max(70, Math.min(90, rhBase + noise(1.0))).toFixed(1)

    // CO₂: morning (07–09) and evening (20–23) peaks from occupancy, windows shut.
    const morning = 450 * Math.exp(-((h - 8) ** 2) / 4)
    const evening = 550 * Math.exp(-((h - 21.5) ** 2) / 6)
    const co2 = Math.round(Math.max(900, Math.min(1400, 900 + morning + evening + noise(40))))

    // Outdoor: 3–6°C, coldest pre-dawn.
    const tOut = +(OUTDOOR_MEAN + 1.5 * Math.sin(((h - 9) * Math.PI) / 12.0) + noise(0.4)).toFixed(1)

    const { T_wand, RH_wand } = calcWallConditions(tIn, rhIn, tOut, R_TOTAAL)
    samples.push({
      ts,
      tIn,
      rhIn,
      co2,
      tOut,
      tWand: +T_wand.toFixed(2),
      rhWand: +RH_wand.toFixed(2),
    })
  }
  return samples
}

interface Result extends Sample {
  mi: number // VTT Mould Index (0–6)
  gp: number // WUFI-Bio growth potential
  ser: number // surface emission rate (0–100)
  ws: number // combined WoonScore (0–100)
}

/** Run VTT + WUFI-Bio over the wall-surface series, step by step. */
function runScenario(samples: Sample[]): Result[] {
  let mi = 0.0
  let gp = 0.0
  const out: Result[] = []
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    const dtH = i === 0 ? 0.5 : 1.0 // hourly samples; matches runModels' first-step convention
    mi = vttStep(s.tWand, s.rhWand, mi, dtH, K2)
    gp = wufiStep(s.tWand, s.rhWand, gp, dtH)
    const ser = gpToSer(gp)
    out.push({ ...s, mi: +mi.toFixed(4), gp: +gp.toFixed(3), ser: +ser.toFixed(2), ws: +woonScore(mi, ser).toFixed(1) })
  }
  return out
}

// ── Reporting ────────────────────────────────────────────────────────────────
function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}-${p(d.getMonth() + 1)} ${p(d.getHours())}:00`
}

function printTable(rows: Result[]) {
  const head = ['tijd', 'T_in', 'RH_in', 'CO₂', 'T_wand', 'RH_wand', 'MI', 'GP', 'SER', 'WoonScore', 'risico']
  console.log(head.join('\t'))
  for (const r of rows) {
    console.log(
      [
        fmtTime(r.ts),
        r.tIn.toFixed(1),
        r.rhIn.toFixed(1),
        r.co2,
        r.tWand.toFixed(1),
        r.rhWand.toFixed(1),
        r.mi.toFixed(2),
        r.gp.toFixed(2),
        r.ser.toFixed(1),
        r.ws.toFixed(1),
        woonScoreLabel(r.ws).label,
      ].join('\t'),
    )
  }
}

function validateThresholds() {
  console.log('\n── Drempelvalidatie ───────────────────────────────────────────')
  console.log('VTT rhCrit(T) — kritische RH waaronder schimmelgroei = 0:')
  for (const t of [19, 17, 15, 13, 11, 9]) {
    console.log(`  T=${String(t).padStart(2)}°C  →  rhCrit = ${rhCrit(t).toFixed(2)}%`)
  }
  console.log('\nWUFI-Bio awC(T) — kritische wateractiviteit (= RH/100):')
  for (const t of [19, 13, 11]) {
    const awC = Math.max(0.7, 0.8 - 0.0007 * t)
    console.log(`  T=${String(t).padStart(2)}°C  →  awC = ${awC.toFixed(4)}  (RH_crit ≈ ${(awC * 100).toFixed(1)}%)`)
  }
}

function report(rows: Result[]) {
  if (rows.length <= 120) printTable(rows)
  else console.log(`(tabel onderdrukt voor ${rows.length} rijen — gebruik ≤120u voor de volledige uitdraai)`)

  const wsVals = rows.map((r) => r.ws)
  const cross30 = rows.find((r) => r.ws >= 30)
  const cross60 = rows.find((r) => r.ws >= 60)
  const maxWs = Math.max(...wsVals)
  const maxRow = rows[wsVals.indexOf(maxWs)]
  const last = rows[rows.length - 1]
  const pctVerhoogd = (rows.filter((r) => r.ws >= 30).length / rows.length) * 100
  const pctHoog = (rows.filter((r) => r.ws >= 60).length / rows.length) * 100
  const firstAbove80 = rows.find((r) => r.rhWand >= rhCrit(r.tWand))

  validateThresholds()

  console.log('\n── Samenvatting 72u winterscenario ─────────────────────────────')
  console.log(`Isolatieklasse:        ${INSULATION}  (R_totaal = ${R_TOTAAL} m²K/W)`)
  console.log(`Materiaal k₂:          ${K2} (gips / standaard)`)
  console.log(`Wandtemperatuur:       ${Math.min(...rows.map((r) => r.tWand)).toFixed(1)}–${Math.max(...rows.map((r) => r.tWand)).toFixed(1)}°C`)
  console.log(`Wand-RH:               ${Math.min(...rows.map((r) => r.rhWand)).toFixed(1)}–${Math.max(...rows.map((r) => r.rhWand)).toFixed(1)}%`)
  if (firstAbove80) {
    console.log(`Eerste VTT-overschrijding: ${fmtTime(firstAbove80.ts)} (RH_wand ${firstAbove80.rhWand.toFixed(1)}% ≥ rhCrit ${rhCrit(firstAbove80.tWand).toFixed(1)}%)`)
  }
  console.log(`Eind-MI:               ${last.mi.toFixed(2)} / 6`)
  console.log(`Eind-GP:               ${last.gp.toFixed(2)}  (SER ${last.ser.toFixed(1)})`)
  console.log(`MAX WoonScore:         ${maxWs.toFixed(1)}  bij ${fmtTime(maxRow.ts)}  → ${woonScoreLabel(maxWs).label}`)
  console.log(`Eind WoonScore:        ${last.ws.toFixed(1)}  → ${woonScoreLabel(last.ws).label}`)
  console.log(`Tijd ≥ 30 (verhoogd):  ${pctVerhoogd.toFixed(0)}%`)
  console.log(`Tijd ≥ 60 (hoog):      ${pctHoog.toFixed(0)}%`)
  console.log(`WoonScore ≥ 30 vanaf:  ${cross30 ? `${fmtTime(cross30.ts)} (uur ${rows.indexOf(cross30)})` : 'niet bereikt in deze horizon'}`)
  console.log(`WoonScore ≥ 60 vanaf:  ${cross60 ? `${fmtTime(cross60.ts)} (uur ${rows.indexOf(cross60)})` : 'niet bereikt in deze horizon'}`)
}

// ── Optional Supabase seed (gated) ──────────────────────────────────────────
// Inserts the simulated samples as historical air_quality readings so the live
// dashboard visualises them. Disabled unless --seed is passed AND the env-gated
// confirmation is set, so the script never writes to the DB by accident.
async function seedSupabase(rows: Result[]) {
  if (process.env.SIMULATE_WINTER_CONFIRM !== 'yes') {
    console.log('\n⚠  --seed gevraagd, maar er is NIET naar de database geschreven.')
    console.log('   Dit voegt 72 nep-metingen toe aan air_quality (zichtbaar in het dashboard).')
    console.log('   Bevestig expliciet door te draaien met:')
    console.log('     SIMULATE_WINTER_CONFIRM=yes npx tsx scripts/simulate-winter.ts --seed')
    return
  }

  const { readFileSync } = await import('node:fs')
  const { createClient } = await import('@supabase/supabase-js')

  const env: Record<string, string> = {}
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2]
  }
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  // Clone the identity (user_id, device_id) of the most recent real reading so
  // the seeded rows belong to the same RLS owner and device.
  const { data: ref, error: refErr } = await supabase
    .from('air_quality')
    .select('user_id, device_id')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  if (refErr || !ref) {
    console.error('Kon geen referentiemeting vinden om user_id/device_id over te nemen:', refErr?.message)
    return
  }

  const payload = rows.map((r) => ({
    created_at: new Date(r.ts).toISOString(),
    co2: r.co2,
    temperature: r.tIn,
    humidity: r.rhIn,
    user_id: ref.user_id,
    device_id: ref.device_id,
  }))

  const { error } = await supabase.from('air_quality').insert(payload)
  if (error) {
    console.error('Insert mislukt:', error.message)
    return
  }
  console.log(`\n✓ ${payload.length} winter-metingen toegevoegd aan air_quality (device ${ref.device_id}).`)
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const samples = buildScenario(HOURS)
  const rows = runScenario(samples)
  report(rows)

  if (process.argv.includes('--seed')) {
    await seedSupabase(rows)
  } else {
    console.log('\n(geen --seed: er is niets naar de database geschreven.)')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
