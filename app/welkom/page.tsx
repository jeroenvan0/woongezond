'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Logo from '@/components/Logo'
import Button from '@/components/ui/Button'
import { Sprout, Home, Bell, Share2, CheckCircle2, ArrowRight, ArrowLeft } from 'lucide-react'

// B2 — first-run onboarding wizard. Guides a new resident through naming their sensor/room,
// setting alert thresholds and understanding sharing — so day one isn't a blank dashboard.
// Uses existing tables (devices update, thresholds upsert); no schema change. Opt-in: entered
// from the dashboard's FirstRunNotice, skippable. Design: docs/onboarding-b2.md.

const ONBOARDED_KEY = 'wz-onboarded'

const INSULATION: { value: string; label: string }[] = [
  { value: 'poor', label: 'Slecht (oud, ongeïsoleerd)' },
  { value: 'moderate', label: 'Matig' },
  { value: 'good', label: 'Goed (na-geïsoleerd)' },
  { value: 'excellent', label: 'Uitstekend (nieuwbouw)' },
]

const THRESHOLD_DEFAULTS = { co2: { warning: 1000, critical: 1500 }, humidity: { warning: 65, critical: 75 } }

interface DeviceEdit { id: string; name: string; location: string; insulation: string }

const STEPS = ['Welkom', 'Je sensor', 'Meldingen', 'Delen', 'Klaar']

