'use client'
import { useEffect, useState } from 'react'

/**
 * Resolve the design-token colours to concrete rgb() strings for the charts.
 *
 * Recharts writes `stroke`/`fill` as SVG *presentation attributes*, and `var(--x)`
 * only resolves inside real CSS properties — not attributes — so passing a token
 * straight to a chart renders black (or nothing). We resolve each token by setting
 * it on a probe element's real `color` property and reading the computed value.
 * A MutationObserver on the <html> class re-resolves when the theme flips, so both
 * light and dark stay correct with globals.css as the one source of truth.
 */
const TOKENS = {
  co2: '--c-co2',
  temp: '--c-temp',
  rh: '--c-rh',
  mould: '--c-mould',
  dew: '--c-dew',
  grid: '--c-grid',
  ok: '--ok',
  warn: '--warn',
  crit: '--crit',
  accent: '--accent',
  brand: '--brand',
  muted: '--muted',
  text: '--text',
  surface: '--surface',
} as const

export type ChartColors = Record<keyof typeof TOKENS, string>

function resolve(): ChartColors {
  const probe = document.createElement('span')
  probe.style.position = 'absolute'
  probe.style.opacity = '0'
  probe.style.pointerEvents = 'none'
  document.body.appendChild(probe)
  const out = {} as ChartColors
  for (const [key, varName] of Object.entries(TOKENS) as [keyof typeof TOKENS, string][]) {
    probe.style.color = `var(${varName})`
    out[key] = getComputedStyle(probe).color
  }
  probe.remove()
  return out
}

// Reasonable light-theme fallbacks for the very first render before the effect runs
// (and for any non-DOM context). Concrete values so a chart is never black.
const FALLBACK: ChartColors = {
  co2: '#4338CA', temp: '#BE123C', rh: '#0E7490', mould: '#B45309', dew: '#7E22CE',
  grid: 'rgba(26,33,30,0.07)', ok: '#15803D', warn: '#B45309', crit: '#B91C1C',
  accent: '#4338CA', brand: '#0B7A5C', muted: '#4A5A53', text: '#1A211E', surface: '#FFFFFF',
}

export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(FALLBACK)
  useEffect(() => {
    const read = () => setColors(resolve())
    read()
    const obs = new MutationObserver(read)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return colors
}

/** rgba wash from an rgb() string, e.g. area fills. */
export function alpha(rgb: string, a: number): string {
  const m = rgb.match(/rgba?\(([^)]+)\)/)
  if (!m) return rgb
  const [r, g, b] = m[1].split(',').map((s) => s.trim())
  return `rgba(${r},${g},${b},${a})`
}
