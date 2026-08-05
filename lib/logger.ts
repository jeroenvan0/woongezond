// Structured server-side logging.
//
// Before this, most API routes swallowed errors in `catch {}` and nothing reached
// stdout, so `journalctl -u woongezond-react` was empty exactly when it was needed.
// One line of JSON per event, because journald keeps it intact and `jq` can filter it:
//
//   journalctl -u woongezond-react -o cat | jq 'select(.level=="error")'
//
// Never log secrets, tokens, or a resident's readings — device/user ids only.

type Level = 'info' | 'warn' | 'error'

function emit(level: Level, scope: string, msg: string, extra?: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, scope, msg, ...extra })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

// `err` is unknown in a catch block; reduce it to something loggable without
// dragging a whole stack into every line.
export function errText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  return String(e)
}

export const log = {
  info: (scope: string, msg: string, extra?: Record<string, unknown>) => emit('info', scope, msg, extra),
  warn: (scope: string, msg: string, extra?: Record<string, unknown>) => emit('warn', scope, msg, extra),
  error: (scope: string, msg: string, extra?: Record<string, unknown>) => emit('error', scope, msg, extra),
}
