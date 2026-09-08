'use client'
import { useEffect, useState, useSyncExternalStore } from 'react'

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
/** Bij welk account hoort de opgeslagen keuze (zie de uitleg bij clearSelectionIfOtherUser). */
const UID_KEY = 'wz-selected-device-uid'
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

/** De huidige keuze buiten React om (voor effecten die niet willen her-renderen). */
export function getSelectedDevice(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(KEY)
}

/**
 * localStorage hoort bij de browser, niet bij de ingelogde gebruiker. Logt er op dezelfde
 * computer een tweede account in (admin die als bewoner meekijkt, of twee bewoners op één
 * laptop), dan blijft de sensorkeuze van de vórige gebruiker staan. Dat leverde lege
 * grafieken op die de bewoner zelf niet kon herstellen: de switcher verbergt zichzelf bij
 * één sensor, dus de keuze was onzichtbaar én onbereikbaar.
 */
export function clearSelectionIfOtherUser(uid: string | null) {
  if (typeof window === 'undefined' || !uid) return
  const prev = localStorage.getItem(UID_KEY)
  localStorage.setItem(UID_KEY, uid)
  if (prev && prev !== uid) setSelectedDevice(null)
}

/**
 * De keuze staat in localStorage en is bij de eerste render (hydration) nog niet bekend —
 * useSyncExternalStore geeft dan de serversnapshot (null) terug. Een fetch die meteen op
 * mount vuurt vraagt daardoor eerst "alle sensoren" op: een verspild verzoek dat 55 seconden
 * in de cache blijft en de grafiek heel even met de verkeerde reeks vult. Wacht één tick.
 */
export function useDeviceSelectionReady(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  return ready
}

/** null means "all devices" (the pre-6.1 behaviour). */
export function useSelectedDevice(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null)
}
