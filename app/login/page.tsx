'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { withBase } from '@/lib/basePath'
import Logo from '@/components/Logo'

type Mode = 'login' | 'signup' | 'reset'

// Supabase returns its errors in English; this app is Dutch (D7). Map the ones a
// resident can actually hit to Dutch, and fall back to a neutral Dutch line rather
// than printing a raw English string into the interface.
function dutchError(raw: string): string {
  const m = raw.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Onjuist e-mailadres of wachtwoord.'
  if (m.includes('email not confirmed')) return 'Bevestig eerst je e-mailadres via de link in je mailbox.'
  if (m.includes('already registered')) return 'Er bestaat al een account met dit e-mailadres.'
  if (m.includes('should be at least')) return 'Wachtwoord moet minstens 6 tekens zijn.'
  if (m.includes('unable to validate email') || m.includes('invalid format')) return 'Vul een geldig e-mailadres in.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Te veel pogingen — probeer het over enkele minuten opnieuw.'
  return 'Er ging iets mis. Probeer het opnieuw.'
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setNotice('')
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pass })
        if (error) return setError(dutchError(error.message))
        router.push('/dashboard')
        router.refresh()
        return
      }
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email,
          password: pass,
          options: { emailRedirectTo: `${window.location.origin}${withBase('/dashboard')}` },
        })
        if (error) return setError(dutchError(error.message))
        setNotice('Account aangemaakt. Bevestig je e-mailadres via de link in je mailbox om in te loggen.')
        return
      }
      // reset
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}${withBase('/login')}`,
      })
      if (error) return setError(dutchError(error.message))
      setNotice('Als er een account bij dit e-mailadres hoort, is er een herstel-link verstuurd.')
    } finally {
      setLoading(false)
    }
  }

  const heading =
    mode === 'login' ? 'Log in om je luchtkwaliteit-dashboard te bekijken'
    : mode === 'signup' ? 'Maak een account aan voor je luchtkwaliteit-dashboard'
    : 'Vul je e-mailadres in om je wachtwoord te herstellen'

  const submitLabel =
    loading ? 'Even geduld…'
    : mode === 'login' ? 'Inloggen'
    : mode === 'signup' ? 'Account aanmaken'
    : 'Herstel-link versturen'

  const field = (id: string, label: string, type: string, value: string, onChange: (v: string) => void, ph: string, autoComplete: string) => (
    <div style={{ marginBottom: 16 }}>
      <label htmlFor={id} style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
      <input id={id} name={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={ph} autoComplete={autoComplete} required style={{ width: '100%', padding: '11px 13px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-lg)', background: 'var(--surface-2)', color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }} />
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 400, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '36px 32px', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
          <Logo size={34} />
          <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, margin: 0, color: 'var(--text)', letterSpacing: '-0.02em' }}>Woongezond</h1>
        </div>
        <p style={{ fontSize: 'var(--fs-lg)', color: 'var(--muted)', margin: '0 0 28px' }}>{heading}</p>

        {error && (
          <div role="alert" aria-live="assertive" style={{ fontSize: 'var(--fs-md)', color: 'var(--crit)', background: 'var(--crit-fill)', padding: '9px 13px', borderRadius: 'var(--r-md)', border: '1px solid color-mix(in srgb, var(--crit) 22%, transparent)', marginBottom: 16 }}>{error}</div>
        )}
        {notice && (
          <div role="status" aria-live="polite" style={{ fontSize: 'var(--fs-md)', color: 'var(--ok)', background: 'var(--ok-fill)', padding: '9px 13px', borderRadius: 'var(--r-md)', border: '1px solid color-mix(in srgb, var(--ok) 22%, transparent)', marginBottom: 16 }}>{notice}</div>
        )}

        <form onSubmit={submit}>
          {field('email', 'E-mailadres', 'email', email, setEmail, 'jouw@email.nl', 'email')}
          {mode !== 'reset' && field('password', 'Wachtwoord', 'password', pass, setPass, '••••••••', mode === 'signup' ? 'new-password' : 'current-password')}
          <button type="submit" disabled={loading} style={{ width: '100%', padding: 12, background: 'linear-gradient(135deg,var(--brand-mark) 0%,var(--brand-700) 100%)', color: '#fff', border: 'none', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-lg)', fontWeight: 600, cursor: 'pointer', boxShadow: 'var(--shadow-sm)', fontFamily: 'inherit', opacity: loading ? 0.7 : 1 }}>
            {submitLabel}
          </button>
        </form>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 18, fontSize: 'var(--fs-sm)', flexWrap: 'wrap' }}>
          {mode !== 'login' ? (
            <button onClick={() => { setMode('login'); setError(''); setNotice('') }} style={linkBtn}>← Terug naar inloggen</button>
          ) : (
            <>
              <button onClick={() => { setMode('signup'); setError(''); setNotice('') }} style={linkBtn}>Account aanmaken</button>
              <button onClick={() => { setMode('reset'); setError(''); setNotice('') }} style={linkBtn}>Wachtwoord vergeten?</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: 'var(--brand)', fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: 'var(--fs-sm)' }