export default function WelkomPage() {
  const router = useRouter()
  const supabase = createClient()
  const [step, setStep] = useState(0)
  const [userId, setUserId] = useState<string | null>(null)
  const [devices, setDevices] = useState<DeviceEdit[]>([])
  const [thr, setThr] = useState(THRESHOLD_DEFAULTS)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase.auth.getUser()
      if (!data.user) { router.push('/login'); return }
      setUserId(data.user.id)
      const { data: devs } = await supabase.from('devices').select('id, name, location, insulation').eq('user_id', data.user.id)
      setDevices((devs ?? []).map((d: any) => ({ id: d.id, name: d.name ?? '', location: d.location ?? '', insulation: d.insulation ?? 'poor' })))
      const { data: t } = await supabase.from('thresholds').select('metric, warning_value, critical_value').eq('user_id', data.user.id)
      if (t?.length) {
        setThr((prev) => {
          const next = { co2: { ...prev.co2 }, humidity: { ...prev.humidity } }
          for (const r of t) {
            const m = r.metric as 'co2' | 'humidity'
            if (next[m]) {
              if (r.warning_value != null) next[m].warning = +r.warning_value
              if (r.critical_value != null) next[m].critical = +r.critical_value
            }
          }
          return next
        })
      }
    })()
  }, [supabase, router])

  const saveDevices = useCallback(async () => {
    for (const d of devices) {
      await supabase.from('devices').update({ name: d.name || 'Mijn sensor', location: d.location || null, insulation: d.insulation }).eq('id', d.id)
    }
  }, [devices, supabase])

  const saveThresholds = useCallback(async () => {
    if (!userId) return
    for (const metric of ['co2', 'humidity'] as const) {
      const t = thr[metric]
      const { data: existing } = await supabase.from('thresholds').select('id').eq('user_id', userId).eq('metric', metric).limit(1)
      const payload = { user_id: userId, metric, warning_value: t.warning, critical_value: t.critical }
      if (existing?.length) await supabase.from('thresholds').update(payload).eq('id', existing[0].id)
      else await supabase.from('thresholds').insert(payload)
    }
  }, [thr, userId, supabase])

  async function next() {
    setSaving(true)
    try {
      if (step === 1) await saveDevices()
      if (step === 2) await saveThresholds()
    } finally { setSaving(false) }
    setStep((s) => Math.min(STEPS.length - 1, s + 1))
  }

  function finish() {
    try { localStorage.setItem(ONBOARDED_KEY, '1') } catch {}
    router.push('/dashboard')
  }

  function skip() {
    try { localStorage.setItem(ONBOARDED_KEY, '1') } catch {}
    router.push('/dashboard')
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--sp-4)' }}>
      <div style={{ width: '100%', maxWidth: 560 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Logo size={28} />
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Woongezond</span>
          </div>
          {step < STEPS.length - 1 && (
            <button onClick={skip} style={{ background: 'none', border: 'none', color: 'var(--subtle)', fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'inherit' }}>Overslaan</button>
          )}
        </div>

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 'var(--sp-5)' }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= step ? 'var(--brand)' : 'var(--surface-tint)' }} />
          ))}
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 'var(--sp-6)', boxShadow: 'var(--shadow-sm)' }}>
          {step === 0 && (
            <Step icon={<Sprout size={26} color="var(--brand)" />} title="Welkom bij Woongezond">
              <p style={pText}>
                In een paar korte stappen richt je je woning in: je geeft je sensor een naam, kiest wanneer je een melding
                wilt, en je leest hoe delen met je corporatie werkt. Dit duurt minder dan een minuut en je kunt alles later
                aanpassen.
              </p>
            </Step>
          )}

          {step === 1 && (
            <Step icon={<Home size={26} color="var(--brand)" />} title="Je sensor & kamer">
              {devices.length === 0 ? (
                <p style={pText}>
                  Er is nog geen sensor aan je account gekoppeld. Zodra je corporatie de sensor plaatst, verschijnt hij hier
                  automatisch. Je kunt deze stap nu overslaan.
                </p>
              ) : (
                <>
                  <p style={pText}>Geef je sensor een herkenbare naam en kies de kamer en het type woning — dat maakt het schimmeladvies nauwkeuriger.</p>
                  <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
                    {devices.map((d, i) => (
                      <div key={d.id} style={{ display: 'grid', gap: 'var(--sp-2)' }}>
                        <Field label="Naam van de sensor">
                          <input value={d.name} onChange={(e) => setDevices((ds) => ds.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="bijv. Slaapkamer" style={inp} />
                        </Field>
                        <Field label="Kamer (optioneel)">
                          <input value={d.location} onChange={(e) => setDevices((ds) => ds.map((x, j) => j === i ? { ...x, location: e.target.value } : x))} placeholder="bijv. Slaapkamer boven" style={inp} />
                        </Field>
                        <Field label="Isolatie van de woning">
                          <select value={d.insulation} onChange={(e) => setDevices((ds) => ds.map((x, j) => j === i ? { ...x, insulation: e.target.value } : x))} style={inp}>
                            {INSULATION.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </Field>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Step>
          )}

          {step === 2 && (
            <Step icon={<Bell size={26} color="var(--brand)" />} title="Wanneer wil je een melding?">
              <p style={pText}>We waarschuwen je als de lucht ongezond wordt. De standaardwaarden werken voor de meeste woningen — pas ze gerust aan.</p>
              {(['co2', 'humidity'] as const).map((m) => (
                <div key={m} style={{ marginBottom: 'var(--sp-4)' }}>
                  <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text)', marginBottom: 'var(--sp-2)' }}>
                    {m === 'co2' ? 'CO₂ (ppm)' : 'Luchtvochtigheid (%)'}
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
                    <Field label="Let op vanaf">
                      <input type="number" value={thr[m].warning} onChange={(e) => setThr((p) => ({ ...p, [m]: { ...p[m], warning: +e.target.value } }))} style={inp} />
                    </Field>
                    <Field label="Kritiek vanaf">
                      <input type="number" value={thr[m].critical} onChange={(e) => setThr((p) => ({ ...p, [m]: { ...p[m], critical: +e.target.value } }))} style={inp} />
                    </Field>
                  </div>
                </div>
              ))}
            </Step>
          )}

          {step === 3 && (
            <Step icon={<Share2 size={26} color="var(--brand)" />} title="Delen met je corporatie">
              <p style={pText}>
                Je kunt je woningcorporatie later een <strong style={{ color: 'var(--text)' }}>samenvatting</strong> van je
                binnenklimaat laten meekijken — nooit ruwe metingen, namen of adressen, en alleen als jij dat wilt. Je regelt
                dit wanneer je een uitnodigingscode krijgt, via <strong style={{ color: 'var(--text)' }}>Delen</strong> in het menu.
                Je hoeft nu niets te doen.
              </p>
            </Step>
          )}

          {step === 4 && (
            <Step icon={<CheckCircle2 size={26} color="var(--ok)" />} title="Klaar!">
              <p style={pText}>Je woning is ingericht. Het dashboard vult zich zodra de sensor meet. Veel woonplezier — en gezonde lucht.</p>
            </Step>
          )}

          {/* Nav */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--sp-6)' }}>
            {step > 0 && step < STEPS.length - 1 ? (
              <Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => setStep((s) => Math.max(0, s - 1))}>Terug</Button>
            ) : <span />}
            {step < STEPS.length - 1 ? (
              <Button variant="primary" icon={<ArrowRight size={15} />} onClick={next} disabled={saving}>
                {step === 0 ? 'Beginnen' : saving ? 'Opslaan…' : 'Volgende'}
              </Button>
            ) : (
              <Button variant="primary" icon={<ArrowRight size={15} />} onClick={finish}>Naar het dashboard</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const pText: React.CSSProperties = { fontSize: 'var(--fs-md)', color: 'var(--muted)', lineHeight: 1.55, margin: '0 0 var(--sp-4)' }
const inp: React.CSSProperties = { width: '100%', padding: '9px 12px', fontSize: 'var(--fs-md)', fontFamily: 'inherit', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface)', color: 'var(--text)' }

function Step({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ marginBottom: 'var(--sp-3)' }}>{icon}</div>
      <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--text)', margin: '0 0 var(--sp-3)' }}>{title}</h1>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ flex: 1, display: 'block' }}>
      <span style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  )
}
