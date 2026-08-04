'use client'
import { useEffect, useState } from 'react'
import { Moon } from 'lucide-react'
import { withBase } from '@/lib/basePath'
import { nightForecast, NightOutlook } from '@/lib/nightForecast'

const COLORS = { ok: '#16A34A', warning: '#D97706', critical: '#DC2626' } as const

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
    background: 'linear-gradient(135deg, rgba(30,58,138,0.06) 0%, rgba(59,130,246,0.05) 100%)',
    border: '1px solid rgba(59,130,246,0.18)',
    borderRadius: 14,
    padding: '16px 18px',
    marginBottom: 14,
  }
  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <Moon size={16} color="#3B82F6" />
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Nacht-vooruitblik</span>
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>ventilatie-advies voor vannacht</span>
    </div>
  )

  if (loading)
    return (
      <div style={wrap}>
        {header}
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Nachtpatroon analyseren…</div>
      </div>
    )

  if (!outlook)
    return (
      <div style={wrap}>
        {header}
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
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
          <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Verwachte CO₂-piek</div>
          <div style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1.1, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
            {outlook.predictedPeak} <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted)' }}>ppm</span>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>
          Typische nachtstijging <b style={{ color: 'var(--text)' }}>+{outlook.typicalRise} ppm</b>
          <br />
          op basis van {outlook.nightsUsed} nachten {outlook.basis === 'tonight' ? '· vanaf huidige meting' : '· typisch patroon'}
        </div>
      </div>
      <div style={{ marginTop: 12, display: 'flex', gap: 9, alignItems: 'flex-start', padding: '9px 12px', borderRadius: 9, background: `${color}12`, border: `1px solid ${color}30` }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, marginTop: 5, flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.45 }}>{outlook.advice}</span>
      </div>
    </div>
  )
}
