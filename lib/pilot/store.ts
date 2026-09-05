import { createServiceClient } from '@/lib/supabase/service'
import type { HouseProfile } from '@/lib/houseProfile'
import { deriveDeviceColumns } from '@/lib/houseProfile'

// The /start wizard's view of a device, keyed by the claim code on the sticker.
// Two implementations: Supabase (the real thing, needs migrations 20260806* + 20260905*)
// and an in-memory mock for local UX testing without a database (PILOT_MOCK=1).
// Routes only ever talk to `pilotStore()`, so the mock can never leak into prod: it is
// refused outright when NODE_ENV=production.

export interface StartDevice {
  id: string
  name: string
  device_number: number | null
  last_seen_at: string | null
  last_boot_at: string | null
  registered_at: string | null   // profile_completed_at
}
export interface Contact { name: string | null; email: string | null; address_note: string | null }
export interface Telemetry { rssi?: number | null; fw?: string | null; boot_count?: number | null; uptime_s?: number | null }

export interface PilotStore {
  findByCode(code: string): Promise<StartDevice | null | 'not_deployed'>
  findById(id: string): Promise<StartDevice | null>
  // handover=true: a NEW household takes the sensor over — the previous contact row is
  // removed so reports can never reach the wrong person. Measurements stay (one series per
  // device); reports use profile_completed_at as the start of the current placement.
  saveProfile(deviceId: string, profile: HouseProfile, termsVersion: string, handover?: boolean): Promise<'ok' | 'error'>
  saveContact(deviceId: string, contact: Contact): Promise<'ok' | 'error'>
  // Mock-only ingest: returns the device if the token belongs to a mock device, else null
  // (the real ingest path lives in app/api/ingest and never calls this).
  mockIngest(token: string, t: Telemetry): StartDevice | null
}

// ---------------------------------------------------------------- mock
// Eight fixed pilot devices so the QR/sticker script and the simulator agree on codes.
export const MOCK_DEVICES = Array.from({ length: 8 }, (_, i) => {
  const n = i + 1
  return { id: `00000000-0000-4000-8000-00000000000${n}`, name: `Sensor ${n}`, device_number: n, code: `DEVICE-MOCK${n}`, token: `wgd_mock_${n}` }
})
type MockRow = StartDevice & { code: string; token: string; profile: HouseProfile | null }
const g = globalThis as unknown as { __pilotMock?: Map<string, MockRow> }
function mockRows(): Map<string, MockRow> {
  if (!g.__pilotMock) {
    g.__pilotMock = new Map(MOCK_DEVICES.map((d) => [d.code, { ...d, last_seen_at: null, last_boot_at: null, registered_at: null, profile: null }]))
  }
  return g.__pilotMock
}
const pub = (r: MockRow): StartDevice => ({ id: r.id, name: r.name, device_number: r.device_number, last_seen_at: r.last_seen_at, last_boot_at: r.last_boot_at, registered_at: r.registered_at })
const mockStore: PilotStore = {
  async findByCode(code) { const r = mockRows().get(code); return r ? pub(r) : null },
  async findById(id) { for (const r of mockRows().values()) if (r.id === id) return pub(r); return null },
  async saveProfile(id, profile) { for (const r of mockRows().values()) if (r.id === id) { r.profile = profile; r.registered_at = new Date().toISOString(); return 'ok' } return 'error' },
  async saveContact(id) { for (const r of mockRows().values()) if (r.id === id) return 'ok'; return 'error' },
  mockIngest(token, t) {
    for (const r of mockRows().values()) if (r.token === token) {
      r.last_seen_at = new Date().toISOString()
      if (t.uptime_s != null && t.uptime_s < RECENT_BOOT_UPTIME_S) r.last_boot_at = new Date(Date.now() - t.uptime_s * 1000).toISOString()
      return pub(r)
    }
    return null
  },
}

// ---------------------------------------------------------------- supabase
const DEV_COLS = 'id, name, device_number, last_seen_at, last_boot_at, profile_completed_at, active'
async function shape(s: ReturnType<typeof createServiceClient>, dev: any): Promise<StartDevice> {
  // Devices that predate last_seen_at (the two existing sensors): fall back to newest reading.
  let lastSeen: string | null = dev.last_seen_at ?? null
  if (!lastSeen) {
    const { data: r } = await s.from('air_quality').select('created_at').eq('device_id', dev.id).order('created_at', { ascending: false }).limit(1)
    lastSeen = r?.[0]?.created_at ?? null
  }
  return { id: dev.id, name: dev.name, device_number: dev.device_number ?? null, last_seen_at: lastSeen, last_boot_at: dev.last_boot_at ?? null, registered_at: dev.profile_completed_at ?? null }
}
const supabaseStore: PilotStore = {
  async findByCode(code) {
    const s = createServiceClient()
    const { data: row, error } = await s.from('device_claim_codes').select(`expires_at, devices(${DEV_COLS})`).eq('code', code).maybeSingle()
    if (error) return /relation|does not exist|schema cache/i.test(error.message) ? 'not_deployed' : null
    const dev = (row as any)?.devices
    if (!dev || ((row as any).expires_at && new Date((row as any).expires_at) < new Date())) return null
    if (dev.active === false) return null   // a retired sensor cannot be (re)registered
    return shape(s, dev)
  },
  async findById(id) {
    const s = createServiceClient()
    const { data: dev } = await s.from('devices').select(DEV_COLS).eq('id', id).maybeSingle()
    return dev && dev.active !== false ? shape(s, dev) : null
  },
  async saveProfile(id, profile, termsVersion, handover) {
    const s = createServiceClient()
    const now = new Date().toISOString()
    if (handover) { const { error: cErr } = await s.from('device_contacts').delete().eq('device_id', id); if (cErr && !/relation|schema cache/i.test(cErr.message)) return 'error' }
    const { error } = await s.from('devices')
      .update({ house_profile: profile, profile_completed_at: now, terms_accepted_at: now, terms_version: termsVersion, ...deriveDeviceColumns(profile), updated_at: now })
      .eq('id', id)
    return error ? 'error' : 'ok'
  },
  async saveContact(id, c) {
    const s = createServiceClient()
    const now = new Date().toISOString()
    const { error } = await s.from('device_contacts').upsert(
      { device_id: id, name: c.name, email: c.email, address_note: c.address_note, report_consent_at: c.email ? now : null, source: 'wizard', updated_at: now },
      { onConflict: 'device_id' },
    )
    return error ? 'error' : 'ok'
  },
  mockIngest() { return null },
}

// A reading with a small uptime means the sensor was just (re)plugged. Overwriting an
// existing registration is allowed only within OVERWRITE_WINDOW_MIN of such a boot: proof
// that whoever is re-registering has the device in hand, not just a photo of the sticker.
export const RECENT_BOOT_UPTIME_S = 180
export const OVERWRITE_WINDOW_MIN = 10
export function bootedRecently(d: StartDevice, now = Date.now()): boolean {
  return d.last_boot_at != null && now - new Date(d.last_boot_at).getTime() <= OVERWRITE_WINDOW_MIN * 60 * 1000
}

export function pilotMockEnabled(): boolean {
  return process.env.PILOT_MOCK === '1' && process.env.NODE_ENV !== 'production'
}
export function pilotStore(): PilotStore {
  return pilotMockEnabled() ? mockStore : supabaseStore
}
