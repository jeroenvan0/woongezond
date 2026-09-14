// Plaats van een woning → stad voor het buitenweer (city_weather is per stad, één
// OpenWeather-call per uur per stad). Server-only: gebruikt OPENWEATHER_API_KEY.
//
// Privacy: we bewaren de stad, niet het huis. GPS-coördinaten van de telefoon worden
// eerst naar een plaatsnaam vertaald en daarna weggegooid; op devices komt de positie van
// de stad (2 decimalen ≈ 1 km). De sensor zelf heeft geen GPS.

export interface Place { name: string; lat: number; lon: number }
export interface CityRow { id: string; name: string | null; lat: number; lon: number }

const OWM = 'https://api.openweathermap.org/geo/1.0'

export const roundCoord = (x: number) => Math.round(x * 100) / 100

/** Afstand in km (haversine). */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Bestaande stad hergebruiken als de naam gelijk is (hoofdletterongevoelig) of de positie
 * binnen `withinKm` ligt; anders null (→ nieuwe rij). Twee huizen in Amsterdam delen zo één
 * weerreeks; Diemen (8 km) valt onder Amsterdam, Haarlem (18 km) niet.
 */
export function pickCity(existing: CityRow[], place: Place, withinKm = 12): CityRow | null {
  const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
  return existing.find((c) => norm(c.name) === norm(place.name) && norm(place.name))
    ?? existing.filter((c) => distanceKm(c, place) <= withinKm).sort((a, b) => distanceKm(a, place) - distanceKm(b, place))[0]
    ?? null
}

/** Vrije tekst ("Amsterdam", "Zaandam") → plaats via OpenWeather; null als onbekend. */
export async function geocodeCity(query: string, key = process.env.OPENWEATHER_API_KEY): Promise<Place | null> {
  const q = query.trim()
  if (!q || !key) return null
  try {
    const r = await fetch(`${OWM}/direct?q=${encodeURIComponent(q)},NL&limit=1&appid=${key}`, { cache: 'no-store' })
    if (!r.ok) return null
    const d = (await r.json()) as { name?: string; lat?: number; lon?: number; local_names?: Record<string, string> }[]
    const hit = d?.[0]
    if (!hit || typeof hit.lat !== 'number' || typeof hit.lon !== 'number') return null
    return { name: hit.local_names?.nl ?? hit.name ?? q, lat: roundCoord(hit.lat), lon: roundCoord(hit.lon) }
  } catch { return null }
}

/** GPS → plaatsnaam via OpenWeather; de exacte positie verlaat deze functie niet. */
export async function reverseGeocode(lat: number, lon: number, key = process.env.OPENWEATHER_API_KEY): Promise<Place | null> {
  if (!key || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
  try {
    const r = await fetch(`${OWM}/reverse?lat=${lat}&lon=${lon}&limit=1&appid=${key}`, { cache: 'no-store' })
    if (!r.ok) return null
    const d = (await r.json()) as { name?: string; lat?: number; lon?: number; local_names?: Record<string, string> }[]
    const hit = d?.[0]
    if (!hit?.name) return null
    // Positie van de plaats volgens OpenWeather, niet die van de telefoon.
    return { name: hit.local_names?.nl ?? hit.name, lat: roundCoord(hit.lat ?? lat), lon: roundCoord(hit.lon ?? lon) }
  } catch { return null }
}

export interface PlaceInput { city?: unknown; lat?: unknown; lon?: unknown }
/** Body van de wizard → schone invoer, of null als er niets bruikbaars in zit. */
export function parsePlaceInput(raw: unknown): { city: string | null; lat: number | null; lon: number | null } | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as PlaceInput
  const city = typeof p.city === 'string' && p.city.trim() ? p.city.trim().slice(0, 80) : null
  const lat = typeof p.lat === 'number' && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 ? p.lat : null
  const lon = typeof p.lon === 'number' && Number.isFinite(p.lon) && Math.abs(p.lon) <= 180 ? p.lon : null
  if (!city && (lat == null || lon == null)) return null
  return { city, lat: lat != null && lon != null ? lat : null, lon: lat != null && lon != null ? lon : null }
}

/** GPS gaat voor (nauwkeuriger dan een getypte naam); anders de naam. */
export async function resolvePlace(input: { city: string | null; lat: number | null; lon: number | null }): Promise<Place | null> {
  if (input.lat != null && input.lon != null) {
    const p = await reverseGeocode(input.lat, input.lon)
    if (p) return p
  }
  return input.city ? geocodeCity(input.city) : null
}
