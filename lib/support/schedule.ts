import { zonedDate, zonedMidnight } from '@/lib/report/period'

// Stand 'delayed' (docs/support-assistant.md): een niet-geëscaleerd voorstel gaat vanzelf
// DELAY_MIN na binnenkomst, maar nooit 's nachts — wat tussen QUIET_FROM en QUIET_TO valt,
// schuift naar QUIET_TO de volgende ochtend. Escalaties krijgen nooit een verzendmoment.

export const DELAY_MIN = Number(process.env.SUPPORT_DELAY_MIN ?? 120)
const QUIET_FROM = 22   // 22:00
const QUIET_TO = 8      // 08:00
const TZ = 'Europe/Amsterdam'

function hourIn(d: Date, tz = TZ): number {
  return +new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(d)
}

export function scheduledSendAt(receivedAt: Date, delayMin = DELAY_MIN, tz = TZ): Date {
  const t = new Date(receivedAt.getTime() + delayMin * 60000)
  const h = hourIn(t, tz)
  if (h >= QUIET_FROM || h < QUIET_TO) {
    const day = zonedDate(t, tz)
    const base = h >= QUIET_FROM ? { y: day.y, m: day.m, d: day.d + 1 } : { y: day.y, m: day.m, d: day.d }
    const next = new Date(Date.UTC(base.y, base.m - 1, base.d))            // normaliseer d+1 over maandgrens
    return new Date(zonedMidnight({ y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() }, tz).getTime() + QUIET_TO * 3600000)
  }
  return t
}
