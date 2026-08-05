'use client'
import { AlertTriangle, RotateCw } from 'lucide-react'

export type DataError =
  | { kind: 'rate-limited' }
  | { kind: 'server'; status?: number }
  | { kind: 'network' }
  | null

export function describeError(status: number | undefined, networkFailed: boolean): DataError {
  if (networkFailed) return { kind: 'network' }
  if (status === 429) return { kind: 'rate-limited' }
  if (status != null && status >= 400) return { kind: 'server', status }
  return null
}

const MESSAGES: Record<Exclude<NonNullable<DataError>['kind'], never>, string> = {
  'rate-limited': 'Te veel verzoeken achter elkaar — even wachten. De getoonde waarden kunnen verouderd zijn.',
  server: 'De gegevens konden niet worden opgehaald. De getoonde waarden kunnen verouderd zijn.',
  network: 'Geen verbinding met de server. De getoonde waarden kunnen verouderd zijn.',
}

/**
 * Non-blocking banner for a failed or rate-limited fetch (A5). Previously every
 * fetch error was a console.error or a swallowed .catch(() => {}), so a 429 or 500
 * looked identical to "nothing changed" while the screen kept showing old data as
 * if it were current. This makes the failure visible and offers a retry, and pairs
 * with the freshness contract that marks the stale values as stale.
 */
export default function DataBanner({ error, onRetry }: { error: DataError; onRetry?: () => void }) {
  if (!error) return null
  const msg = MESSAGES[error.kind]
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: 'var(--warn-fill)',
        border: '1px solid color-mix(in srgb, var(--warn) 30%, transparent)',
        borderLeft: '3px solid var(--warn)',
        borderRadius: 'var(--r-md)',
        padding: '10px 14px',
        marginBottom: 14,
        fontSize: 'var(--fs-sm)',
        color: 'var(--text)',
      }}
    >
      <AlertTriangle size={16} color="var(--warn)" style={{ flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{msg}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'transparent', border: '1px solid var(--warn)', color: 'var(--warn)', borderRadius: 'var(--r-sm)', padding: '4px 10px', fontSize: 'var(--fs-xs)', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          <RotateCw size={12} /> Opnieuw
        </button>
      )}
    </div>
  )
}
