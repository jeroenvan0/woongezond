'use client'
import { useEffect, useState } from 'react'
import { Activity } from 'lucide-react'
import { withBase } from '@/lib/basePath'
import { measurementCoverage, Coverage } from '@/lib/coverage'

// Compact "your record is continuous" indicator — a continuous measurement
// history matters when the data is used as evidence.
export default function ContinuityChip() {
  const [cov, setCov] = useState<Coverage | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const r = await fetch(withBase('/api/data?minutes=' + 30 * 1440)) // last 30 days
        const d = await r.json()
        setCov(measurementCoverage(d.rows ?? []))
      } catch {}
    })()
  }, [])

  if (!cov) return null
  const label = `${cov.currentStreak} ${cov.currentStreak === 1 ? 'dag' : 'dagen'} onafgebroken gemeten`
  return (
    <span
      title={`Laatste 30 dagen: ${cov.days} meetdagen · langste reeks ${cov.longestStreak} dagen · ${cov.coveragePct}% dekking`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--muted)' }}
    >
      <Activity size={12} color="#16A34A" />
      {label}
    </span>
  )
}
