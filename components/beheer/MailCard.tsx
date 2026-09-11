'use client'
import { useCallback, useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import SectionHeading from '@/components/ui/SectionHeading'
import Button from '@/components/ui/Button'
import { withBase } from '@/lib/basePath'
import { FREQUENCIES, FREQUENCY_LABEL, type Frequency } from '@/lib/report/period'
import { Mail, Send, Check } from 'lucide-react'

// Rapporten per bewoner (adminportaal fase 2). De cockpit toont deze gegevens al, maar kon
// ze niet wijzigen: een verkeerd overgetypt mailadres moest in Supabase Studio worden
// rechtgezet. Hier zijn adres, naam, frequentie en toestemming aanpasbaar, met een
// testbericht om te controleren of het aankomt.
//
// Toestemming is het echte aan/uit: zonder report_consent_at stuurt de weekmail niets, ook
// niet als er een adres staat.

interface Row {
  device_id: string
  device_number: number | null
  device_name: string
  name: string | null
  email: string | null
  consent: boolean
  frequency: Frequency
  last_send: { sent_at: string; status: string; verdict: string | null } | null
}

const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', timeZone: 'Europe/Amsterdam' }) : null

const inputStyle: React.CSSProperties = {
  padding: '6px 9px',
  fontSize: 'var(--fs-sm)',
  fontFamily: 'inherit',
  border: '1px solid var(--border)',
  borderRadius: 'var(--r-sm)',
  background: 'var(--surface)',
  color: 'var(--text)',
  minWidth: 0,
}

export default function MailCard() {
  const [rows, setRows] = useState<Row[]>([])
  const [from, setFrom] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, { name: string; email: string }>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const r = await fetch(withBase('/api/beheer/mail'), { cache: 'no-store' })
      if (!r.ok) return
      const d = await r.json()
      const list: Row[] = d.list ?? []
      setRows(list)
      setFrom(d.from ?? null)
      setDraft(Object.fromEntries(list.map((x) => [x.device_id, { name: x.name ?? '', email: x.email ?? '' }])))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function post(device_id: string, payload: Record<string, unknown>, okMsg: string) {
    setBusy(device_id)
    setMsg(null)
    try {
      const r = await fetch(withBase('/api/beheer/mail'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id, ...payload }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok) { setMsg(d.to ? `${okMsg} (${d.to})` : okMsg); await load() }
      else if (d.error === 'email_invalid') setMsg('Dat e-mailadres klopt niet.')
      else if (d.error === 'email_required') setMsg('Vul eerst een e-mailadres in en sla dat op.')
      else if (d.error === 'no_address') setMsg('Deze bewoner heeft geen e-mailadres.')
      else if (d.error === 'send_failed') setMsg('Versturen mislukt — staat de Resend-sleutel goed op deze server?')
      else if (r.status === 429) setMsg('Te veel testberichten achter elkaar. Probeer het later opnieuw.')
      else setMsg('Actie mislukt.')
    } catch {
      setMsg('Actie mislukt: geen verbinding.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <SectionHeading right={from ? <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--subtle)' }}>afzender: {from}</span> : null}>
        <Mail size={15} style={{ color: 'var(--brand)' }} /> Rapporten per bewoner
      </SectionHeading>

      {loading ? (
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>Laden…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>Nog geen sensoren in deze organisatie.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          {rows.map((r) => {
            const d = draft[r.device_id] ?? { name: '', email: '' }
            const dirty = d.name !== (r.name ?? '') || d.email !== (r.email ?? '')
            const last = fmt(r.last_send?.sent_at)
            return (
              <div key={r.device_id} style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                  <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text)' }}>
                    {r.device_number != null ? `${r.device_number}. ` : ''}{r.device_name}
                  </span>
                  <span
                    style={{
                      fontSize: 'var(--fs-2xs)', fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                      background: r.consent ? 'var(--ok-fill)' : 'var(--surface-2)',
                      color: r.consent ? 'var(--ok)' : 'var(--subtle)',
                    }}
                  >
                    {r.consent ? 'ontvangt rapport' : 'geen rapport'}
                  </span>
                  {last && <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--subtle)' }}>laatst verstuurd {last}</span>}
                </div>

                {/* Op een telefoon staan deze velden onder elkaar; vanaf 600px naast elkaar. */}
                <div className="wz-mailrow">
                  <input
                    value={d.name}
                    onChange={(e) => setDraft((s) => ({ ...s, [r.device_id]: { ...d, name: e.target.value } }))}
                    placeholder="Naam"
                    aria-label={`Naam bewoner sensor ${r.device_number ?? r.device_name}`}
                    autoComplete="off"
                    style={inputStyle}
                  />
                  <input
                    value={d.email}
                    onChange={(e) => setDraft((s) => ({ ...s, [r.device_id]: { ...d, email: e.target.value } }))}
                    placeholder="e-mailadres"
                    type="email"
                    aria-label={`E-mailadres bewoner sensor ${r.device_number ?? r.device_name}`}
                    autoComplete="off"
                    style={inputStyle}
                  />
                  <select
                    value={r.frequency}
                    onChange={(e) => post(r.device_id, { action: 'save_contact', frequency: e.target.value }, 'Frequentie aangepast.')}
                    aria-label={`Frequentie sensor ${r.device_number ?? r.device_name}`}
                    style={inputStyle}
                  >
                    {FREQUENCIES.map((f) => (
                      <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', marginTop: 6 }}>
                  <Button
                    variant="secondary" size="sm" disabled={!dirty || busy === r.device_id} icon={<Check size={13} />}
                    onClick={() => post(r.device_id, { action: 'save_contact', name: d.name, email: d.email }, 'Opgeslagen.')}
                  >
                    Opslaan
                  </Button>
                  <Button
                    variant="ghost" size="sm" disabled={busy === r.device_id}
                    onClick={() => post(r.device_id, { action: 'save_contact', consent: !r.consent }, r.consent ? 'Rapport uitgezet.' : 'Rapport aangezet.')}
                  >
                    {r.consent ? 'Rapport uitzetten' : 'Rapport aanzetten'}
                  </Button>
                  <Button
                    variant="ghost" size="sm" disabled={!r.email || busy === r.device_id} icon={<Send size={13} />}
                    onClick={() => post(r.device_id, { action: 'test_mail' }, 'Testbericht verstuurd')}
                  >
                    Testbericht
                  </Button>
                </div>
              </div>
            )
          })}
          {msg && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>{msg}</div>}
        </div>
      )}
    </Card>
  )
}
