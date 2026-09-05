// Nepsensor: doet wat de Feather-firmware straks doet — elke N seconden een meting POSTen
// naar /api/ingest met zijn device-token (docs/pilot-feather-s3-plan.md §Firmware-contract).
//   PILOT_MOCK=1 npm run dev                       # in een andere terminal
//   npx tsx scripts/pilot-sim.mts --token wgd_mock_1 [--base http://localhost:3005] [--every 10] [--once]
// Werkt ook tegen een echte server met een echt token uit /vloot/koppelen.
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : undefined }
const token = arg('--token') ?? 'wgd_mock_1'
const base = (arg('--base') ?? 'http://localhost:3005').replace(/\/$/, '')
const every = Number(arg('--every') ?? 10) * 1000
const once = process.argv.includes('--once')

let boot = 1, t0 = Date.now()
// Een slaapkamer-achtige curve: CO₂ loopt langzaam op, ademt mee met een sinus van ~90 min.
function reading() {
  const min = (Date.now() - t0) / 60000
  const co2 = Math.round(650 + 250 * Math.sin(min / 14) + min * 4 + (Math.random() - 0.5) * 40)
  return { co2: Math.max(400, co2), temperature: +(20.5 + Math.sin(min / 30) * 0.8 + (Math.random() - 0.5) * 0.2).toFixed(2), humidity: +(52 + Math.sin(min / 20) * 4 + (Math.random() - 0.5)).toFixed(2), rssi: -55 - Math.round(Math.random() * 15), fw: 'sim-0.1.0', boot_count: boot, uptime_s: Math.round((Date.now() - t0) / 1000) }
}
async function post() {
  const body = reading()
  try {
    const r = await fetch(`${base}/api/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-device-token': token }, body: JSON.stringify(body) })
    const d = await r.json().catch(() => ({}))
    console.log(new Date().toLocaleTimeString(), r.status, JSON.stringify(body), '→', JSON.stringify(d))
  } catch (e) { console.log(new Date().toLocaleTimeString(), 'fout', (e as Error).message) }
}
await post()
if (!once) setInterval(post, every)
