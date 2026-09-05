'use client'
import { useCallback, useEffect, useRef, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Logo from '@/components/Logo'
import Button from '@/components/ui/Button'
import { withBase } from '@/lib/basePath'
import { QUESTIONS, CLAIM_CODE_RE, normalizeCode, type HouseProfile } from '@/lib/houseProfile'
import { Plug, Wifi, CheckCircle2, Home, ArrowRight, ArrowLeft, Loader2, PartyPopper } from 'lucide-react'

// Resident self-service: the QR on the sensor opens /start?code=DEVICE-XXXX.
// Four steps, no account (docs/pilot-cockpit-plan.md §2b):
//   1 plug in  →  2 Wi-Fi via the sensor's own setup network (we poll until it's online)
//   →  3 ten house questions  →  4 done (optional: claim with an account).
// Steps 2 and 3 are independent: answering first and plugging in later is fine.

type Status = { device_number: number | null; name: string; ap_name: string; online: boolean; minutes_since: number | null; profile_completed: boolean }
const ERR: Record<string, string> = {
  code_invalid: 'Deze code klopt niet. Hij ziet eruit als DEVICE-7F3A.',
  code_unknown: 'Deze code kennen we niet. Kijk of je hem goed hebt overgetypt.',
  not_deployed: 'Deze server is nog niet klaar voor het koppelen van sensoren.',
  unconfigured: 'De server is niet goed ingesteld. Probeer het later.',
  error: 'Er ging iets mis. Probeer het opnieuw.',
}
const STEPS = ['Start', 'WiFi', 'Je huis', 'Klaar']

function StartInner() {
  const params = useSearchParams()
  const [code, setCode] = useState(() => normalizeCode(params.get('code') ?? ''))
  const [codeInput, setCodeInput] = useState(code)
  const [status, setStatus] = useState<Status | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [q, setQ] = useState(0)
  const [answers, setAnswers] = useState<Partial<HouseProfile>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStatus = useCallback(async (c: string) => {
    try {
      const r = await fetch(withBase(`/api/devices/status?code=${encodeURIComponent(c)}`), { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) { setErr(ERR[d.error] ?? ERR.error); setStatus(null); return null }
      setErr(null); setStatus(d); return d as Status
    } catch { setErr(ERR.error); return null }
  }, [])

  // Look the code up once; poll only while the Wi-Fi step is showing and the sensor is silent.
  useEffect(() => { if (CLAIM_CODE_RE.test(code)) fetchStatus(code) }, [code, fetchStatus])
  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (step === 1 && code && !(status?.online)) {
      pollRef.current = setInterval(() => fetchStatus(code), 5000)
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [step, code, status?.online, fetchStatus])

  async function submitProfile() {
    setSaving(true); setErr(null)
    try {
      const r = await fetch(withBase('/api/devices/profile'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, answers }) })
      const d = await r.json()
      if (!r.ok) { setErr(ERR[d.error] ?? ERR.error); return }
      setSaved(true); setStep(3)
    } catch { setErr(ERR.error) } finally { setSaving(false) }
  }

  const question = QUESTIONS[q]
  const allAnswered = QUESTIONS.every((x) => answers[x.key])
  const nr = status?.device_number ? String(status.device_number).padStart(2, '0') : null

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', display: 'flex', justifyContent: 'center', padding: 'var(--sp-4)' }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, margin: 'var(--sp-3) 0 var(--sp-4)' }}>
          <Logo size={28} /><span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Woongezond</span>
          {nr && <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--brand)', background: 'var(--brand-fill, var(--surface-tint))', padding: '3px 10px', borderRadius: 999 }}>Sensor {nr}</span>}
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 'var(--sp-4)' }} aria-label={`Stap ${step + 1} van ${STEPS.length}`}>
          {STEPS.map((s, i) => <div key={s} title={s} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= step ? 'var(--brand)' : 'var(--surface-tint)' }} />)}
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 'var(--sp-5)', boxShadow: 'var(--shadow-sm)' }}>
          {err && <div role="alert" style={{ padding: '10px 14px', marginBottom: 'var(--sp-3)', borderRadius: 'var(--r-md)', background: 'var(--crit-fill)', color: 'var(--crit)', fontSize: 'var(--fs-sm)', fontWeight: 600 }}>{err}</div>}

          {/* ---- 0 · start / code ---- */}
          {step === 0 && (
            <Panel icon={<Plug size={26} color="var(--brand)" />} title={status ? `Welkom! Dit is sensor ${nr}.` : 'Welkom bij je sensor'}>
              {!status ? (
                <>
                  <P>Scan de QR-code op de sensor, of typ de code van de sticker hieronder.</P>
                  <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                    <input value={codeInput} onChange={(e) => setCodeInput(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && setCode(normalizeCode(codeInput))}
                      placeholder="DEVICE-7F3A" aria-label="Code van de sticker" autoComplete="off" autoCapitalize="characters"
                      style={{ flex: 1, minWidth: 160, padding: '11px 12px', fontSize: 18, letterSpacing: 1, fontFamily: 'inherit', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface)', color: 'var(--text)' }} />
                    <Button variant="primary" onClick={() => setCode(normalizeCode(codeInput))}>Verder</Button>
                  </div>
                </>
              ) : (
                <>
                  <P>In drie stappen meet deze sensor de lucht in je huis. Het kost ongeveer vijf minuten en je hebt geen account nodig.</P>
                  <Steps items={['Sensor in het stopcontact', 'Sensor op je WiFi zetten', 'Tien korte vragen over je huis']} />
                  {status.profile_completed && <Note>De vragen over dit huis zijn al eens ingevuld. Je kunt ze opnieuw doen, dan overschrijven we de oude antwoorden.</Note>}
                </>
              )}
            </Panel>
          )}

          {/* ---- 1 · wifi ---- */}
          {step === 1 && status && (
            <Panel icon={status.online ? <CheckCircle2 size={26} color="var(--ok)" /> : <Wifi size={26} color="var(--brand)" />} title={status.online ? 'De sensor is online!' : 'Zet de sensor op je WiFi'}>
              {status.online ? (
                <P>We ontvangen metingen van sensor {nr}. {status.minutes_since != null && status.minutes_since > 0 ? `Laatste meting ${status.minutes_since} min geleden.` : 'Zojuist nog.'} Je kunt door naar de vragen.</P>
              ) : (
                <>
                  <P>Steek de sensor in het stopcontact. Na een halve minuut maakt hij een eigen WiFi-netwerkje aan, alleen om zich te laten instellen.</P>
                  <Steps items={[
                    <>Open op je telefoon <b>Instellingen → WiFi</b>.</>,
                    <>Kies het netwerk <Code>{status.ap_name}</Code>.</>,
                    <>Er opent vanzelf een pagina. Kies daar je eigen WiFi-netwerk en vul het wachtwoord in.</>,
                    <>Kom terug naar deze pagina. Zodra de sensor meet, springt dit scherm op groen.</>,
                  ]} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'var(--sp-3)', color: 'var(--muted)', fontSize: 'var(--fs-sm)' }}>
                    <Loader2 size={15} className="spin" style={{ animation: 'spin 1.2s linear infinite' }} /> Wachten op de eerste meting…
                  </div>
                  <Note>Lukt het niet? Werkt de sensor alleen op 2,4 GHz WiFi. Staat het lampje niet aan, probeer een ander stopcontact. Je kunt ook eerst de vragen doen en dit later afmaken.</Note>
                </>
              )}
            </Panel>
          )}

          {/* ---- 2 · house questions ---- */}
          {step === 2 && (
            <Panel icon={<Home size={26} color="var(--brand)" />} title={question.title}>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', marginBottom: 'var(--sp-3)' }}>Vraag {q + 1} van {QUESTIONS.length}{question.help ? ` · ${question.help}` : ''}</div>
              <div role="radiogroup" aria-label={question.title} style={{ display: 'grid', gap: 8 }}>
                {question.options.map((o) => {
                  const on = answers[question.key] === o.value
                  return (
                    <button key={o.value} role="radio" aria-checked={on} onClick={() => {
                      setAnswers((a) => ({ ...a, [question.key]: o.value }))
                      if (q < QUESTIONS.length - 1) setTimeout(() => setQ(q + 1), 160)
                    }} style={{
                      textAlign: 'left', padding: '12px 14px', borderRadius: 'var(--r-md)', fontFamily: 'inherit', fontSize: 'var(--fs-md)', cursor: 'pointer',
                      border: `1.5px solid ${on ? 'var(--brand)' : 'var(--border)'}`, background: on ? 'var(--brand-fill, var(--surface-tint))' : 'var(--surface)', color: 'var(--text)', fontWeight: on ? 700 : 500,
                    }}>
                      {o.label}{o.hint && <span style={{ display: 'block', fontSize: 'var(--fs-sm)', color: 'var(--muted)', fontWeight: 400 }}>{o.hint}</span>}
                    </button>
                  )
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--sp-4)' }}>
                <Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => (q > 0 ? setQ(q - 1) : setStep(1))}>Terug</Button>
                {q < QUESTIONS.length - 1
                  ? <Button variant="ghost" icon={<ArrowRight size={15} />} onClick={() => setQ(q + 1)} disabled={!answers[question.key]}>Volgende</Button>
                  : <Button variant="primary" icon={<ArrowRight size={15} />} onClick={submitProfile} disabled={!allAnswered || saving}>{saving ? 'Opslaan…' : 'Opslaan'}</Button>}
              </div>
            </Panel>
          )}

          {/* ---- 3 · done ---- */}
          {step === 3 && (
            <Panel icon={<PartyPopper size={26} color="var(--ok)" />} title="Klaar, bedankt!">
              <P>{saved ? 'Je antwoorden zijn opgeslagen. ' : ''}{status?.online ? `Sensor ${nr} meet en stuurt zijn metingen door.` : `Zodra sensor ${nr} op WiFi zit, begint hij vanzelf met meten.`} Je hoeft verder niets te doen.</P>
              <P>Wil je zelf zien hoe de lucht in je huis is? Dan kun je een account maken en de sensor aan jezelf koppelen. Dat is helemaal optioneel.</P>
              <a href={withBase(`/koppel?code=${encodeURIComponent(code)}`)} style={{ color: 'var(--brand)', fontWeight: 600, fontSize: 'var(--fs-md)' }}>Eigen account maken en koppelen →</a>
            </Panel>
          )}

          {step < 2 && status && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--sp-4)' }}>
              {step > 0 ? <Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => setStep(step - 1)}>Terug</Button> : <span />}
              <Button variant="primary" icon={<ArrowRight size={15} />} onClick={() => setStep(step + 1)}>
                {step === 0 ? 'Beginnen' : status.online ? 'Naar de vragen' : 'Eerst de vragen doen'}
              </Button>
            </div>
          )}
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  )
}

function Panel({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return <div>{icon}<h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--text)', margin: 'var(--sp-3) 0' }}>{title}</h1>{children}</div>
}
function P({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 'var(--fs-md)', color: 'var(--muted)', lineHeight: 1.55, margin: '0 0 var(--sp-3)' }}>{children}</p>
}
function Note({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', lineHeight: 1.5, marginTop: 'var(--sp-3)', padding: '10px 12px', background: 'var(--surface-tint)', borderRadius: 'var(--r-md)' }}>{children}</p>
}
function Code({ children }: { children: React.ReactNode }) {
  return <code style={{ fontWeight: 700, color: 'var(--text)', background: 'var(--surface-tint)', padding: '2px 8px', borderRadius: 6 }}>{children}</code>
}
function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
      {items.map((it, i) => (
        <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', fontSize: 'var(--fs-md)', color: 'var(--text)', lineHeight: 1.5 }}>
          <span style={{ flex: '0 0 26px', height: 26, borderRadius: 13, background: 'var(--brand)', color: '#fff', fontWeight: 700, fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
          <span>{it}</span>
        </li>
      ))}
    </ol>
  )
}

export default function StartPage() {
  return <Suspense fallback={null}><StartInner /></Suspense>
}
