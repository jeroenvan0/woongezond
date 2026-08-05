// Freshness contract for reported values (Finding A1).
//
// The dashboard KPI cards render the newest single reading. During the 56-hour
// outage of 2026-08-03→05 that reading was two days old, yet the cards still showed
// a green "Goed" while the footer claimed "bijgewerkt elke 60s". This module is the
// one rule that decides, from a reading's age, whether it may still carry a status
// label — so a stale reading can never render as current.
//
// OFFLINE_AFTER_MIN is deliberately the SAME 60-minute threshold as the
// `device_offline` alert in app/api/notifications/check/route.ts. Screen and alert
// must agree: if the resident is told the sensor is offline by e-mail, the dashboard
// must not still be showing a confident green number, and vice-versa. If that
// constant changes, change it in both places.

export const AGING_AFTER_MIN = 15 // past normal 60s jitter — start showing the age plainly
export const OFFLINE_AFTER_MIN = 60 // matches the device_offline alert
export const OFFLINE_LONG_HOURS = 24 // beyond a day, show the date rather than a duration

export type FreshnessState = 'fresh' | 'aging' | 'offline' | 'unknown'

export interface Freshness {
  state: FreshnessState
  minutesSince: number | null
  /** True once the reading is too old to carry a status label. */
  offline: boolean
  /** Whether a status label (Goed/Verhoogd/…) may be shown for this reading. */
  showStatus: boolean
  /** Human "2 min geleden" / "3 uur geleden" / "sinds 3 aug 14:32". */
  ago: string
  /** Absolute clock time of the reading, e.g. "14:32". */
  clock: string
  /** One-line staleness message for the offline state. */
  offlineMessage: string
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

export function timeAgoNl(minutes: number): string {
  if (minutes < 1) return 'zojuist'
  if (minutes < 60) return `${minutes} min geleden`
  const h = Math.floor(minutes / 60)
  if (h < 24) return `${h} uur geleden`
  const d = Math.floor(h / 24)
  return `${d} ${d === 1 ? 'dag' : 'dagen'} geleden`
}

/**
 * Classify a reading by age. Pure and deterministic so it can be unit-tested and
 * shared by the KPI cards and any other surface that reports a value.
 */
export function freshness(lastTs: Date | number | string | null | undefined, now: number = Date.now()): Freshness {
  if (lastTs == null) {
    return {
      state: 'unknown',
      minutesSince: null,
      offline: true,
      showStatus: false,
      ago: 'geen meting',
      clock: '—',
      offlineMessage: 'Nog geen meting ontvangen',
    }
  }
  const ts = lastTs instanceof Date ? lastTs.getTime() : new Date(lastTs).getTime()
  const d = new Date(ts)
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const minutesSince = Math.max(0, Math.floor((now - ts) / 60000))

  let state: FreshnessState = 'fresh'
  if (minutesSince >= OFFLINE_AFTER_MIN) state = 'offline'
  else if (minutesSince >= AGING_AFTER_MIN) state = 'aging'

  const offline = state === 'offline'
  const hoursSince = minutesSince / 60

  let ago: string
  let offlineMessage = ''
  if (offline && hoursSince >= OFFLINE_LONG_HOURS) {
    const date = d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
    ago = `sinds ${date} ${clock}`
    offlineMessage = `Sensor offline sinds ${date} ${clock}`
  } else {
    ago = timeAgoNl(minutesSince)
    offlineMessage = offline ? `Sensor offline — laatste meting ${ago}` : ''
  }

  return {
    state,
    minutesSince,
    offline,
    showStatus: !offline, // a stale reading never renders a status label
    ago,
    clock,
    offlineMessage,
  }
}
