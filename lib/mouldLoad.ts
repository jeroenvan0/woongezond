'use client'
import { withBase } from '@/lib/basePath'
import type { HouseProfile } from '@/lib/houseProfile'
import type { MouldInputs } from '@/lib/mouldRisk'
import { getSeries, type SeriesError } from '@/lib/useSeries'
import { reportFetchFailure } from '@/lib/clientLog'

// Haalt de invoer voor lib/mouldRisk.ts op voor één sensor: 90 dagen binnenklimaat
// (3-uursbuckets, zie air_quality_bucketed) en uurlijks buitenweer + huisprofiel.
// Gedeeld door de schimmelpagina en de cockpit, zodat beide hetzelfde getal tonen.

export const MOULD_WINDOW_MIN = 90 * 1440

export type MouldLoadResult =
  | { ok: true; inputs: MouldInputs; readings: number; spanDays: number }
  | { ok: false; status?: number; network?: boolean }

export async function fetchMouldInputs(device: string | null): Promise<MouldLoadResult> {
  const q = device ? '&device=' + encodeURIComponent(device) : ''
  const weatherPath = '/api/weather/history?minutes=' + MOULD_WINDOW_MIN + q
  try {
    // De metingen via getSeries: dezelfde cache/dedupe als het dashboard, zodat dashboard,
    // schimmelpagina en cockpit het 90-dagenvenster één keer ophalen in plaats van ieder apart.
    const [d, wr] = await Promise.all([
      getSeries(MOULD_WINDOW_MIN, false, device).catch((e: SeriesError) => { throw e }),
      fetch(withBase(weatherPath)),
    ])
    if (!wr.ok) reportFetchFailure({ kind: wr.status === 429 ? 'rate-limited' : wr.status === 401 ? 'auth' : 'server', status: wr.status, path: weatherPath })
    const w = wr.ok ? await wr.json().catch(() => ({})) : {}
    const indoor = (d.rows ?? [])
      .filter((x: any) => x.temperature != null && x.humidity != null)
      .map((x: any) => ({ ts: new Date(x.created_at).getTime(), t: +x.temperature, rh: +x.humidity }))
    const outdoor = (w.rows ?? [])
      .filter((x: any) => x.temp != null)
      .map((x: any) => ({ ts: new Date(x.observed_at).getTime(), t: +x.temp, rh: x.humidity == null ? null : +x.humidity }))
    const spanDays = indoor.length > 1 ? (indoor[indoor.length - 1].ts - indoor[0].ts) / 86_400_000 : 0
    return {
      ok: true,
      readings: indoor.length,
      spanDays,
      inputs: { indoor, outdoor, profile: (w.profile ?? null) as Partial<HouseProfile> | null, insulation: w.insulation ?? null },
    }
  } catch (e) {
    const status = (e as SeriesError)?.status
    if (status == null) return { ok: false, network: true }
    return { ok: false, status }
  }
}
