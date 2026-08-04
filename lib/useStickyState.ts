'use client'
import { useEffect, useState } from 'react'

/**
 * useState that persists to localStorage under `key`. SSR-safe: starts from
 * `initial`, then hydrates from storage on mount (so filter choices survive
 * navigation between pages and reloads).
 */
export function useStickyState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw != null) setValue(JSON.parse(raw) as T)
    } catch {}
    setHydrated(true)
  }, [key])

  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {}
  }, [key, value, hydrated])

  return [value, setValue] as const
}
