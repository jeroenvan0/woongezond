'use client'
import { ReactNode } from 'react'

export default function ChartCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px 10px', boxShadow: 'var(--shadow-xs)', marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>{label}</div>
      {children}
    </div>
  )
}
