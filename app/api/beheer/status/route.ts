import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { adminOrgs } from '@/lib/cockpit/auth'
import { log, errText } from '@/lib/logger'

// Systeemstatus voor /beheer (adminportaal, fase 1). Drie vragen die tot nu toe alleen via
// SSH te beantwoorden waren:
//
//   1. Doet de nachtelijke backup het nog?      → sync_runs (cloud, gevuld door de VPS)
//   2. Welke sensoren zijn stil gevallen?       → devices + laatste meting
//   3. Draait prod dezelfde versie als dev?     → /api/health van beide deployments
//
// Alleen org-admins; dezelfde grens als de cockpit (org_members.role = 'admin').

export const dynamic = 'force-dynamic'

const DEPLOYMENTS = [
  { key: 'prod', label: 'Productie', url: 'https://woongezond.com/admin/api/health' },
  { key: 'dev', label: 'Ontwikkel', url: 'https://dev.woongezond.com/admin/api/health' },
]

// Een sensor schrijft ~1×/minuut; 30 minuten stilte is ruim voorbij een wifi-hik.
const STALE_AFTER_MIN = 30
// De timer draait om 03:00. Na 26 uur zonder run is er een nacht overgeslagen.
const SYNC_STALE_HOURS = 26
const PROBE_TIMEOUT_MS = 5000

interface Probe {
  key: string
  label: string
  reachable: boolean
  http: number | null
  status: string | null
  commit: string | null
  built_at: string | null
  devices: { total: number; stale: number } | null
  took_ms: number
}

async function probe(d: (typeof DEPLOYMENTS)[number]): Promise<Probe> {
  const started = Date.now()
  const base = { key: d.key, label: d.label, took_ms: 0 }
  try {
    const r = await fetch(d.url, { cache: 'no-store', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    const body = await r.json().catch(() => null)
    return {
      ...base,
      reachable: true,
      http: r.status,
      status: body?.status ?? null,
      commit: body?.version?.commit ?? null,
      built_at: body?.version?.built_at ?? null,
      devices: body?.devices ?? null,
      took_ms: Date.now() - started,
    }
  } catch (e) {
    // Een onbereikbare deployment is nieuws voor de pagina, geen fout in deze route.
    log.warn('beheer', 'deployment onbereikbaar', { url: d.url, detail: errText(e) })
    return { ...base, reachable: false, http: null, status: null, commit: null, built_at: null, devices: null, took_ms: Date.now() - started }
  }
}

export async function GET() {
  const orgs = await adminOrgs()
  if (orgs === 'unauthenticated') return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (!orgs.length) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  let s
  try {
    s = createServiceClient()
  } catch (e) {
    log.error('beheer', 'service client niet beschikbaar', { detail: errText(e) })
    return NextResponse.json({ error: 'unconfigured' }, { status: 503 })
  }

  const now = Date.now()

  // ── 1. Backup ──────────────────────────────────────────────────────────────
  const { data: runs } = await s
    .from('sync_runs')
    .select('id, started_at, finished_at, status, rows_synced, tables_ok, tables_failed, duration_s, error_detail')
    .order('started_at', { ascending: false })
    .limit(10)

  const last = runs?.[0] ?? null
  const hoursSince = last ? (now - new Date(last.started_at).getTime()) / 3600000 : null
  const backup = {
    runs: runs ?? [],
    last,
    hours_since: hoursSince == null ? null : Math.round(hoursSince * 10) / 10,
    // 'unknown' = het syncscript schrijft hier nog niet naartoe; dat is iets anders dan
    // een backup die faalt, en de pagina moet dat verschil laten zien.
    verdict: !last
      ? 'unknown'
      : last.status === 'error'
        ? 'error'
        : hoursSince != null && hoursSince > SYNC_STALE_HOURS
          ? 'stale'
          : 'ok',
    stale_after_hours: SYNC_STALE_HOURS,
  }

  // ── 2. Sensoren ────────────────────────────────────────────────────────────
  const orgIds = orgs.map((o) => o.id)
  const { data: devices } = await s
    .from('devices')
    .select('id, device_number, name, active, last_seen_at, fw_version')
    .in('org_id', orgIds)
    .eq('active', true)
    .order('device_number', { ascending: true, nullsFirst: false })

  const sensors = await Promise.all(
    (devices ?? []).map(async (d: any) => {
      // last_seen_at wordt alleen door /api/ingest gezet; de oudste sensor schrijft nog via
      // het legacy-pad en heeft die kolom nooit gevuld. De laatste meting is de waarheid.
      const { data: rows } = await s
        .from('air_quality')
        .select('created_at')
        .eq('device_id', d.id)
        .order('created_at', { ascending: false })
        .limit(1)
      const lastReading = rows?.[0]?.created_at ?? null
      const minutes = lastReading ? Math.round((now - new Date(lastReading).getTime()) / 60000) : null
      return {
        id: d.id,
        device_number: d.device_number,
        name: d.name,
        fw_version: d.fw_version,
        last_reading: lastReading,
        minutes_since: minutes,
        never: lastReading == null,
        stale: minutes == null || minutes > STALE_AFTER_MIN,
      }
    }),
  )

  // ── 3. Deployments ─────────────────────────────────────────────────────────
  const deployments = await Promise.all(DEPLOYMENTS.map(probe))
  const commits = deployments.filter((d) => d.reachable && d.commit && d.commit !== 'onbekend').map((d) => d.commit)
  const deploymentsInSync = commits.length > 1 ? new Set(commits).size === 1 : null

  return NextResponse.json(
    {
      generated_at: new Date().toISOString(),
      orgs,
      backup,
      sensors: { list: sensors, stale: sensors.filter((x) => x.stale).length, total: sensors.length },
      deployments: { list: deployments, in_sync: deploymentsInSync },
      stale_after_minutes: STALE_AFTER_MIN,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
