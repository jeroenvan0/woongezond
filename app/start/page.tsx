'use client'
import { useCallback, useEffect, useRef, useState, Suspense, cloneElement, isValidElement } from 'react'
import { useSearchParams } from 'next/navigation'
import Logo from '@/components/Logo'
import { withBase } from '@/lib/basePath'
import { QUESTIONS, CLAIM_CODE_RE, normalizeCode, type HouseProfile } from '@/lib/houseProfile'
import { TERMS_VERSION } from '@/lib/pilot/terms'
import { Plug, Wifi, CheckCircle2, Home, ArrowRight, ArrowLeft, Loader2, PartyPopper, Check, RotateCcw, ShieldCheck, Pencil, Mail, KeyRound, UserRoundPlus, Eraser } from 'lucide-react'

// Resident self-service: the QR on the sensor opens /start?code=DEVICE-XXXXXX.
// No account (docs/pilot-cockpit-plan.md §2b):
//   0 start (or "already registered — overwrite?")  →  1 Wi-Fi via the sensor's own setup
//   network (we poll until it is online)  →  2 ten house questions  →  3 summary + terms
//   →  4 done. The sticker code is exchanged once for a 30-minute session; every later
//   call uses the session. Overwriting an existing registration needs a recent replug.

type Status = { session: string; device_number: number | null; name: string; ap_name: string; online: boolean; minutes_since: number | null; registered_at: string | null; recent_boot: boolean }
const ERR: Record<string, string> = {
  code_invalid: 'Deze code klopt niet. Hij ziet eruit als DEVICE-7F3A2B.',
  code_unknown: 'Deze code kennen we niet. Kijk of je hem goed hebt overgetypt, of scan de QR op de sensor opnieuw.',
  mock_code: 'Dit is een test-QR (DEVICE-MOCK…). Gebruik de sticker van een echte sensor.',
  not_deployed: 'Deze server is nog niet klaar voor het registreren van sensoren.',
  unconfigured: 'De server is niet goed ingesteld. Probeer het later.',
  session_invalid: 'Je sessie is verlopen. Scan de QR-code opnieuw.',
  rate_limited: 'Even te veel pogingen. Wacht een paar minuten.',
  terms_required: 'Vink eerst aan dat je akkoord gaat met de voorwaarden.',
  error: 'Er ging iets mis. Probeer het opnieuw.',
}
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })
const STEPS = ['Start', 'WiFi', 'Huis', 'Check', 'Mail', 'Klaar']
const GRADIENT = 'linear-gradient(135deg, var(--brand-mark) 0%, var(--brand-700) 100%)'

