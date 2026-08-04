'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Logo from '@/components/Logo'

export default function LoginPage() {
  const [email, setEmail]   = useState('')
  const [pass, setPass]     = useState('')
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const router   = useRouter()
  const supabase = createClient()

  async function login(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass })
    if (error) { setError(error.message); setLoading(false) }
    else { router.push('/dashboard'); router.refresh() }
  }

  const inp = (label: string, type: string, value: string, onChange: (v: string) => void, ph: string) => (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={ph} style={{ width: '100%', padding: '11px 13px', border: '1px solid var(--border)', borderRadius: 10, fontSize: 14, background: 'var(--surface-2)', color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }} />
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 400, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '36px 32px', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
          <Logo size={34} />
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--text)', letterSpacing: '-0.02em' }}>Woongezond</h1>
        </div>
        <p style={{ fontSize: 14, color: 'var(--muted)', margin: '0 0 28px' }}>Log in om je luchtkwaliteit-dashboard te bekijken</p>
        {error && <div style={{ fontSize: 13, color: '#DC2626', background: '#FEF2F2', padding: '9px 13px', borderRadius: 10, border: '1px solid rgba(220,38,38,0.22)', marginBottom: 16 }}>{error}</div>}
        <form onSubmit={login}>
          {inp('E-mailadres', 'email',    email, setEmail, 'jouw@email.nl')}
          {inp('Wachtwoord',  'password', pass,  setPass,  '••••••••')}
          <button type="submit" disabled={loading} style={{ width: '100%', padding: 12, background: 'linear-gradient(135deg,#3B82F6 0%,#2563EB 100%)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 10px rgba(59,130,246,0.3)', fontFamily: 'inherit', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Inloggen…' : 'Inloggen'}
          </button>
        </form>
      </div>
    </div>
  )
}
