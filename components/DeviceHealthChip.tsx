'use client'
import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, WifiOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

// Zelfde grens als /api/health: een sensor meet elke minuut, 30 min stilte is geen blip meer.
const STALE_AFTER_MIN = 30

interface Health {
  status: 'ok' | 'degraded' | 'error'
  total: number
  stale: number
}

/**
 * Device-liveness chip in the sidebar footer (1.2, I3). Amber when a sensor is quiet, red
 * when the check itself fails. Polls once a minute and pauses on a hidden tab.
 *
 * Telt alleen de sensoren die de ingelogde gebruiker mag zien (RLS op devices en
 * air_quality): een bewoner ziet zijn eigen sensor, een org-admin de sensoren van zijn org.
 * Vroeger kwam het getal uit het publieke /api/health, dat over ALLE sensoren telt — een
 * bewoner met één sensor kreeg dan "8 sensors offline" van andere huishoudens te zien.
 */
export default function DeviceHealthChip() {
  const supabase = createClient()
  const [h, setH] = useState<Health | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (document.visibilityState === 'hidden') return
      try {
        const { data: devs, error } = await supabase.from('devices').select('id').eq('active', true)
        if (error) throw error
        // Per sensor de nieuwste meting (index device_id, created_at DESC).
        const lasts = await Promise.all((devs ?? []).map(async (d: { id: string }) => {
          const { data, error: e } = await supabase.from('air_quality').select('created_at')
            .eq('device_id', d.id).order('created_at', { ascending: false }).limit(1)
          if (e) throw e
          return (data?.[0]?.created_at as string | undefined) ?? null
        }))
        const cutoff = Date.now() - STALE_AFTER_MIN * 60000
        const stale = lasts.filter((t) => !t || new Date(t).getTime() < cutoff).length
        if (!cancelled) setH({ status: stale ? 'degraded' : 'ok', total: lasts.length, stale })
      } catch {
        if (!cancelled) setH({ status: 'error', total: 0, stale: 0 })
      }
    }
    load()
    const id = setInterval(load, 60000)
    const onVis = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVis)
    // De shell blijft staan bij uit- en weer inloggen: tel opnieuw voor het nieuwe account.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') { setH(null); load() }
    })
    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
      sub.subscription.unsubscribe()
    }
  }, [supabase])

  // Geen sensoren (nieuw account, of uitgelogd): niets te melden.
  if (!h || (h.status !== 'error' && h.total === 0)) return null

  let color = 'var(--ok)'
  let Icon = Activity
  let text = `${h.total} sensor${h.total === 1 ? '' : 's'} online`
  let title = 'Alle sensoren hebben recent gemeten'

  if (h.status === 'error') {
    color = 'var(--crit)'
    Icon = AlertTriangle
    text = 'Statuscheck mislukt'
    title = 'De status van de sensoren kon niet worden opgehaald'
  } else if (h.stale > 0) {
    color = 'var(--warn)'
    Icon = WifiOff
    text = `${h.stale} sensor${h.stale === 1 ? '' : 's'} offline`
    title = `Geen meting in ${STALE_AFTER_MIN} min van ${h.stale} sensor(en)`
  }

  return (
    <div
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        padding: '6px 9px',
        borderRadius: 'var(--r-sm)',
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
        fontSize: 'var(--fs-xs)',
        fontWeight: 600,
        color,
      }}
    >
      <Icon size={13} style={{ flexShrink: 0 }} />
      <span className="wz-navlabel" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</span>
    </div>
  )
}
