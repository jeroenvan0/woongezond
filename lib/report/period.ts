// Weekgrenzen in Europe/Amsterdam. De timer draait maandagochtend en rapporteert de
// afgelopen volle week: [vorige maandag 00:00, deze maandag 00:00). Pure functies, getest
// rond de zomer-/wintertijdwissel (tests/reportPeriod.test.ts).

const TZ = 'Europe/Amsterdam'

interface Ymd { y: number; m: number; d: number }

/** Kalenderdatum + weekdag (0=zo…6=za) van een instant in de tijdzone. */
export function zonedDate(instant: Date, tz = TZ): Ymd & { weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' }).formatToParts(instant)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
  return { y: +get('year'), m: +get('month'), d: +get('day'), weekday: wd }
}

/** Het instant van middernacht (lokale tijd in tz) op de gegeven kalenderdag. */
export function zonedMidnight({ y, m, d }: Ymd, tz = TZ): Date {
  // Start bij UTC-middernacht en corrigeer voor het zone-offset op dat moment; twee
  // iteraties dekken de dag waarop het offset zelf verandert.
  let guess = Date.UTC(y, m - 1, d)
  for (let i = 0; i < 2; i++) {
    const local = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(guess))
    const get = (t: string) => +(local.find((p) => p.type === t)?.value ?? 0)
    const localMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
    guess -= localMs - Date.UTC(y, m - 1, d)
  }
  return new Date(guess)
}

const addDays = ({ y, m, d }: Ymd, n: number): Ymd => { const t = new Date(Date.UTC(y, m - 1, d + n)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() } }
export const ymdKey = ({ y, m, d }: Ymd) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

export interface WeekPeriod { start: Date; end: Date; startKey: string; endKey: string }

/** De laatste volle week (ma t/m zo) vóór `now`, in Europe/Amsterdam. */
export function lastFullWeek(now = new Date(), tz = TZ): WeekPeriod {
  const today = zonedDate(now, tz)
  const daysSinceMonday = (today.weekday + 6) % 7          // ma=0 … zo=6
  const thisMonday = addDays(today, -daysSinceMonday)
  const prevMonday = addDays(thisMonday, -7)
  return { start: zonedMidnight(prevMonday, tz), end: zonedMidnight(thisMonday, tz), startKey: ymdKey(prevMonday), endKey: ymdKey(addDays(thisMonday, -1)) }
}

/** De lopende 7 dagen tot nu — voor "nu versturen" vanuit de cockpit. */
export function rollingWeek(now = new Date(), tz = TZ): WeekPeriod {
  const today = zonedDate(now, tz)
  const start = addDays(today, -7)
  return { start: zonedMidnight(start, tz), end: now, startKey: ymdKey(start), endKey: ymdKey(today) }
}
