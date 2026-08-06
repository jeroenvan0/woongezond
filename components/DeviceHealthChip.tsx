'use client'
import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, WifiOff } from 'lucide-react'
import { withBase } from '@/lib/basePath'

interface Health {
  status: 'ok' | 'degraded' | 'error'
  devices?: { total: number; stale: number }
  stale_after_minutes?: number
}

/**
 * Device-liveness chip in the sidebar footer (1.2, I3). M3 built /api/health with
 * per-device staleness but no screen ever showed it — this is that screen. Amber
 * when a device is quiet, red when the health check itself fails. Polls once a
 * minute and pauses on a hidden tab so background tabs make no traffic.
 */
export default function DeviceHealthChip() {
  const [h, setH] = useState<Health | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (document.visibilityState === 'hidden') return
      try {
        const r = await fetch(withBase('/api/health'))
        const d = await r.json()
        if (!cancelled) setH(d)
      } catch {
        if (!cancelled) setH({ status: 'error' })
      }
    }
    load()
    const id = setInterval(load, 60000)
    const onVis = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  if (!h) return null

  const stale = h.devices?.stale ?? 0
  let color = 'var(--ok)'
  let Icon = Activity
  let text = h.devices ? `${h.devices.total} sensor${h.devices.total === 1 ? '' : 's'} online` : 'Systeem online'
  let title = 'Alle sensoren hebben recent gemeten'

  if (h.status === 'error') {
    color = 'var(--crit)'
    Icon = AlertTriangle
    text = 'Statuscheck mislukt'
    title = 'De health-check kon niet worden opgehaald'
  } else if (h.status === 'degraded' || stale > 0) {
    color = 'var(--warn)'
    Icon = WifiOff
    text = `${stale} sensor${stale === 1 ? '' : 's'} offline`
    title = `Geen meting in ${h.stale_after_minutes ?? 30} min van ${stale} sensor(en)`
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
