'use client'

export interface Segment<T extends string | number> {
  label: string
  value: T
}

interface Props<T extends string | number> {
  options: Segment<T>[]
  value: T
  onChange: (v: T) => void
  /** Accessible name for the group. */
  ariaLabel: string
  /** Stretch each segment to fill the row (dashboard chart tabs). */
  fill?: boolean
}

/**
 * One period/tab control for the whole app (B4). Replaces the four different
 * implementations — a 7-option <select>, 3-pill, 4-pill and a 4-option <select> —
 * with a single ARIA tablist. Keyboard: arrows move, the ring comes from
 * :focus-visible in globals.css.
 */
export default function SegmentedControl<T extends string | number>({ options, value, onChange, ariaLabel, fill }: Props<T>) {
  function onKey(e: React.KeyboardEvent, i: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = e.key === 'ArrowRight' ? (i + 1) % options.length : (i - 1 + options.length) % options.length
    onChange(options[next].value)
  }
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{ display: 'inline-flex', gap: 4, background: 'var(--surface-tint)', borderRadius: 'var(--r-md)', padding: 4, flexWrap: 'wrap', width: fill ? '100%' : undefined }}
    >
      {options.map((o, i) => {
        const active = o.value === value
        return (
          <button
            key={String(o.value)}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            style={{
              flex: fill ? 1 : undefined,
              padding: '7px 12px',
              borderRadius: 'var(--r-sm)',
              border: 'none',
              cursor: 'pointer',
              fontSize: 'var(--fs-md)',
              fontWeight: active ? 600 : 500,
              background: active ? 'var(--surface)' : 'transparent',
              color: active ? 'var(--text)' : 'var(--muted)',
              boxShadow: active ? 'var(--shadow-xs)' : 'none',
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
