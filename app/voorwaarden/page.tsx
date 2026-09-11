import Logo from '@/components/Logo'
import { TERMS_SUMMARY, TERMS_VERSION } from '@/lib/pilot/terms'

// Algemene voorwaarden — CONCEPT (zie lib/pilot/terms.ts). Publiek, gelinkt vanuit /start.

export const metadata = { title: 'Algemene voorwaarden — Woongezond' }

const H = ({ children }: { children: React.ReactNode }) => (
  <h2 style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text)', margin: '28px 0 8px' }}>{children}</h2>
)
const P = ({ children }: { children: React.ReactNode }) => (
  <p style={{ fontSize: 'var(--fs-md)', color: 'var(--muted)', lineHeight: 1.65, margin: '0 0 10px' }}>{children}</p>
)

export default function VoorwaardenPage() {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', padding: 'var(--sp-4)' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0 20px' }}>
          <Logo size={30} /><span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>Woongezond</span>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '28px 24px', boxShadow: 'var(--shadow-md)' }}>
          <div style={{ display: 'inline-block', fontSize: 'var(--fs-xs)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--warn)', background: 'var(--warn-fill)', padding: '3px 9px', borderRadius: 'var(--r-pill)', marginBottom: 12 }}>Concept · versie {TERMS_VERSION}</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.02em', margin: '0 0 6px' }}>Algemene voorwaarden</h1>
          <P>Dit is de conceptversie voor de pilot. De definitieve tekst volgt vóór de bredere uitrol; de kern verandert daarbij niet.</P>

          <H>In het kort</H>
          <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--muted)', fontSize: 'var(--fs-md)', lineHeight: 1.65 }}>
            {TERMS_SUMMARY.map((t) => <li key={t} style={{ marginBottom: 6 }}>{t}</li>)}
          </ul>

          <H>1. Wat de sensor doet</H>
          <P>De Woongezond-sensor meet iedere minuut het CO₂-gehalte, de temperatuur en de relatieve luchtvochtigheid in de ruimte waar hij is geplaatst. De sensor bevat geen microfoon en geen camera en registreert geen personen.</P>
          <H>2. Welke gegevens we opslaan</H>
          <P>De metingen, het tijdstip ervan, technische status van de sensor (zoals signaalsterkte en firmwareversie) en de antwoorden die je in de registratie geeft over de woning en de kamer. Deze antwoorden bevatten geen naam of adres.</P>
          <H>3. Waarvoor we de gegevens gebruiken</H>
          <P>Om het binnenklimaat van de woning te beoordelen, adviezen te geven over ventileren en vochtbeheersing, en om de dienst te verbeteren. Geanonimiseerde en samengevoegde gegevens kunnen worden gebruikt voor onderzoek en rapportages.</P>
          <H>4. Delen met derden</H>
          <P>Gegevens die herleidbaar zijn tot jouw woning worden alleen gedeeld met een verhuurder, corporatie of andere partij als jij daar uitdrukkelijk toestemming voor geeft. Je kunt die toestemming op elk moment intrekken.</P>
          <H>5. Jouw rechten</H>
          <P>Je kunt inzage vragen in de gegevens van jouw sensor, correctie of verwijdering vragen, en de sensor op elk moment loskoppelen of retourneren. Neem daarvoor contact op via het adres onderaan.</P>
          <H>6. Bewaartermijn</H>
          <P>Meetgegevens bewaren we zolang de sensor in gebruik is en daarna maximaal twee jaar, tenzij je eerder om verwijdering vraagt.</P>
          <H>7. Wijzigingen</H>
          <P>Als deze voorwaarden inhoudelijk veranderen, vragen we opnieuw om akkoord bij de eerstvolgende registratie of het eerstvolgende gebruik.</P>
          <H>Contact</H>
          <P>Woongezond · woongezond@vostech.group</P>
        </div>
      </div>
    </div>
  )
}
