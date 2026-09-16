'use client'
import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { ProcessedRow } from '@/lib/types'
import { nachtCo2 } from '@/lib/reportAnalytics'

// Uitleg onder de CO₂-grafiek, zoals "Hoe rekenen we dit uit?" op de schimmelpagina. CO₂ is een
// directe meting zonder model, dus dit legt vooral uit hoe je hem leest en wat helpt. De grenzen
// zijn die van co2Status (lib/calculations.ts) — de kleur van de tegel bovenaan. De alinea over
// nauwkeurigheid gaat uit van SCD41-zelfkalibratie (ASC) aan; gaat die uit, pas hem aan
// (docs/huisprofiel-luchtgedrag-plan.md §2).

const BANDS = [
  { range: 'onder 800 ppm', label: 'Goed', color: 'var(--ok)', text: 'De lucht wordt goed ververst.' },
  { range: '800–1000 ppm', label: 'Verhoogd', color: 'var(--warn)', text: 'Voor even prima. Blijft het zo, lucht dan bij.' },
  { range: '1000–1500 ppm', label: 'Hoog', color: 'var(--warn)', text: 'De lucht wordt bedompt: er komt te weinig verse lucht binnen voor het aantal mensen.' },
  { range: 'boven 1500 ppm', label: 'Kritiek', color: 'var(--crit)', text: 'Veel te weinig verse lucht. Zet een raam of rooster open.' },
]

const nl = (v: number) => Math.round(v).toLocaleString('nl-NL')

export default function Co2Explainer({ rows }: { rows: ProcessedRow[] }) {
  const [open, setOpen] = useState(false)
  const h = (t: string) => <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: '14px 0 5px' }}>{t}</p>
  const p = (t: React.ReactNode) => <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 6px' }}>{t}</p>

  // Rijen zijn blokken van gelijke lengte, dus het aandeel rijen is het aandeel tijd.
  const valid = rows.filter((r) => Number.isFinite(r.co2) && r.co2 > 0)
  const above1000 = valid.length ? (valid.filter((r) => r.co2 >= 1000).length / valid.length) * 100 : null
  const night = valid.length ? nachtCo2(valid.map((r) => r.ts), valid.map((r) => r.co2)) : null

  return (
    <div style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 10 }}>
      <button onClick={() => setOpen((s) => !s)} aria-expanded={open}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--muted)', padding: 0, fontFamily: 'inherit' }}>
        {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />} Wat zegt CO₂?
      </button>
      {open && (
        <div style={{ marginTop: 4 }}>
          {above1000 != null && (
            <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--r-md)', padding: '10px 14px', margin: '10px 0 4px', fontSize: 'var(--fs-sm)', color: 'var(--muted)', lineHeight: 1.55 }}>
              <strong style={{ color: 'var(--text)' }}>In deze periode</strong> was de CO₂ {above1000 >= 0.5 ? <><strong style={{ color: 'var(--text)' }}>{nl(above1000)}%</strong> van de tijd</> : 'nooit'} boven 1000 ppm.
              {night && night.gemNacht > 0 && night.gemDag > 0 && <> &apos;s Nachts gemiddeld {nl(night.gemNacht)} ppm, overdag {nl(night.gemDag)} ppm.</>}
              {night?.probleem && <> &apos;s Nachts loopt het flink op: in een slaapkamer betekent dat meestal dat raam en rooster dicht zijn.</>}
            </div>
          )}

          {h('Wat meet je?')}
          {p('CO₂ ademen we zelf uit. Buiten zit er ongeveer 420 ppm in de lucht. Binnen loopt het op als er mensen in de kamer zijn en er te weinig verse lucht binnenkomt. Daarom is CO₂ een goede meetlat voor ventilatie: hoe hoger, hoe meer gebruikte lucht je inademt. Met de CO₂ hopen ook vocht en geurtjes zich op.')}
          {p('Bij deze waarden is CO₂ zelf niet giftig. Wel merken veel mensen vanaf ongeveer 1000 ppm dat de lucht bedompt is, en onderzoek koppelt slecht geventileerde kamers aan slechter slapen, hoofdpijn en minder concentratie.')}

          {h('De grenzen die we gebruiken')}
          <div role="table" aria-label="CO₂-grenzen" style={{ display: 'grid', gap: 4, margin: '0 0 6px' }}>
            {BANDS.map((b) => (
              // Flex met wrap: op een telefoon valt de uitleg onder grens en label in plaats van een smalle kolom.
              <div role="row" key={b.label} style={{ display: 'flex', flexWrap: 'wrap', columnGap: 10, alignItems: 'baseline', fontSize: 12.5, lineHeight: 1.5 }}>
                <span role="cell" style={{ width: '7.5rem', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{b.range}</span>
                <span role="cell" style={{ width: '5.5rem', color: b.color, fontWeight: 700 }}>{b.label}</span>
                <span role="cell" style={{ flex: '1 1 14rem', color: 'var(--muted)' }}>{b.text}</span>
              </div>
            ))}
          </div>

          {h('Hoe lees je de grafiek?')}
          {p('De lijn stijgt als er iemand in de kamer is en daalt als de kamer leeg is of als er gelucht wordt. Een snelle, steile daling is bijna altijd een raam of deur die opengaat. In een slaapkamer loopt de CO₂ \'s nachts op als raam, rooster en deur dicht zijn; met twee mensen komt dat al snel boven 1500 ppm. Overdag, als de kamer leeg is, zakt het weer richting buitenniveau.')}

          {h('Wat helpt?')}
          <ul style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 6px', paddingLeft: 18 }}>
            <li>Ventilatieroosters boven de ramen altijd open, ook in de winter.</li>
            <li>Slaapkamer: raam op een kier of de deur open tijdens het slapen.</li>
            <li>Mechanische ventilatie niet op de laagste stand als er mensen thuis zijn.</li>
            <li>Na bezoek, koken of sporten 10–15 minuten flink luchten.</li>
          </ul>
          {p('Luchten voert ook vocht af, wat helpt tegen schimmel. Behalve als het buiten vochtiger is dan binnen; dat staat dan in het advies bovenaan.')}

          {h('Hoe nauwkeurig is de sensor?')}
          {p('De sensor meet CO₂ met infrarood en stelt zichzelf bij op buitenlucht. Daarvoor moet hij af en toe verse lucht zien, zoals na flink luchten. Staat hij in een kamer die nooit echt gelucht wordt, dan kan hij na verloop van tijd iets te laag uitkomen.')}
        </div>
      )}
    </div>
  )
}
