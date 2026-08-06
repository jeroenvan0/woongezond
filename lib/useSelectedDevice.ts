'use client'
import { useSyncExternalStore } from 'react'

// Shared selection of the "active" device across the app (6.1). The device switcher
// lives in the shell while the consumer (dashboard KPIs) lives in the page, so the
// selection needs to be shared outside React's tree — a tiny external store keyed to
// localStorage, read via useSyncExternalStore so every subscriber stays in sync.
//
// Scope: this drives both the dashboard's headline reading (a direct, device-filterable
// query) and the chart series via useSeries({ device }) → /api/data?device= (B3). The
// server RPC gained a device param in migration 20260806120100; /api/data falls back to
// all-devices if it isn't deployed yet.

const KEY = 'wz-selected-device'
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

export function setSelectedDevice(id: string | null) {
  if (typeof window === 'undefined') return
  if (id) localStorage.setItem(KEY, id)
  else localStorage.removeItem(KEY)
  emit()
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  const onStorage = (e: StorageEvent) => e.key === KEY && cb()
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

function getSnapshot(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(KEY)
}

/** null means "all devices" (the pre-6.1 behaviour). */
export function useSelectedDevice(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null)
}
