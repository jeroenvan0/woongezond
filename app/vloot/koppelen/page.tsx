'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import Card from '@/components/ui/Card'
import SectionHeading from '@/components/ui/SectionHeading'
import Button from '@/components/ui/Button'
import QrImage from '@/components/ui/QrImage'
import { MetricCardSkeleton } from '@/components/ui/Skeleton'
import { withBase } from '@/lib/basePath'
import { provisionWifi } from '@/lib/wifiProvision'
import { Building2, Plus, Copy, Check, Wifi, Camera, CheckCircle2, Circle, KeyRound } from 'lucide-react'

// Corporation device provisioning: add a sensor to a home with its house profile, get a QR
// claim code, upload a placement photo, and (scaffolded) push WiFi credentials.
// Design: docs/device-provisioning-design.md.

interface Device {
  id: string; name: string; location: string | null; insulation: string
  build_year: number | null; house_type: string | null; placement_note: string | null
  claimed: boolean; active: boolean; claim_code: string | null; ingest_token: string | null
}
interface Org { id: string; name: string; role: string }

const INSULATION = [
  { value: 'poor', label: 'Slecht' }, { value: 'moderate', label: 'Matig' },
  { value: 'good', label: 'Goed' }, { value: 'excellent', label: 'Uitstekend' },
]
const empty = { name: '', location: '', insulation: 'poor', build_year: '', house_type: '', placement_note: '' }

function claimUrl(code: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}${withBase('/koppel')}?code=${encodeURIComponent(code)}`
}

function ingestUrl(): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}${withBase('/api/ingest')}`
}

export default function KoppelenPage() {
  const router = useRouter()
  const supabase = createClient()
  const [orgs, setOrgs] = useState<Org[]>([])
  const [org, setOrg] = useState<string | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => { supabase.auth.getUser().then(({ data }) => { if (!data.user) router.push('/login') }) }, [supabase, router])

  const load = useCallback(async (orgId?: string | null) => {
    try {
      const q = orgId ? `/api/devices/provision?org=${encodeURIComponent(orgId)}` : '/api/devices/provision'
      const r = await fetch(withBase(q)); const d = await r.json()
      setOrgs(d.orgs ?? []); setOrg(d.org ?? null); setDevices(d.devices ?? [])
    } catch { /* keep */ } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function create() {
    setBusy(true)
    try {
      const r = await fetch(withBase('/api/devices/provision'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: org, ...form, build_year: form.build_year ? +form.build_year : null }),
      })
      if (r.ok) { setForm(empty); await load(org) }
    } finally { setBusy(false) }
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(text); setTimeout(() => setCopied(null), 1500) } catch {}
  }

  const isMember = orgs.length > 0

  return (
    <AppShell title="Sensor koppelen">
      {!loading && !isMember && (
        <Card style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
          <Building2 style={{ color: 'var(--muted)', flexShrink: 0 }} />
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>Deze pagina is voor corporatie-medewerkers. Je account is nog niet aan een organisatie gekoppeld.</div>
        </Card>
      )}

      {isMember && (
        <>
          <Card style={{ marginBottom: 'var(--sp-5)' }}>
            <SectionHeading><Plus size={14} style={{ marginRight: 4 }} /> Nieuwe sensor toevoegen</SectionHeading>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 'var(--sp-3)' }}>
              <Field label="Naam / kamer"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Slaapkamer" style={inp} /></Field>
              <Field label="Locatie (optioneel)"><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Boven, achter" style={inp} /></Field>
              <Field label="Isolatie"><select value={form.insulation} onChange={(e) => setForm({ ...form, insulation: e.target.value })} style={inp}>{INSULATION.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
              <Field label="Bouwjaar"><input type="number" value={form.build_year} onChange={(e) => setForm({ ...form, build_year: e.target.value })} placeholder="1975" style={inp} /></Field>
              <Field label="Woningtype"><input value={form.house_type} onChange={(e) => setForm({ ...form, house_type: e.target.value })} placeholder="Portiekflat" style={inp} /></Field>
              <Field label="Plaatsingsnotitie"><input value={form.placement_note} onChange={(e) => setForm({ ...form, placement_note: e.target.value })} placeholder="Hal, 1.5m hoog" style={inp} /></Field>
            </div>
            <div style={{ marginTop: 'var(--sp-4)' }}>
              <Button variant="primary" icon={<Plus size={15} />} onClick={create} disabled={busy}>Sensor aanmaken + koppelcode</Button>
            </div>
          </Card>

          <SectionHeading>Sensoren in deze woning-set</SectionHeading>
          {loading ? <MetricCardSkeleton /> : devices.length === 0 ? (
            <Card><div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>Nog geen sensoren. Voeg er hierboven één toe.</div></Card>
          ) : (
            <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              {devices.map((d) => (
                <DeviceCard key={d.id} d={d} supabase={supabase} copied={copied} onCopy={copy} />
              ))}
            </div>
          )}
        </>
      )}
    </AppShell>
  )
}

