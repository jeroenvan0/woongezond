'use client'
import { useEffect, useState } from 'react'
import { Moon } from 'lucide-react'
import { withBase } from '@/lib/basePath'
import { nightForecast, NightOutlook } from '@/lib/nightForecast'

const COLORS = { ok: 'var(--ok)', warning: 'var(--warn)', critical: 'var(--crit)' } as const

export default function NightOutlookCard() {
  const [outlook, setOutlook] = useState<NightOutlook | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        const r = await fetch(withBase('/api/data?minutes=20160')) // 14 days → enough nights
        const d = await r.json()
        const readings = (d.rows ?? [])
          .filter((x: any) => x.co2 != null && x.created_at)
          .map((x: any) => ({ timestamp: new Date(x.created_at).getTime(), co2: +x.co2 }))
        setOutlook(nightForecast(readings, Date.now()))
      } catch {
        setOutlook(null)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const wrap: React.CSSProperties = {
    background: 'var(--accent-fill)',
    border: '1px solid var(--border)',
    borderLeft: '3px solid var(--accent)',
    borderRadius: 'var(--r-lg)',
    padding: '16px 18px',
    marginBottom: 14,
  }
  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <Moon size={16} color="var(--accent)" />
      <span style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text)' }}>Nacht-vooruitblik</span>
      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>ventilatie-advies voor vannacht</span>
    </div>
  )

  if (loading)
    return (
      <div style={wrap}>
        {header}
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>Nachtpatroon analyseren…</div>
      </div>
    )

  if (!outlook)
    return (
      <div style={wrap}>
        {header}
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>
          Nog te weinig nachten gemeten voor een betrouwbare vooruitblik — dit verschijnt na enkele nachten data.
        </div>
      </div>
    )

  const color = COLORS[outlook.level]
  return (
    <div style={wrap}>
      {header}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 'var(--fs-2xs)', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Verwachte CO₂-piek</div>
          <div style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1.1, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
            {outlook.predictedPeak} <span style={{ fontSize: 'var(--fs-md)', fontWeight: 500, color: 'var(--muted)' }}>ppm</span>
          </div>
        </div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', lineHeight: 1.6 }}>
          Typische nachtstijging <b style={{ color: 'var(--text)' }}>+{outlook.typicalRise} ppm</b>
          <br />
          op basis van {outlook.nightsUsed} nachten {outlook.basis === 'tonight' ? '· vanaf huidige meting' : '· typisch patroon'}
        </div>
      </div>
      <div style={{ marginTop: 12, display: 'flex', gap: 9, alignItems: 'flex-start', padding: '9px 12px', borderRadius: 'var(--r-sm)', background: `color-mix(in srgb, ${color} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 28%, transparent)` }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, marginTop: 5, flexShrink: 0 }} />
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', lineHeight: 1.45 }}>{outlook.advice}</span>
      </div>
    </div>
  )
}
