'use client'
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

// Renders a QR code for `value` as a data-URL <img>, generated client-side (no network).
// Used to print the device claim deep-link on the provisioning screen.
export default function QrImage({ value, size = 160, alt = 'QR-code' }: { value: string; size?: number; alt?: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(value, { width: size, margin: 1 })
      .then((url) => { if (!cancelled) setSrc(url) })
      .catch(() => { if (!cancelled) setSrc(null) })
    return () => { cancelled = true }
  }, [value, size])
  if (!src) return <div style={{ width: size, height: size, background: 'var(--surface-tint)', borderRadius: 'var(--r-sm)' }} />
  return <img src={src} width={size} height={size} alt={alt} style={{ borderRadius: 'var(--r-sm)', background: '#fff', padding: 6 }} />
}