function DeviceCard({ d, supabase, copied, onCopy }: { d: Device; supabase: ReturnType<typeof createClient>; copied: string | null; onCopy: (t: string) => void }) {
  const [wifiMsg, setWifiMsg] = useState<string | null>(null)
  const [ssid, setSsid] = useState('')
  const [pw, setPw] = useState('')
  const [photoMsg, setPhotoMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function pushWifi() {
    setWifiMsg(null)
    const res = await provisionWifi({ ssid, password: pw })
    setWifiMsg(res.status === 'ok' ? 'Verbonden met WiFi.' : res.reason)
  }

  async function uploadPhoto(file: File) {
    setPhotoMsg('Uploaden…')
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${d.id}/${crypto.randomUUID()}.${ext}`
      const up = await supabase.storage.from('device-photos').upload(path, file, { upsert: false })
      if (up.error) { setPhotoMsg('Upload mislukt (is de bucket al aangemaakt?).'); return }
      const { error } = await supabase.from('device_photos').insert({ device_id: d.id, storage_path: path, kind: 'placement' })
      setPhotoMsg(error ? 'Opgeslagen in opslag, maar niet vastgelegd.' : 'Foto toegevoegd.')
    } catch {
      setPhotoMsg('Upload mislukt.')
    }
  }

  const url = d.claim_code ? claimUrl(d.claim_code) : null
  return (
    <Card accent={d.claimed ? 'var(--ok)' : 'var(--accent)'}>
      <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <span style={{ fontWeight: 700, color: 'var(--text)' }}>{d.name}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-xs)', fontWeight: 700, color: d.claimed ? 'var(--ok)' : 'var(--accent)' }}>
              {d.claimed ? <CheckCircle2 size={13} /> : <Circle size={13} />} {d.claimed ? 'Gekoppeld' : 'Wacht op koppeling'}
            </span>
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginTop: 2 }}>
            {[d.location, d.house_type, d.build_year ? `bouwjaar ${d.build_year}` : null, `isolatie ${d.insulation}`].filter(Boolean).join(' · ')}
          </div>
          {d.placement_note && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--subtle)', marginTop: 2 }}>{d.placement_note}</div>}

          {/* Photo + WiFi controls */}
          <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])} />
            <Button variant="secondary" size="sm" icon={<Camera size={14} />} onClick={() => fileRef.current?.click()}>Plaatsingsfoto</Button>
          </div>
          {photoMsg && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginTop: 6 }}>{photoMsg}</div>}

          {/* Firmware config — the per-device ingest endpoint + token to flash onto the
              Feather S3. This screen is org-only (RLS), so showing the token here is safe. */}
          {d.ingest_token && (
            <div style={{ marginTop: 'var(--sp-3)', paddingTop: 'var(--sp-3)', borderTop: '1px solid var(--border-soft)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>
                <KeyRound size={13} /> Firmware-config
              </div>
              <div style={{ display: 'grid', gap: 4 }}>
                <TokenRow label="Ingest-URL" value={ingestUrl()} onCopy={onCopy} copied={copied} />
                <TokenRow label="Device-token" value={d.ingest_token} onCopy={onCopy} copied={copied} mono />
              </div>
              <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--subtle)', marginTop: 6 }}>
                De sensor POST't metingen naar deze URL met header <code>x-device-token</code>. Zie docs/pilot-feather-s3-plan.md.
              </div>
            </div>
          )}

          {/* WiFi provisioning — scaffolded; provisionWifi() is a stub until firmware ships. */}
          <div style={{ marginTop: 'var(--sp-3)', paddingTop: 'var(--sp-3)', borderTop: '1px solid var(--border-soft)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>
              <Wifi size={13} /> WiFi verbinden <span style={{ fontWeight: 500, color: 'var(--subtle)' }}>(bij plaatsing)</span>
            </div>
            <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <input value={ssid} onChange={(e) => setSsid(e.target.value)} placeholder="WiFi-netwerk" aria-label="WiFi-netwerk" style={{ ...inp, minWidth: 130, flex: 1 }} />
              <input value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Wachtwoord" aria-label="WiFi-wachtwoord" type="password" style={{ ...inp, minWidth: 130, flex: 1 }} />
              <Button variant="secondary" size="sm" onClick={pushWifi} disabled={!ssid}>Verbind</Button>
            </div>
            {wifiMsg && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginTop: 6 }}>{wifiMsg}</div>}
          </div>
        </div>

        {/* QR + code */}
        {!d.claimed && url && (
          <div style={{ textAlign: 'center' }}>
            <QrImage value={url} size={130} alt={`Koppel-QR voor ${d.name}`} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: 6 }}>
              <code style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>{d.claim_code}</code>
              <button onClick={() => onCopy(d.claim_code!)} className="wz-iconbtn" title="Kopieer code" aria-label="Kopieer code" style={{ width: 26, height: 26 }}>
                {copied === d.claim_code ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

function TokenRow({ label, value, onCopy, copied, mono }: { label: string; value: string; onCopy: (t: string) => void; copied: string | null; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--subtle)', minWidth: 88 }}>{label}</span>
      <code style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-xs)', color: 'var(--text)', fontFamily: mono ? 'ui-monospace, monospace' : 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: 'var(--surface-tint)', padding: '3px 7px', borderRadius: 'var(--r-sm)' }}>{value}</code>
      <button onClick={() => onCopy(value)} className="wz-iconbtn" title={`Kopieer ${label}`} aria-label={`Kopieer ${label}`} style={{ width: 26, height: 26, flexShrink: 0 }}>
        {copied === value ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  )
}

const inp: React.CSSProperties = { width: '100%', padding: '9px 12px', fontSize: 'var(--fs-md)', fontFamily: 'inherit', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface)', color: 'var(--text)' }
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  )
}
