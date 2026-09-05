// Seed voor de ECHTE database (na migraties 20260806* + 20260905120000):
// organisatie "Pilot", jij als admin, en 8 apparaten met nummer, token en koppelcode.
//   node --env-file=.env.local node_modules/.bin/tsx scripts/pilot-seed.mts --admin woongezond@vostech.group [--count 8] [--dry]
// Idempotent op device_number: bestaande nummers worden overgeslagen. Print een tabel voor de stickers.
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : undefined }
const adminEmail = arg('--admin') ?? 'woongezond@vostech.group'
const count = Number(arg('--count') ?? 8)
const dry = process.argv.includes('--dry')
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const genCode = () => 'DEVICE-' + Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('')

const { data: users } = await s.auth.admin.listUsers()
const admin = users.users.find((u) => u.email === adminEmail)
if (!admin) throw new Error(`geen user met e-mail ${adminEmail}`)

let { data: org } = await s.from('organizations').select('id,name').eq('name', 'Pilot').maybeSingle()
if (!org) { if (dry) { console.log('zou org Pilot aanmaken'); process.exit(0) } const r = await s.from('organizations').insert({ name: 'Pilot' }).select('id,name').single(); if (r.error) throw r.error; org = r.data }
const mem = await s.from('org_members').select('id').eq('org_id', org.id).eq('user_id', admin.id).maybeSingle()
if (!mem.data && !dry) { const r = await s.from('org_members').insert({ org_id: org.id, user_id: admin.id, role: 'admin' }); if (r.error) throw r.error }

const rows: string[] = []
for (let n = 1; n <= count; n++) {
  const ex = await s.from('devices').select('id,name,device_claim_codes(code,used_at)').eq('device_number', n).maybeSingle()
  if (ex.data) { rows.push(`${String(n).padStart(2)}  ${ex.data.name.padEnd(14)} bestaat al   code ${(ex.data as any).device_claim_codes?.find((c: any) => !c.used_at)?.code ?? '-'}`); continue }
  if (dry) { rows.push(`${String(n).padStart(2)}  zou aanmaken`); continue }
  const token = `wgd_${randomBytes(24).toString('hex')}`
  const dev = await s.from('devices').insert({ org_id: org.id, name: `Sensor ${n}`, device_number: n, insulation: 'poor', ingest_token: token, type: 'SCD41' }).select('id').single()
  if (dev.error) throw dev.error
  let code = ''
  for (let i = 0; i < 5 && !code; i++) { const c = genCode(); const r = await s.from('device_claim_codes').insert({ device_id: dev.data.id, code: c }); if (!r.error) code = c }
  rows.push(`${String(n).padStart(2)}  Sensor ${n}       code ${code}   token ${token}`)
}
console.log(`org ${org.name} (${org.id}), admin ${adminEmail}\n` + rows.join('\n'))
