'use client'
import { useMemo } from 'react'
import { Activity } from 'lucide-react'
import { measurementCoverage } from '@/lib/coverage'
import { useSeries } from '@/lib/useSeries'
import { useSelectedDevice } from '@/lib/useSelectedDevice'

// Compact "your record is continuous" indicator — a continuous measurement
// history matters when the data is used as evidence.
export default function ContinuityChip() {
  // Dezelfde sensorkeuze als de rest van het dashboard: een dekkingscijfer over twee
  // sensoren door elkaar zegt niets over de kamer die je bekijkt.
  const selectedDevice = useSelectedDevice()
  const { rows } = useSeries(30 * 1440, { device: selectedDevice }) // last 30 days, shared cache
  const cov = useMemo(() => (rows?.length ? measurementCoverage(rows) : null), [rows])

  if (!cov) return null
  const label = `${cov.currentStreak} ${cov.currentStreak === 1 ? 'dag' : 'dagen'} onafgebroken gemeten`
  return (
    <span
      title={`Laatste 30 dagen: ${cov.days} meetdagen · langste reeks ${cov.longestStreak} dagen · ${cov.coveragePct}% dekking`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--muted)' }}
    >
      <Activity size={12} color="var(--ok)" />
      {label}
    </span>
  )
}
