'use client'
import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Logo from '@/components/Logo'
import Button from '@/components/ui/Button'
import { withBase } from '@/lib/basePath'
import { QrCode, CheckCircle2, ArrowRight } from 'lucide-react'

// Resident device-claim page. QR on the sensor deep-links here with ?code=DEVICE-XXXX;
// redeeming links the sensor to this household. Design: docs/device-provisioning-design.md.

const ERRORS: Record<string, string> = {
  claim_invalid: 'Deze koppelcode is ongeldig, verlopen of al gebruikt.',
  code_required: 'Vul eerst een code in.',
  not_deployed: 'Koppelen is nog niet beschikbaar op deze server.',
  unauthenticated: 'Je bent uitgelogd. Log opnieuw in.',
  error: 'Er ging iets mis. Probeer het later opnieuw.',
}

function KoppelInner() {
  const router = useRouter()
  const params = useSearchParams()
  const supabase = createClient()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/login'); return }
    })
    const c = params.get('code')
    if (c) setCode(c)
  }, [supabase, router, params])

  async function claim() {
    if (!code.trim()) { setErr(ERRORS.code_required); return }
    setBusy(true); setErr(null)
    try {
      const r = await fetch(withBase('/api/devices/claim'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code.trim() }) })
      const d = await r.json()
      if (!r.ok) { setErr(ERRORS[d.error] ?? ERRORS.error); return }
      setDone(d.device_name ?? 'je sensor')
    } catch {
      setErr(ERRORS.error)
    } finally { setBusy(false) }
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--sp-4)' }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 'var(--sp-5)' }}>
          <Logo size={28} /><span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Woongezond</span>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 'var(--sp-6)', boxShadow: 'var(--shadow-sm)' }}>
          {done ? (
            <div>
              <CheckCircle2 size={26} color="var(--ok)" />
              <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--text)', margin: 'var(--sp-3) 0' }}>Sensor gekoppeld</h1>
              <p style={{ fontSize: 'var(--fs-md)', color: 'var(--muted)', lineHeight: 1.55, marginBottom: 'var(--sp-5)' }}>
                <strong style={{ color: 'var(--text)' }}>{done}</strong> is nu aan je woning gekoppeld. Zodra hij meet, vult je dashboard zich vanzelf.
              </p>
              <Button variant="primary" icon={<ArrowRight size={15} />} onClick={() => router.push('/dashboard')}>Naar het dashboard</Button>
            </div>
          ) : (
            <div>
              <QrCode size={26} color="var(--brand)" />
              <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--text)', margin: 'var(--sp-3) 0' }}>Koppel je sensor</h1>
              <p style={{ fontSize: 'var(--fs-md)', color: 'var(--muted)', lineHeight: 1.55, marginBottom: 'var(--sp-4)' }}>
                Scan de QR-code op de sensor, of vul de koppelcode hieronder in. Je vindt de code op de sticker van het apparaat.
              </p>
              {err && (
                <div role="alert" style={{ padding: '10px 14px', marginBottom: 'var(--sp-3)', borderRadius: 'var(--r-md)', background: 'var(--crit-fill)', color: 'var(--crit)', fontSize: 'var(--fs-sm)', fontWeight: 600 }}>{err}</div>
              )}
              <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && claim()}
                  placeholder="bijv. DEVICE-7F3A"
                  aria-label="Koppelcode"
                  autoComplete="off"
                  style={{ flex: 1, minWidth: 180, padding: '9px 12px', fontSize: 'var(--fs-md)', fontFamily: 'inherit', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface)', color: 'var(--text)' }}
                />
                <Button variant="primary" onClick={claim} disabled={busy}>Koppelen</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function KoppelPage() {
  // useSearchParams needs a Suspense boundary in the app router.
  return (
    <Suspense fallback={null}>
      <KoppelInner />
    </Suspense>
  )
}
