// Sticker-QR voor /start (docs/pilot-cockpit-plan.md §2b).
//   npx tsx scripts/pilot-qr.mts --code DEVICE-E98DXC [--number 1] [--base http://192.168.1.23:3005] [--out /pad/sticker.png]
// Zonder --base wordt het LAN-IP van deze Mac + poort 3005 gebruikt, zodat een telefoon op
// hetzelfde WiFi de lokale dev-server bereikt. Print ook een terminal-QR.
import QRCode from 'qrcode'
import { networkInterfaces } from 'node:os'
import { writeFileSync } from 'node:fs'

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : undefined }
const code = (arg('--code') ?? 'DEVICE-MOCK1').toUpperCase()
const lanIp = Object.values(networkInterfaces()).flat().find((n) => n && n.family === 'IPv4' && !n.internal)?.address ?? 'localhost'
const base = (arg('--base') ?? `http://${lanIp}:3005`).replace(/\/$/, '')
const url = `${base}/start?code=${encodeURIComponent(code)}`
const number = arg('--number')
const out = arg('--out') ?? `sticker-${code}.png`

await QRCode.toFile(out, url, { width: 480, margin: 2, errorCorrectionLevel: 'M' })
console.log(await QRCode.toString(url, { type: 'terminal', small: true }))
console.log(`URL:  ${url}\nPNG:  ${out}` + (number ? `\nWiFi: Woongezond-${String(number).padStart(2, '0')}   (setup-netwerk van de sensor, op de sticker zetten)` : ''))
