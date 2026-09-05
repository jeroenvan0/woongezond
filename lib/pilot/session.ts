import { createHmac, timingSafeEqual } from 'crypto'

// Short-lived, signed session for the /start wizard (docs/pilot-cockpit-plan.md §2b).
//
// The sticker code is a stable identifier printed on the device, so it must not be the
// thing that authorises writes. Instead /api/devices/status exchanges a valid code for a
// session token bound to ONE device id and valid for 30 minutes; /api/devices/profile
// accepts only that token. Stateless HMAC — nothing to store, nothing to clean up, and a
// leaked token expires by itself. Key: PILOT_SESSION_SECRET, else CRON_SECRET, else a
// derivation of the service-role key (never the key itself).

const TTL_S = 30 * 60

function key(): string {
  const k = process.env.PILOT_SESSION_SECRET || process.env.CRON_SECRET
  if (k) return k
  const srk = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!srk) throw new Error('no session key configured')
  return createHmac('sha256', srk).update('pilot-session').digest('hex')
}
function sign(payload: string): string {
  return createHmac('sha256', key()).update(payload).digest('base64url')
}

export function issueSession(deviceId: string, now = Date.now()): { token: string; expires_at: string } {
  const exp = Math.floor(now / 1000) + TTL_S
  const payload = `${deviceId}.${exp}`
  return { token: `wgs_${Buffer.from(payload).toString('base64url')}.${sign(payload)}`, expires_at: new Date(exp * 1000).toISOString() }
}

export function verifySession(token: unknown, now = Date.now()): { deviceId: string } | null {
  if (typeof token !== 'string' || !token.startsWith('wgs_')) return null
  const [body, sig] = token.slice(4).split('.')
  if (!body || !sig) return null
  const payload = Buffer.from(body, 'base64url').toString()
  const expected = sign(payload)
  const a = Buffer.from(sig), b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  const [deviceId, expStr] = payload.split('.')
  if (!deviceId || !/^\d+$/.test(expStr ?? '')) return null
  if (Number(expStr) * 1000 < now) return null
  return { deviceId }
}
