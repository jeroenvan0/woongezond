'use client'
import { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  children?: ReactNode
}

const base: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
  fontWeight: 600,
  fontFamily: 'inherit',
  border: '1px solid transparent',
  borderRadius: 'var(--r-sm)',
  cursor: 'pointer',
  transition: 'background .12s, color .12s, border-color .12s',
  whiteSpace: 'nowrap',
}

const sizes: Record<Size, React.CSSProperties> = {
  sm: { padding: '6px 11px', fontSize: 'var(--fs-sm)' },
  md: { padding: '9px 15px', fontSize: 'var(--fs-md)' },
}

const variants: Record<Variant, React.CSSProperties> = {
  primary: { background: 'var(--brand)', color: '#fff', borderColor: 'var(--brand)' },
  secondary: { background: 'var(--surface)', color: 'var(--text)', borderColor: 'var(--border)' },
  ghost: { background: 'transparent', color: 'var(--muted)', borderColor: 'transparent' },
  danger: { background: 'var(--crit-fill)', color: 'var(--crit)', borderColor: 'transparent' },
}

/**
 * The one button. Consolidates the ad-hoc inline-styled buttons and gives every
 * one a keyboard focus ring for free via :focus-visible (D1).
 */
export default function Button({ variant = 'secondary', size = 'md', icon, children, style, disabled, ...rest }: Props) {
  return (
    <button
      {...rest}
      disabled={disabled}
      style={{ ...base, ...sizes[size], ...variants[variant], opacity: disabled ? 0.55 : 1, cursor: disabled ? 'not-allowed' : 'pointer', ...style }}
    >
      {icon}
      {children}
    </button>
  )
}
