// Stickers voor ALLE geprovisionede sensoren in één keer: per sensor een PNG-QR en één
// printbaar HTML-vel (nummer, QR, code, naam van het setup-WiFi).
//   npm run pilot:stickers -- [--base https://woongezond.com/admin] [--out ~/Desktop/woongezond-stickers]
// Zonder --base: het LAN-IP van deze Mac + poort 3005 (lokaal testen). Voor de echte
// stickers: --base https://woongezond.com/admin (of dev.woongezond.com/admin).
import { createClient } from '@supabase/supabase-js'
import QRCode from 'qrcode'
import { networkInterfaces } from 'node:os'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : undefined }
const lanIp = Object.values(networkInterfaces()).flat().find((n) => n && n.family === 'IPv4' && !n.internal)?.address ?? 'localhost'
const base = (arg('--base') ?? `http://${lanIp}:3005`).replace(/\/$/, '')
const out = (arg('--out') ?? join(process.env.HOME ?? '.', 'Desktop', 'woongezond-stickers')).replace(/^~/, process.env.HOME ?? '')
mkdirSync(out, { recursive: true })

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const { data, error } = await s.from('devices').select('device_number, name, device_claim_codes(code, used_at, expires_at)').not('device_number', 'is', null).order('device_number')
if (error) throw error

const cards: string[] = []
for (const d of data ?? []) {
  const code = (d as any).device_claim_codes?.find((c: any) => !c.used_at && (!c.expires_at || new Date(c.expires_at) > new Date()))?.code
  if (!code) { console.log(`${d.device_number}: geen open koppelcode — overgeslagen`); continue }
  const nr = String(d.device_number).padStart(2, '0')
  const url = `${base}/start?code=${encodeURIComponent(code)}`
  const png = join(out, `sticker-sensor-${nr}.png`)
  await QRCode.toFile(png, url, { width: 600, margin: 2, errorCorrectionLevel: 'M' })
  const dataUrl = await QRCode.toDataURL(url, { width: 360, margin: 1, errorCorrectionLevel: 'M' })
  cards.push(`<div class="card"><img src="${dataUrl}" alt="QR sensor ${nr}"><div class="t"><div class="nr">Sensor ${nr}</div><div class="l">Scan om te starten</div><div class="k">${code}</div><div class="l">Setup-WiFi</div><div class="w">Woongezond-${nr}</div></div></div>`)
  console.log(`${nr}  ${code.padEnd(14)} ${url}`)
}
const html = `<!doctype html><meta charset="utf-8"><title>Woongezond stickers</title><style>
@page{size:A4;margin:12mm} body{font-family:Inter,system-ui,sans-serif;color:#1A211E;margin:0}
h1{font-size:14px;margin:0 0 10px} .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8mm}
.card{display:flex;gap:6mm;align-items:center;border:1px dashed #9aa;border-radius:4mm;padding:5mm;break-inside:avoid;background:#fff}
.card img{width:34mm;height:34mm} .nr{font-size:20px;font-weight:800;color:#0B7A5C} .l{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#4A5A53;margin-top:4px}
.k{font-family:ui-monospace,Menlo,monospace;font-size:13px;font-weight:700} .w{font-family:ui-monospace,Menlo,monospace;font-size:13px;font-weight:700}
.foot{font-size:9px;color:#4A5A53;margin-top:8mm}
</style><h1>Woongezond · sensorstickers (${base})</h1><div class="grid">${cards.join('')}</div><p class="foot">Print op A4, knip langs de stippellijn. Elke QR hoort bij precies één sensor: plak sticker N op sensor N.</p>`
writeFileSync(join(out, 'stickers.html'), html)
console.log(`\n${cards.length} stickers → ${out}\nPrintvel: ${join(out, 'stickers.html')}`)