function StartInner() {
  const params = useSearchParams()
  const [code, setCode] = useState(() => normalizeCode(params.get('code') ?? ''))
  const [codeInput, setCodeInput] = useState(code)
  const [status, setStatus] = useState<Status | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [q, setQ] = useState(0)
  const [answers, setAnswers] = useState<Partial<HouseProfile>>({})
  const [terms, setTerms] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [overwrite, setOverwrite] = useState(false)
  const [wifiOnly, setWifiOnly] = useState(false)
  const [resetMode, setResetMode] = useState<'ask' | 'done' | null>(null)
  const [locked, setLocked] = useState(false)
  const [contact, setContact] = useState({ name: '', email: '', address_note: '' })
  const [contactSaved, setContactSaved] = useState<boolean | null>(null)
  const sessionRef = useRef<string | null>(null)
  const wifiDoneRef = useRef(false)
  const wifiEnteredAt = useRef<number>(0)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStatus = useCallback(async (c: string) => {
    try {
      // First call exchanges the sticker code for a 30-min session; every later call (the
      // poll, the profile save) uses the session and never resends the code.
      const qs = sessionRef.current ? `session=${encodeURIComponent(sessionRef.current)}` : `code=${encodeURIComponent(c)}`
      let r = await fetch(withBase(`/api/devices/status?${qs}`), { cache: 'no-store' })
      let d = await r.json()
      // A page left open for more than 30 min has an expired session; the sticker code is
      // still on the URL, so quietly exchange it for a fresh session instead of erroring.
      if (r.status === 401 && sessionRef.current && CLAIM_CODE_RE.test(c)) {
        sessionRef.current = null
        r = await fetch(withBase(`/api/devices/status?code=${encodeURIComponent(c)}`), { cache: 'no-store' })
        d = await r.json()
      }
      if (!r.ok) { setErr(ERR[d.error] ?? ERR.error); setStatus(null); return null }
      sessionRef.current = d.session
      // Wi-Fi-change mode: the old connection may still be up; only a reading newer than the
      // moment the resident started counts as "done".
      if (d.last_seen && wifiEnteredAt.current && new Date(d.last_seen).getTime() > wifiEnteredAt.current) wifiDoneRef.current = true
      setErr(null); setStatus(d); return d as Status
    } catch { setErr(ERR.error); return null }
  }, [])

  useEffect(() => { if (CLAIM_CODE_RE.test(code)) fetchStatus(code) }, [code, fetchStatus])
  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (step === 1 && wifiOnly && !wifiEnteredAt.current) { wifiEnteredAt.current = Date.now(); wifiDoneRef.current = false }
    if (step !== 1) wifiEnteredAt.current = 0
    const needPoll = (step === 1 && (!(status?.online) || (wifiOnly && !wifiDoneRef.current))) || (step === 3 && locked && !(status?.recent_boot)) || (resetMode === 'ask' && !(status?.recent_boot))
    if (code && needPoll) pollRef.current = setInterval(() => fetchStatus(code), 5000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [step, code, status?.online, status?.recent_boot, locked, wifiOnly, resetMode, fetchStatus])

  async function submitProfile() {
    if (!terms) { setErr(ERR.terms_required); return }
    setSaving(true); setErr(null)
    try {
      const r = await fetch(withBase('/api/devices/profile'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: sessionRef.current, answers, overwrite, terms_accepted: terms, terms_version: TERMS_VERSION }) })
      const d = await r.json()
      if (r.status === 423) { setLocked(true); await fetchStatus(code); return }
      if (r.status === 401) { await fetchStatus(code); setErr('Even opnieuw verbonden. Druk nog een keer op Opslaan.'); return }
      if (!r.ok) { setErr(ERR[d.error] ?? ERR.error); return }
      setLocked(false); setSaved(true); setStep(4)
    } catch { setErr(ERR.error) } finally { setSaving(false) }
  }

  async function submitContact(skip: boolean) {
    if (skip || (!contact.name && !contact.email && !contact.address_note)) { setContactSaved(false); setStep(5); return }
    setSaving(true); setErr(null)
    try {
      const r = await fetch(withBase('/api/devices/contact'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: sessionRef.current, ...contact }) })
      const d = await r.json()
      if (!r.ok) { setErr(d.error === 'email_invalid' ? 'Dat e-mailadres klopt niet helemaal.' : ERR[d.error] ?? ERR.error); return }
      setContactSaved(!!d.report_by_email); setStep(5)
    } catch { setErr(ERR.error) } finally { setSaving(false) }
  }

  async function submitReset() {
    setSaving(true); setErr(null)
    try {
      const r = await fetch(withBase('/api/devices/reset'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: sessionRef.current }) })
      const d = await r.json()
      if (r.status === 423) { setErr('De sensor is nog niet opnieuw gestart. Haal de stekker eruit en steek hem er weer in.'); await fetchStatus(code); return }
      if (r.status === 401) { await fetchStatus(code); setErr('Even opnieuw verbonden. Druk nog een keer op de knop.'); return }
      if (!r.ok) { setErr(ERR[d.error] ?? ERR.error); return }
      setResetMode('done')
    } catch { setErr(ERR.error) } finally { setSaving(false) }
  }

  const question = QUESTIONS[q]
  const allAnswered = QUESTIONS.every((x) => answers[x.key])
  const nr = status?.device_number ? String(status.device_number).padStart(2, '0') : null
  const registeredChoice = step === 0 && !!status?.registered_at && !overwrite && !resetMode

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)' }}>
      {/* ---- header band ---- */}
      <div style={{ background: GRADIENT, color: '#fff', padding: '18px 18px 64px' }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'inline-flex', background: '#fff', borderRadius: 10, padding: 3 }}><Logo size={26} /></span>
            <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>Woongezond</span>
            {nr && <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-sm)', fontWeight: 700, background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.35)', padding: '4px 12px', borderRadius: 'var(--r-pill)', letterSpacing: '0.02em' }}>Sensor {nr}</span>}
          </div>
          <ol aria-label={`Stap ${step + 1} van ${STEPS.length}`} style={{ display: 'flex', gap: 6, listStyle: 'none', margin: '22px 0 0', padding: 0 }}>
            {STEPS.map((s, i) => (
              <li key={s} aria-current={i === step ? 'step' : undefined} style={{ flex: 1, minWidth: 0 }}>
                <div style={{ height: 5, borderRadius: 3, background: i <= step ? '#fff' : 'rgba(255,255,255,0.28)', transition: 'background .3s' }} />
                <div style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 6, opacity: i <= step ? 1 : 0.6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s}</div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* ---- card ---- */}
      <div style={{ maxWidth: 480, margin: '-44px auto 0', padding: '0 14px 32px' }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '28px 24px', boxShadow: 'var(--shadow-lg)' }}>
          {err && <div role="alert" style={{ fontSize: 'var(--fs-md)', color: 'var(--crit)', background: 'var(--crit-fill)', padding: '9px 13px', borderRadius: 'var(--r-md)', border: '1px solid color-mix(in srgb, var(--crit) 22%, transparent)', marginBottom: 16, fontWeight: 600 }}>{err}</div>}

          {/* 0 · start / code / already registered */}
          {step === 0 && !status && (
            <Panel icon={<Plug />} title="Welkom bij je sensor" lead="Scan de QR-code op de sensor, of typ de code van de sticker.">
              <label htmlFor="code" style={labelStyle}>Code van de sticker</label>
              <input id="code" value={codeInput} onChange={(e) => setCodeInput(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && setCode(normalizeCode(codeInput))}
                placeholder="DEVICE-7F3A2B" autoComplete="off" autoCapitalize="characters" style={inputStyle} />
              <Primary onClick={() => setCode(normalizeCode(codeInput))} icon={<ArrowRight size={17} />}>Verder</Primary>
            </Panel>
          )}
          {step === 0 && status && registeredChoice && (
            <Panel icon={<RotateCcw />} title="Deze sensor is al in gebruik" lead={`Geregistreerd op ${fmtDate(status.registered_at!)}. Wat wil je doen?`}>
              <Choice icon={<KeyRound size={20} />} title="WiFi wijzigen" text="Nieuw wachtwoord of nieuwe router. Zelfde bewoner, alle metingen blijven bij elkaar." onClick={() => { setWifiOnly(true); setStep(1) }} />
              <Choice icon={<UserRoundPlus size={20} />} title="Overdragen aan een nieuwe bewoner" text="De sensor gaat naar een ander huis of een andere kamer. De vragen worden opnieuw gesteld en de gegevens van de vorige bewoner worden losgekoppeld." onClick={() => { setOverwrite(true); setStep(1) }} />
              <Choice icon={<Eraser size={20} />} title="Sensor resetten" text="Registratie en contactgegevens wissen én de sensor zijn WiFi laten vergeten. Hij begint daarna helemaal opnieuw met het setup-netwerk. De metingen blijven bewaard." onClick={() => setResetMode('ask')} />
              <Note icon={<ShieldCheck size={16} />}>Overdragen en resetten kan alleen als je de sensor in handen hebt: we vragen je de stekker er even uit en weer in te doen.</Note>
            </Panel>
          )}
          {step === 0 && status && resetMode === 'ask' && (
            <Panel icon={<Eraser />} title="Sensor resetten" lead="Dit wist de registratie en de contactgegevens, en de sensor vergeet zijn WiFi. De metingen en het sensornummer blijven.">
              <Steps items={[
                <>Haal de stekker van de sensor eruit en steek hem er weer in. Wacht tot het lampje brandt.</>,
                <>Zodra we de herstart zien, verschijnt hieronder de knop.</>,
              ]} />
              {status.recent_boot ? (
                <Primary onClick={submitReset} disabled={saving} icon={<Eraser size={17} />}>{saving ? 'Bezig…' : 'Ja, reset deze sensor'}</Primary>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0 4px', padding: '11px 13px', borderRadius: 'var(--r-md)', background: 'var(--brand-fill)', color: 'var(--brand)', fontSize: 'var(--fs-md)', fontWeight: 600 }}>
                  <Loader2 size={16} style={{ animation: 'wg-spin 1.2s linear infinite', flex: '0 0 auto' }} /> Wachten op de herstart van de sensor…
                </div>
              )}
              <Ghost onClick={() => setResetMode(null)} icon={<ArrowLeft size={15} />}>Annuleren</Ghost>
              <Note>Staat de sensor ergens zonder stroom of WiFi? Houd dan het knopje op de sensor 10 seconden ingedrukt: hij vergeet dan zelf zijn WiFi. Scan daarna de QR opnieuw.</Note>
            </Panel>
          )}
          {step === 0 && status && resetMode === 'done' && (
            <Panel icon={<CheckCircle2 />} tone="ok" title="Sensor gereset" lead={`De registratie is gewist. Sensor ${nr} vergeet binnen een minuut zijn WiFi en opent dan het setup-netwerk ${status.ap_name}.`}>
              <P>Wil je hem meteen opnieuw instellen? Scan de QR nog een keer, of druk hieronder.</P>
              <Primary onClick={() => { setResetMode(null); setOverwrite(false); setWifiOnly(false); sessionRef.current = null; setStatus(null); fetchStatus(code) }} icon={<ArrowRight size={17} />}>Opnieuw beginnen</Primary>
            </Panel>
          )}
          {step === 0 && status && !registeredChoice && !resetMode && (
            <Panel icon={<Plug />} title={`Welkom! Dit is sensor ${nr}.`} lead="In een paar minuten meet deze sensor de lucht in je huis. Je hebt geen account nodig.">
              <Steps items={['Sensor in het stopcontact', 'Sensor op je WiFi zetten', 'Tien korte vragen over je huis']} />
              <Primary onClick={() => setStep(1)} icon={<ArrowRight size={17} />}>Beginnen</Primary>
            </Panel>
          )}

          {/* 1 · wifi */}
          {step === 1 && status && (status.online && !wifiOnly ? (
            <Panel icon={<CheckCircle2 />} tone="ok" title="De sensor is online!" lead={`We ontvangen metingen van sensor ${nr}. ${status.minutes_since ? `Laatste meting ${status.minutes_since} min geleden.` : 'Zojuist nog.'}`}>
              <Primary onClick={() => setStep(2)} icon={<ArrowRight size={17} />}>Naar de vragen</Primary>
              <Ghost onClick={() => setStep(0)} icon={<ArrowLeft size={15} />}>Terug</Ghost>
            </Panel>
          ) : status.online && wifiOnly && wifiDoneRef.current ? (
            <Panel icon={<CheckCircle2 />} tone="ok" title="WiFi bijgewerkt" lead={`Sensor ${nr} is weer online en meet gewoon door. Alle metingen blijven bij elkaar. Je hoeft verder niets te doen.`}>
              <Ghost onClick={() => { setWifiOnly(false); setStep(0) }} icon={<ArrowLeft size={15} />}>Terug naar het begin</Ghost>
            </Panel>
          ) : (
            <Panel icon={<Wifi />} title={wifiOnly ? 'WiFi van de sensor wijzigen' : 'Zet de sensor op je WiFi'} lead={wifiOnly ? 'De sensor vergeet alleen het oude WiFi, verder niets. Zo doe je dat:' : 'Steek de sensor in het stopcontact. Na een halve minuut maakt hij een eigen WiFi-netwerkje, alleen om zich te laten instellen.'}>
              <Steps items={[
                ...(wifiOnly ? [<>Houd het knopje op de sensor <b>10 seconden</b> ingedrukt tot het lampje snel knippert. De sensor herstart.</>] : []),
                <>Open op je telefoon <b>Instellingen → WiFi</b>.</>,
                <>Kies het netwerk <Code>{status.ap_name}</Code>.</>,
                <>Er opent vanzelf een pagina. Kies je eigen WiFi-netwerk en vul het wachtwoord in.</>,
                <>Kom terug naar deze pagina. Zodra de sensor meet, springt dit scherm op groen.</>,
              ]} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0 4px', padding: '11px 13px', borderRadius: 'var(--r-md)', background: 'var(--brand-fill)', color: 'var(--brand)', fontSize: 'var(--fs-md)', fontWeight: 600 }}>
                <Loader2 size={16} style={{ animation: 'wg-spin 1.2s linear infinite', flex: '0 0 auto' }} /> Wachten op de eerste meting…
              </div>
              {!wifiOnly && <Primary onClick={() => setStep(2)} icon={<ArrowRight size={17} />} variant="soft">Eerst de vragen doen</Primary>}
              <Ghost onClick={() => { setWifiOnly(false); setStep(0) }} icon={<ArrowLeft size={15} />}>Terug</Ghost>
              <Note>Lukt het niet? De sensor werkt alleen op 2,4 GHz WiFi. Brandt het lampje niet, probeer een ander stopcontact.</Note>
            </Panel>
          ))}

          {/* 2 · house questions */}
          {step === 2 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={labelStyle}>Vraag {q + 1} van {QUESTIONS.length}</span>
                <span style={{ display: 'flex', gap: 3 }}>{QUESTIONS.map((x, i) => <span key={x.key} style={{ width: 6, height: 6, borderRadius: 3, background: answers[x.key] ? 'var(--brand)' : i === q ? 'var(--brand-300)' : 'var(--surface-tint)' }} />)}</span>
              </div>
              <h1 style={h1Style}>{question.title}</h1>
              {question.help && <P>{question.help}</P>}
              <div role="radiogroup" aria-label={question.title} style={{ display: 'grid', gap: 9, marginTop: 14 }}>
                {question.options.map((o) => {
                  const on = answers[question.key] === o.value
                  return (
                    <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => {
                      setAnswers((a) => ({ ...a, [question.key]: o.value }))
                      setTimeout(() => (q < QUESTIONS.length - 1 ? setQ(q + 1) : setStep(3)), 180)
                    }} style={{
                      display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', minHeight: 52, padding: '11px 14px', borderRadius: 'var(--r-md)', fontFamily: 'inherit', cursor: 'pointer',
                      border: `1.5px solid ${on ? 'var(--brand)' : 'var(--border)'}`, background: on ? 'var(--brand-fill)' : 'var(--surface-2)', color: 'var(--text)', boxShadow: on ? 'var(--focus)' : 'none', transition: 'background .15s, border-color .15s',
                    }}>
                      <span aria-hidden style={{ flex: '0 0 22px', height: 22, borderRadius: 11, border: `2px solid ${on ? 'var(--brand)' : 'var(--subtle)'}`, background: on ? 'var(--brand)' : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>{on && <Check size={14} strokeWidth={3} />}</span>
                      <span style={{ fontSize: 'var(--fs-lg)', fontWeight: on ? 700 : 500, lineHeight: 1.3 }}>
                        {o.label}{o.hint && <span style={{ display: 'block', fontSize: 'var(--fs-sm)', color: 'var(--muted)', fontWeight: 400, marginTop: 2 }}>{o.hint}</span>}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 22 }}>
                <Ghost inline onClick={() => (q > 0 ? setQ(q - 1) : setStep(1))} icon={<ArrowLeft size={15} />}>Terug</Ghost>
                {q < QUESTIONS.length - 1
                  ? <Ghost inline onClick={() => setQ(q + 1)} disabled={!answers[question.key]} iconRight={<ArrowRight size={15} />}>Volgende</Ghost>
                  : <Ghost inline onClick={() => setStep(3)} disabled={!allAnswered} iconRight={<ArrowRight size={15} />}>Controleren</Ghost>}
              </div>
            </div>
          )}

          {/* 3 · summary + terms */}
          {step === 3 && (
            <Panel icon={<Home />} title="Klopt dit?" lead="Tik op een antwoord om het aan te passen.">
              <dl style={{ margin: '4px 0 0', display: 'grid', gap: 0, border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
                {QUESTIONS.map((x, i) => {
                  const o = x.options.find((op) => op.value === answers[x.key])
                  return (
                    <button key={x.key} type="button" onClick={() => { setQ(i); setStep(2) }} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', padding: '9px 12px', background: i % 2 ? 'var(--surface-2)' : 'var(--surface)', border: 'none', borderBottom: i < QUESTIONS.length - 1 ? '1px solid var(--border-soft)' : 'none', fontFamily: 'inherit', cursor: 'pointer', color: 'var(--text)' }}>
                      <span style={{ minWidth: 0 }}>
                        <dt style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>{x.title}</dt>
                        <dd style={{ margin: 0, fontSize: 'var(--fs-md)', fontWeight: 700, color: o ? 'var(--text)' : 'var(--crit)' }}>{o?.label ?? 'Ontbreekt'}</dd>
                      </span>
                      <Pencil size={14} color="var(--subtle)" style={{ flex: '0 0 auto' }} />
                    </button>
                  )
                })}
              </dl>

              <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginTop: 20, padding: '13px 14px', borderRadius: 'var(--r-md)', border: `1.5px solid ${terms ? 'var(--brand)' : 'var(--border)'}`, background: terms ? 'var(--brand-fill)' : 'var(--surface-2)', cursor: 'pointer' }}>
                <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
                <span aria-hidden style={{ flex: '0 0 22px', height: 22, borderRadius: 6, border: `2px solid ${terms ? 'var(--brand)' : 'var(--subtle)'}`, background: terms ? 'var(--brand)' : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', marginTop: 1 }}>{terms && <Check size={14} strokeWidth={3} />}</span>
                <span style={{ fontSize: 'var(--fs-md)', color: 'var(--text)', lineHeight: 1.5 }}>
                  Ik ga akkoord met de <a href={withBase('/voorwaarden')} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()} style={{ color: 'var(--brand)', fontWeight: 700 }}>algemene voorwaarden</a> en met het opslaan van de metingen van deze sensor.
                </span>
              </label>

              {locked && (
                <Note icon={<Plug size={16} />}>
                  <b style={{ color: 'var(--text)' }}>Bevestig dat je de sensor in handen hebt.</b> Haal de stekker eruit, steek hem er weer in en wacht tot het lampje brandt (ongeveer een minuut). Klik daarna opnieuw op Opslaan.
                  {status?.recent_boot ? ' De sensor is net opnieuw gestart — je kunt nu opslaan.' : ''}
                </Note>
              )}
              <Primary onClick={submitProfile} disabled={!allAnswered || !terms || saving} icon={saving ? <Loader2 size={17} style={{ animation: 'wg-spin 1.2s linear infinite' }} /> : <Check size={17} strokeWidth={3} />}>{saving ? 'Opslaan…' : overwrite ? 'Overdragen en opslaan' : 'Opslaan'}</Primary>
              <Ghost onClick={() => { setQ(QUESTIONS.length - 1); setStep(2) }} icon={<ArrowLeft size={15} />}>Terug</Ghost>
            </Panel>
          )}

          {/* 4 · contact for the household report (optional) */}
          {step === 4 && (
            <Panel icon={<Mail />} title="Wil je een rapport over je eigen huis?" lead="Dan sturen we je af en toe een overzicht van de lucht in jouw kamer, met tips. Dit is optioneel.">
              <label htmlFor="c-name" style={labelStyle}>Naam</label>
              <input id="c-name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} placeholder="bijv. Fam. Jansen" autoComplete="name" style={inputStyle} />
              <label htmlFor="c-email" style={labelStyle}>E-mailadres voor het rapport</label>
              <input id="c-email" type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} placeholder="jouw@email.nl" autoComplete="email" inputMode="email" style={inputStyle} />
              <label htmlFor="c-addr" style={labelStyle}>Adres of woning (voor de installateur)</label>
              <input id="c-addr" value={contact.address_note} onChange={(e) => setContact({ ...contact, address_note: e.target.value })} placeholder="bijv. Kerkstraat 12, 3-hoog" autoComplete="street-address" style={inputStyle} />
              <Note icon={<ShieldCheck size={16} />}>Deze gegevens staan los van de metingen en zijn alleen zichtbaar voor de beheerder van de pilot. Je kunt ze op elk moment laten verwijderen.</Note>
              <Primary onClick={() => submitContact(false)} disabled={saving} icon={<ArrowRight size={17} />}>{saving ? 'Opslaan…' : 'Opslaan'}</Primary>
              <Ghost onClick={() => submitContact(true)}>Overslaan</Ghost>
            </Panel>
          )}

          {/* 5 · done */}
          {step === 5 && (
            <Panel icon={<PartyPopper />} tone="ok" title="Klaar, bedankt!" lead={`${saved ? (overwrite ? 'De sensor is overgedragen; de vorige bewoner is losgekoppeld. ' : 'Je antwoorden zijn opgeslagen. ') : ''}${status?.online ? `Sensor ${nr} meet en stuurt zijn metingen door.` : `Zodra sensor ${nr} op WiFi zit, begint hij vanzelf met meten.`}`}>
              {contactSaved && <P><b style={{ color: 'var(--text)' }}>Je krijgt het rapport per e-mail.</b></P>}
              <P>Je hoeft verder niets te doen. Wil je zelf zien hoe de lucht in je huis is? Dan kun je een account maken en de sensor aan jezelf koppelen. Dat is helemaal optioneel.</P>
              <a href={withBase(`/koppel?code=${encodeURIComponent(code)}`)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--brand)', fontWeight: 700, fontSize: 'var(--fs-md)', marginTop: 4 }}>Eigen account maken en koppelen <ArrowRight size={15} /></a>
            </Panel>
          )}
        </div>
        <p style={{ textAlign: 'center', fontSize: 'var(--fs-xs)', color: 'var(--subtle)', marginTop: 18 }}>Woongezond · <a href={withBase('/voorwaarden')} style={{ color: 'inherit' }}>algemene voorwaarden</a></p>
      </div>
      <style>{`@keyframes wg-spin { to { transform: rotate(360deg) } } .wg-primary:not(:disabled):hover { filter: brightness(1.05) } .wg-primary:active { transform: translateY(1px) }`}</style>
    </div>
  )
}

/* ---------- building blocks, in the admin's visual language ---------- */
const h1Style: React.CSSProperties = { fontSize: 24, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.02em', lineHeight: 1.2, margin: '0 0 8px' }
const labelStyle: React.CSSProperties = { fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }
const inputStyle: React.CSSProperties = { width: '100%', padding: '12px 13px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', fontSize: 18, letterSpacing: '0.04em', background: 'var(--surface-2)', color: 'var(--text)', outline: 'none', fontFamily: 'inherit', marginBottom: 14, boxSizing: 'border-box' }

function Panel({ icon, tone = 'brand', title, lead, children }: { icon: React.ReactNode; tone?: 'brand' | 'ok'; title: string; lead?: string; children: React.ReactNode }) {
  const color = tone === 'ok' ? 'var(--ok)' : 'var(--brand)'
  const fill = tone === 'ok' ? 'var(--ok-fill)' : 'var(--brand-fill)'
  return (
    <div>
      <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, borderRadius: 16, background: fill, color, marginBottom: 16 }}>
        <span style={{ display: 'inline-flex' }}>{icon && <IconSized>{icon}</IconSized>}</span>
      </span>
      <h1 style={h1Style}>{title}</h1>
      {lead && <p style={{ fontSize: 'var(--fs-lg)', color: 'var(--muted)', lineHeight: 1.5, margin: '0 0 18px' }}>{lead}</p>}
      {children}
    </div>
  )
}
function IconSized({ children }: { children: React.ReactNode }) {
  // lucide icons take size via props; give every panel badge the same size.
  return isValidElement<{ size?: number; strokeWidth?: number }>(children) ? cloneElement(children, { size: 26, strokeWidth: 2.2 }) : <>{children}</>
}
function P({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 'var(--fs-md)', color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 12px' }}>{children}</p>
}
function Note({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 'var(--fs-sm)', color: 'var(--muted)', lineHeight: 1.55, marginTop: 14, padding: '11px 13px', background: 'var(--surface-tint)', borderRadius: 'var(--r-md)' }}>
      {icon && <span style={{ color: 'var(--brand)', flex: '0 0 auto', marginTop: 1 }}>{icon}</span>}<span>{children}</span>
    </div>
  )
}
function Code({ children }: { children: React.ReactNode }) {
  return <code style={{ fontWeight: 700, color: 'var(--brand-800)', background: 'var(--brand-fill)', padding: '2px 8px', borderRadius: 6, fontSize: '0.95em' }}>{children}</code>
}
function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol style={{ margin: '0 0 6px', padding: 0, listStyle: 'none', display: 'grid', gap: 12 }}>
      {items.map((it, i) => (
        <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', fontSize: 'var(--fs-lg)', color: 'var(--text)', lineHeight: 1.45 }}>
          <span style={{ flex: '0 0 28px', height: 28, borderRadius: 14, background: GRADIENT, color: '#fff', fontWeight: 800, fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-xs)' }}>{i + 1}</span>
          <span>{it}</span>
        </li>
      ))}
    </ol>
  )
}
function Choice({ icon, title, text, onClick }: { icon: React.ReactNode; title: string; text: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', width: '100%', textAlign: 'left', padding: '14px 14px', marginTop: 10, borderRadius: 'var(--r-md)', border: '1.5px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontFamily: 'inherit', cursor: 'pointer' }}>
      <span style={{ flex: '0 0 40px', height: 40, borderRadius: 12, background: 'var(--brand-fill)', color: 'var(--brand)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</span>
      <span><span style={{ display: 'block', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 2 }}>{title}</span><span style={{ display: 'block', fontSize: 'var(--fs-sm)', color: 'var(--muted)', lineHeight: 1.5 }}>{text}</span></span>
      <ArrowRight size={16} color="var(--subtle)" style={{ flex: '0 0 auto', alignSelf: 'center' }} />
    </button>
  )
}
function Primary({ children, onClick, disabled, icon, variant = 'solid' }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; icon?: React.ReactNode; variant?: 'solid' | 'soft' }) {
  const solid = variant === 'solid'
  return (
    <button type="button" className="wg-primary" onClick={onClick} disabled={disabled} style={{
      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 13, marginTop: 18,
      background: solid ? GRADIENT : 'var(--brand-fill)', color: solid ? '#fff' : 'var(--brand-800)', border: solid ? 'none' : '1px solid color-mix(in srgb, var(--brand) 30%, transparent)',
      borderRadius: 'var(--r-md)', fontSize: 'var(--fs-lg)', fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', boxShadow: solid ? 'var(--shadow-sm)' : 'none', fontFamily: 'inherit', opacity: disabled ? 0.55 : 1, transition: 'opacity .15s',
    }}>{children}{icon}</button>
  )
}
function Ghost({ children, onClick, disabled, icon, iconRight, inline }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; icon?: React.ReactNode; iconRight?: React.ReactNode; inline?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: inline ? 'auto' : '100%', padding: inline ? '8px 10px' : 11, marginTop: inline ? 0 : 8,
      background: 'none', border: 'none', color: disabled ? 'var(--subtle)' : 'var(--brand)', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-md)', fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: disabled ? 0.6 : 1,
    }}>{icon}{children}{iconRight}</button>
  )
}

export default function StartPage() {
  return <Suspense fallback={null}><StartInner /></Suspense>
}
