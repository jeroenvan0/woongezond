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
  profile_completed: boolean
}
export interface Telemetry { rssi?: number | null; fw?: string | null; boot_count?: number | null }

export interface PilotStore {
  findByCode(code: string): Promise<StartDevice | null | 'not_deployed'>
  saveProfile(code: string, profile: HouseProfile): Promise<'ok' | 'code_unknown' | 'error'>
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
    g.__pilotMock = new Map(MOCK_DEVICES.map((d) => [d.code, { ...d, last_seen_at: null, profile_completed: false, profile: null }]))
  }
  return g.__pilotMock
}
const mockStore: PilotStore = {
  async findByCode(code) { const r = mockRows().get(code); return r ? { id: r.id, name: r.name, device_number: r.device_number, last_seen_at: r.last_seen_at, profile_completed: r.profile_completed } : null },
  async saveProfile(code, profile) { const r = mockRows().get(code); if (!r) return 'code_unknown'; r.profile = profile; r.profile_completed = true; return 'ok' },
  mockIngest(token) { for (const r of mockRows().values()) if (r.token === token) { r.last_seen_at = new Date().toISOString(); return r } return null },
}

// ---------------------------------------------------------------- supabase
const supabaseStore: PilotStore = {
  async findByCode(code) {
    const s = createServiceClient()
    const { data: row, error } = await s.from('device_claim_codes')
      .select('expires_at, devices(id, name, device_number, last_seen_at, profile_completed_at)')
      .eq('code', code).maybeSingle()
    if (error) return /relation|does not exist|schema cache/i.test(error.message) ? 'not_deployed' : null
    const dev = (row as any)?.devices
    if (!dev || ((row as any).expires_at && new Date((row as any).expires_at) < new Date())) return null
    // Devices that predate last_seen_at (the two existing sensors): fall back to newest reading.
    let lastSeen: string | null = dev.last_seen_at ?? null
    if (!lastSeen) {
      const { data: r } = await s.from('air_quality').select('created_at').eq('device_id', dev.id).order('created_at', { ascending: false }).limit(1)
      lastSeen = r?.[0]?.created_at ?? null
    }
    return { id: dev.id, name: dev.name, device_number: dev.device_number ?? null, last_seen_at: lastSeen, profile_completed: dev.profile_completed_at != null }
  },
  async saveProfile(code, profile) {
    const s = createServiceClient()
    const { data: row, error } = await s.from('device_claim_codes').select('device_id, expires_at').eq('code', code).maybeSingle()
    if (error) return 'error'
    if (!row || (row.expires_at && new Date(row.expires_at) < new Date())) return 'code_unknown'
    const { error: upErr } = await s.from('devices')
      .update({ house_profile: profile, profile_completed_at: new Date().toISOString(), ...deriveDeviceColumns(profile), updated_at: new Date().toISOString() })
      .eq('id', row.device_id)
    return upErr ? 'error' : 'ok'
  },
  mockIngest() { return null },
}

export function pilotMockEnabled(): boolean {
  return process.env.PILOT_MOCK === '1' && process.env.NODE_ENV !== 'production'
}
export function pilotStore(): PilotStore {
  return pilotMockEnabled() ? mockStore : supabaseStore
}
