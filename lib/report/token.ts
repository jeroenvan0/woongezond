import { createHmac, timingSafeEqual } from 'crypto'
import { pilotKey } from '@/lib/pilot/session'

// Ondertekende rapportlink (docs/pilot-cockpit-plan.md §2c): `/rapport?t=wgr_…`.
// Zelfde HMAC-basis als de /start-sessie, maar een eigen prefix én een eigen
// domeinscheiding in de handtekening, zodat een rapporttoken nooit de wizard in kan en
// andersom. 30 dagen geldig, gebonden aan één device; stateless.

const TTL_S = 30 * 24 * 3600
const sign = (payload: string) => createHmac('sha256', pilotKey()).update(`report:${payload}`).digest('base64url')

export function issueReportToken(deviceId: string, now = Date.now(), ttlS = TTL_S): { token: string; expires_at: string } {
  const exp = Math.floor(now / 1000) + ttlS
  const payload = `${deviceId}.${exp}`
  return { token: `wgr_${Buffer.from(payload).toString('base64url')}.${sign(payload)}`, expires_at: new Date(exp * 1000).toISOString() }
}

export function verifyReportToken(token: unknown, now = Date.now()): { deviceId: string } | null {
  if (typeof token !== 'string' || !token.startsWith('wgr_')) return null
  const [body, sig] = token.slice(4).split('.')
  if (!body || !sig) return null
  const payload = Buffer.from(body, 'base64url').toString()
  const a = Buffer.from(sig), b = Buffer.from(sign(payload))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  const [deviceId, expStr] = payload.split('.')
  if (!deviceId || !/^\d+$/.test(expStr ?? '') || Number(expStr) * 1000 < now) return null
  return { deviceId }
}
