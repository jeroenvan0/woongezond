// Weekrapport per sensor bekijken (en optioneel versturen) zonder de app te draaien.
//   npm run report:preview -- --device 1                 # schrijft .html/.txt naar --out
//   npm run report:preview -- --device 1 --send          # verstuurt via Resend naar device_contacts.email
//   npm run report:preview -- --device 1 --to jij@x.nl   # verstuurt naar een testadres
//   --days 7 (standaard), --out ./tmp/rapport
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildWeeklyDeviceReport } from '../lib/report/weeklyDeviceReport'
import { sendEmail } from '../lib/email'

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : undefined }
const number = Number(arg('--device') ?? 1)
const days = Number(arg('--days') ?? 7)
const out = arg('--out') ?? join(process.cwd(), 'tmp', 'rapport')
const send = process.argv.includes('--send')
const to = arg('--to')

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const { data: dev, error } = await s.from('devices').select('id, device_number, location, house_profile, device_contacts(name, email, report_consent_at)').eq('device_number', number).maybeSingle()
if (error) throw error
if (!dev) { console.error(`geen device met nummer ${number}`); process.exit(1) }

const end = new Date()
const start = new Date(end.getTime() - days * 86400000)
const rows: any[] = []
for (let from = 0; ; from += 1000) {
  const { data, error: e } = await s.from('air_quality').select('created_at, co2, temperature, humidity').eq('device_id', dev.id).gte('created_at', start.toISOString()).lte('created_at', end.toISOString()).order('created_at').range(from, from + 999)
  if (e) throw e
  rows.push(...(data ?? []))
  if (!data || data.length < 1000) break
}

const contact = Array.isArray((dev as any).device_contacts) ? (dev as any).device_contacts[0] : (dev as any).device_contacts
const profile = (dev as any).house_profile ?? null
const report = buildWeeklyDeviceReport(rows, { number: dev.device_number, room: profile?.room ?? dev.location, profile }, { name: contact?.name ?? null }, { start, end, kind: days <= 1 ? 'dag' : days <= 7 ? 'week' : 'maand' })

mkdirSync(out, { recursive: true })
const base = join(out, `weekrapport-sensor-${String(number).padStart(2, '0')}`)
writeFileSync(`${base}.html`, report.html)
writeFileSync(`${base}.txt`, report.text)
console.log(`${rows.length} metingen · verdict ${report.verdict}`)
console.log(`onderwerp: ${report.subject}`)
console.log(`geschreven: ${base}.html / .txt`)

if (send || to) {
  const addr = to ?? contact?.email
  if (!addr) { console.error('geen e-mailadres (device_contacts.email leeg en geen --to)'); process.exit(1) }
  if (!to && !contact?.report_consent_at) { console.error('bewoner heeft geen rapport-toestemming gegeven; gebruik --to voor een test'); process.exit(1) }
  const ok = await sendEmail({ to: addr, subject: report.subject, text: report.text, html: report.html })
  console.log(ok ? `verstuurd naar ${addr}` : 'NIET verstuurd (RESEND_API_KEY ontbreekt of ongeldig — zie logs)')
}
