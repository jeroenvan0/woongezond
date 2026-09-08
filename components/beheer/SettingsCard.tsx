'use client'
import { useCallback, useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import SectionHeading from '@/components/ui/SectionHeading'
import Button from '@/components/ui/Button'
import { withBase } from '@/lib/basePath'
import { AtSign, Check, RotateCw } from 'lucide-react'

// Systeemadressen (adminportaal fase 2). Deze stonden in .env op de VPS, dus een adres
// wijzigen betekende SSH'en, een bestand aanpassen en de service herstarten. Nu staan ze in
// app_settings; is er niets ingevuld, dan geldt de env-waarde nog steeds — vandaar dat elk
// veld laat zien wáár de werkende waarde vandaan komt.
//
// Secrets staan hier bewust niet tussen; zie de toelichting in lib/settings.ts.

interface Setting {
  key: string
  label: string
  description: string
  env: string
  db_value: string | null
  env_value: string | null
  effective: string | null
  source: 'database' | 'env' | 'leeg'
}
interface LogRow {
  key: string
  old_value: string | null
  new_value: string | null
  changed_at: string
  changed_by_email: string | null
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 200,
  padding: '7px 10px',
  fontSize: 'var(--fs-sm)',
  fontFamily: 'inherit',
  border: '1px solid var(--border)',
  borderRadius: 'var(--r-sm)',
  background: 'var(--surface)',
  color: 'var(--text)',
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' })

export default function SettingsCard() {
  const [settings, setSettings] = useState<Setting[]>([])
  const [recent, setRecent] = useState<LogRow[]>([])
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const r = await fetch(withBase('/api/beheer/settings'), { cache: 'no-store' })
      if (!r.ok) return
      const d = await r.json()
      setSettings(d.settings ?? [])
      setRecent(d.recent ?? [])
      // Het invoerveld toont de opgeslagen waarde, niet de env-waarde: anders lijkt het of
      // je iets hebt ingesteld terwijl je alleen de bodem ziet staan.
      setDraft(Object.fromEntries((d.settings ?? []).map((s: Setting) => [s.key, s.db_value ?? ''])))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function save(key: string) {
    setBusy(key)
    setMsg(null)
    try {
      const r = await fetch(withBase('/api/beheer/settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: draft[key] ?? '' }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.status === 400 && d.error === 'email_invalid') setMsg('Dat is geen geldig e-mailadres. Gebruik adres@domein.nl of Naam <adres@domein.nl>.')
      else if (!r.ok) setMsg('Opslaan mislukt.')
      else { setMsg(d.unchanged ? 'Niets gewijzigd.' : 'Opgeslagen.'); await load() }
    } catch {
      setMsg('Opslaan mislukt: geen verbinding.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <SectionHeading right={<Button variant="ghost" size="sm" onClick={load} icon={<RotateCw size={13} />}>Verversen</Button>}>
        <AtSign size={15} style={{ color: 'var(--brand)' }} /> E-mailinstellingen
      </SectionHeading>

      {loading ? (
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>Laden…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          {settings.map((s) => {
            const changed = (draft[s.key] ?? '') !== (s.db_value ?? '')
            return (
              <div key={s.key}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <label htmlFor={`set-${s.key}`} style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)' }}>{s.label}</label>
                  <span style={{ fontSize: 'var(--fs-2xs)', color: s.source === 'database' ? 'var(--brand)' : 'var(--subtle)' }}>
                    {s.source === 'database' ? 'ingesteld hier' : s.source === 'env' ? `uit .env (${s.env})` : 'niet ingesteld'}
                  </span>
                </div>
                <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', margin: '2px 0 6px', lineHeight: 1.5 }}>{s.description}</p>
                <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                  <input
                    id={`set-${s.key}`}
                    value={draft[s.key] ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && changed && save(s.key)}
                    placeholder={s.env_value ?? 'adres@woongezond.com'}
                    autoComplete="off"
                    style={inputStyle}
                  />
                  <Button variant="secondary" size="sm" onClick={() => save(s.key)} disabled={!changed || busy === s.key} icon={<Check size={13} />}>
                    {busy === s.key ? 'Bezig…' : 'Opslaan'}
                  </Button>
                </div>
                {s.source === 'env' && s.env_value && (
                  <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--subtle)', margin: '4px 0 0' }}>
                    Nu actief: <code>{s.env_value}</code> — leeg laten houdt die waarde.
                  </p>
                )}
              </div>
            )
          })}

          {msg && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>{msg}</div>}

          {recent.length > 0 && (
            <div>
              <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>Laatste wijzigingen</div>
              {recent.map((r, i) => (
                <div key={i} style={{ fontSize: 'var(--fs-2xs)', color: 'var(--subtle)', padding: '2px 0' }}>
                  {fmt(r.changed_at)} · {r.key}: <code>{r.old_value ?? 'leeg'}</code> → <code>{r.new_value ?? 'leeg'}</code>
                  {r.changed_by_email ? ` · ${r.changed_by_email}` : ''}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
