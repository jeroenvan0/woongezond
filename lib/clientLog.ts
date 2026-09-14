'use client'
import { withBase } from '@/lib/basePath'

// Mislukte data-ophalingen in de browser melden aan de server, zodat ze in de journal
// terechtkomen (journalctl -u woongezond-react -o cat | jq 'select(.scope=="client")').
//
// Waarom: op 2026-09-14 kreeg het dashboard een 429 van NGINX (zone supabase_api, 60/min per
// IP, gedeeld met de Supabase-proxy). De app zag daar niets van — de request kwam nooit bij
// Next aan — dus het enige spoor was de gele banner in de browser en nginx' error.log. Zo'n
// storing hoort in onze eigen logs te staan, met gebruiker en pad.
//
// Gedrag: één melding per (soort, status, pad) per minuut per tab, met een korte vertraging
// bij een 429 — de emmer is op dat moment leeg en de melding zelf zou ook afketsen.

export interface FetchFailure {
  kind: 'auth' | 'rate-limited' | 'server' | 'network'
  status?: number
  /** Het pad dat mislukte, bv. "/api/data?minutes=1440". Zonder pad: alleen de pagina. */
  path?: string
}

const recent = new Map<string, number>()
const DEDUPE_MS = 60_000

export function reportFetchFailure(f: FetchFailure) {
  if (typeof window === 'undefined') return
  const now = Date.now()
  const key = `${f.kind}:${f.status ?? ''}:${f.path ?? ''}`
  const last = recent.get(key)
  if (last && now - last < DEDUPE_MS) return
  recent.set(key, now)
  for (const [k, t] of recent) if (now - t > DEDUPE_MS) recent.delete(k)

  const body = JSON.stringify({
    kind: f.kind,
    status: f.status ?? null,
    path: (f.path ?? '').slice(0, 300),
    page: window.location.pathname.slice(0, 200),
    at: new Date(now).toISOString(),
  })
  const delay = f.status === 429 ? 4000 + Math.random() * 3000 : 300
  const send = (attempt: number) => {
    fetch(withBase('/api/client-log'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
      .then((r) => { if (r.status === 429 && attempt < 2) setTimeout(() => send(attempt + 1), 15_000) })
      .catch(() => {})
  }
  setTimeout(() => send(0), delay)
}

/** Test seam. */
export function __resetClientLog() { recent.clear() }
