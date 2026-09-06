'use client'
import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Logo from '@/components/Logo'
import { withBase } from '@/lib/basePath'
import { BellOff, CheckCircle2, Link2Off, Loader2, ArrowLeft } from 'lucide-react'

// "Geen weekrapport meer ontvangen" uit de weekmail: /rapport/afmelden?t=wgr_…
// Zelfde token als de rapportpagina. POST /api/rapport/afmelden zet report_consent_at
// op NULL; de sensor blijft gewoon meten en naam/e-mail blijven staan, zodat de bewoner
// zich via de QR-pagina op de sensor weer kan aanmelden.

const GRADIENT = 'linear-gradient(135deg, var(--brand-mark) 0%, var(--brand-700) 100%)'
const ERR: Record<string, string> = {
  token_invalid: 'Deze link is verlopen of ongeldig. Je krijgt elke maandag een nieuwe link in je weekrapport.',
  rate_limited: 'Even te veel verzoeken. Wacht een paar minuten en probeer het opnieuw.',
  error: 'Het afmelden is niet gelukt. Probeer het straks opnieuw.',
}

function AfmeldenInner() {
  const params = useSearchParams()
  const t = params.get('t') ?? ''
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState<string | null>(t ? null : ERR.token_invalid)
  const expired = err === ERR.token_invalid

  async function unsubscribe() {
    setBusy(true)
    setErr(null)
    try {
      const r = await fetch(withBase('/api/rapport/afmelden'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t }) })
      const d = await r.json().catch(() => null)
      if (r.ok && d?.ok) { setDone(true); return }
      setErr(ERR[d?.error] ?? (r.status === 401 ? ERR.token_invalid : r.status === 429 ? ERR.rate_limited : ERR.error))
    } catch {
      setErr(ERR.error)
    } finally {
      setBusy(false)
    }
  }

  const badge = (tone: 'brand' | 'ok' | 'crit', icon: React.ReactNode) => (
    <span style={{
      display: 'inline-flex', width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 14,
      background: tone === 'ok' ? 'var(--ok-fill)' : tone === 'crit' ? 'var(--crit-fill)' : 'var(--brand-fill)',
      color: tone === 'ok' ? 'var(--ok)' : tone === 'crit' ? 'var(--crit)' : 'var(--brand)',
    }}>{icon}</span>
  )

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)' }}>
      <style>{`@keyframes wgr-spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ background: GRADIENT, color: '#fff', padding: '18px 18px 64px' }}>
        <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'inline-flex', background: '#fff', borderRadius: 10, padding: 3 }}><Logo size={26} /></span>
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>Woongezond</span>
        </div>
      </div>

      <div style={{ maxWidth: 480, margin: '-44px auto 0', padding: '0 14px 32px' }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '28px 24px', boxShadow: 'var(--shadow-lg)' }}>
          {done ? (
            <>
              {badge('ok', <CheckCircle2 size={26} strokeWidth={2.2} />)}
              <h1 style={h1Style}>Je krijgt geen weekrapport meer.</h1>
              <P>De sensor blijft gewoon meten. Wil je het rapport later toch weer ontvangen? Scan dan de QR-code op de sensor en vul je e-mailadres opnieuw in.</P>
              <Link href={{ pathname: '/rapport', query: { t } }} style={linkStyle}><ArrowLeft size={15} /> Terug naar het rapport</Link>
            </>
          ) : expired ? (
            <>
              {badge('crit', <Link2Off size={26} strokeWidth={2.2} />)}
              <h1 style={h1Style}>Deze link werkt niet meer</h1>
              <P>{ERR.token_invalid}</P>
              <P>Wil je nu al stoppen? Scan de QR-code op de sensor: daar kun je je contactgegevens aanpassen of wissen.</P>
            </>
          ) : (
            <>
              {badge('brand', <BellOff size={26} strokeWidth={2.2} />)}
              <h1 style={h1Style}>Weekrapport stopzetten</h1>
              <P>Na het stopzetten krijg je op maandag geen rapport meer in je mail. De sensor blijft gewoon meten en je gegevens blijven bewaard.</P>
              <P>Toch weer een weekrapport? Scan de QR-code op de sensor en meld je opnieuw aan.</P>
              {err && <div role="alert" style={{ fontSize: 'var(--fs-md)', color: 'var(--crit)', background: 'var(--crit-fill)', padding: '9px 13px', borderRadius: 'var(--r-md)', border: '1px solid color-mix(in srgb, var(--crit) 22%, transparent)', marginTop: 4, fontWeight: 600 }}>{err}</div>}
              <button type="button" onClick={unsubscribe} disabled={busy} style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 13, marginTop: 18,
                background: GRADIENT, color: '#fff', border: 'none', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-lg)', fontWeight: 700,
                cursor: busy ? 'not-allowed' : 'pointer', boxShadow: 'var(--shadow-sm)', fontFamily: 'inherit', opacity: busy ? 0.55 : 1, transition: 'opacity .15s',
              }}>
                {busy ? <><Loader2 size={17} style={{ animation: 'wgr-spin 1.2s linear infinite' }} /> Bezig…</> : 'Ja, stop het weekrapport'}
              </button>
              <Link href={{ pathname: '/rapport', query: { t } }} style={{ ...linkStyle, justifyContent: 'center', width: '100%', marginTop: 8 }}><ArrowLeft size={15} /> Nee, terug naar het rapport</Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const h1Style: React.CSSProperties = { fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text)', margin: '0 0 10px', lineHeight: 1.25 }
const linkStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 10px', color: 'var(--brand)', fontSize: 'var(--fs-md)', fontWeight: 700, textDecoration: 'none', borderRadius: 'var(--r-md)' }

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 'var(--fs-md)', color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 12px' }}>{children}</p>
}

export default function AfmeldenPage() {
  return <Suspense fallback={null}><AfmeldenInner /></Suspense>
}
