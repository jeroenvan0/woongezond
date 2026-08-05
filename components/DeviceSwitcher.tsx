'use client'
import { useEffect, useState, useRef } from 'react'
import { ChevronDown, Cpu, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useSelectedDevice, setSelectedDevice } from '@/lib/useSelectedDevice'

interface Device {
  id: string
  name: string
  location: string | null
}

/**
 * Device identity + switcher in the shell (6.1, closes I1). Before this there was
 * no device identity anywhere in the UI — the KPIs silently showed the newest
 * reading from any device on the account. This names the device and lets the
 * resident scope the headline reading to one of them ("Alle sensoren" keeps the old
 * merged behaviour).
 */
export default function DeviceSwitcher() {
  const supabase = createClient()
  const selected = useSelectedDevice()
  const [devices, setDevices] = useState<Device[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('devices')
        .select('id,name,location')
        .eq('active', true)
        .order('name')
      setDevices((data as Device[]) ?? [])
    })()
  }, [supabase])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  // Only show the control once there is a real choice to make.
  if (devices.length < 2) return null

  const current = devices.find((d) => d.id === selected)
  const label = current ? current.name : 'Alle sensoren'

  const pick = (id: string | null) => {
    setSelectedDevice(id)
    setOpen(false)
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Sensor kiezen"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 11px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', fontSize: 'var(--fs-sm)', fontWeight: 600, maxWidth: 200 }}
      >
        <Cpu size={14} style={{ flexShrink: 0, color: 'var(--brand)' }} />
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        <ChevronDown size={14} style={{ flexShrink: 0, color: 'var(--muted)' }} />
      </button>
      {open && (
        <div
          role="listbox"
          style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 60, minWidth: 200, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-lg)', padding: 5 }}
        >
          {[{ id: null as string | null, name: 'Alle sensoren', location: null }, ...devices].map((d) => {
            const active = (d.id ?? null) === (selected ?? null)
            return (
              <button
                key={d.id ?? 'all'}
                role="option"
                aria-selected={active}
                onClick={() => pick(d.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 'var(--r-sm)', border: 'none', background: active ? 'var(--brand-fill)' : 'transparent', color: active ? 'var(--brand)' : 'var(--text)', cursor: 'pointer', fontSize: 'var(--fs-sm)', fontWeight: active ? 600 : 500 }}
              >
                <Check size={13} style={{ opacity: active ? 1 : 0, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>
                  {d.location && <span style={{ display: 'block', fontSize: 'var(--fs-2xs)', color: 'var(--subtle)' }}>{d.location}</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
