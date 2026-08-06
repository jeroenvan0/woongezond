'use client'
import Link from 'next/link'
import { Sprout, ArrowRight } from 'lucide-react'

/**
 * Day-one experience (H3). On a fresh account the dashboard used to greet a resident
 * with five separate negative messages ("Geen data", "Te weinig data voor diagnose",
 * "Nog te weinig nachten gemeten", …). This one positive card replaces that first
 * impression: it says what will appear and roughly when, instead of what is missing.
 */
export default function FirstRunNotice() {
  const items = [
    ['Nu-waarden (CO₂, temperatuur, vocht)', 'binnen enkele minuten na de eerste meting'],
    ['Nacht-vooruitblik', 'na 3 nachten meten'],
    ['ML-voorspelling', 'na ~2 weken meten'],
    ['Schimmel-analyse & rapport', 'zodra er een paar dagen data is'],
  ]
  return (
    <div style={{ background: 'var(--brand-fill)', border: '1px solid color-mix(in srgb, var(--brand) 25%, transparent)', borderLeft: '3px solid var(--brand)', borderRadius: 'var(--r-lg)', padding: '18px 22px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text)' }}>
        <Sprout size={19} color="var(--brand)" /> Welkom bij Woongezond
      </div>
      <p style={{ fontSize: 'var(--fs-md)', color: 'var(--muted)', lineHeight: 1.5, margin: '6px 0 12px' }}>
        Er zijn nog geen metingen binnen. Zodra de sensor meet, vult dit dashboard zich vanzelf. Dit is wat je kunt verwachten:
      </p>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
        {items.map(([what, when]) => (
          <li key={what} style={{ display: 'flex', gap: 8, fontSize: 'var(--fs-md)', color: 'var(--text)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand)', marginTop: 7, flexShrink: 0 }} />
            <span><strong>{what}</strong> <span style={{ color: 'var(--subtle)' }}>— {when}</span></span>
          </li>
        ))}
      </ul>
      {/* B2 — entry point into the onboarding wizard: name the sensor, set alerts. */}
      <Link href="/welkom" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 14, padding: '8px 14px', borderRadius: 'var(--r-sm)', background: 'var(--brand)', color: '#fff', fontSize: 'var(--fs-sm)', fontWeight: 600, textDecoration: 'none' }}>
        Richt je woning in <ArrowRight size={15} />
      </Link>
    </div>
  )
}
