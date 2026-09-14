import { describe, it, expect } from 'vitest'
import { pickCity, distanceKm, parsePlaceInput, roundCoord, type CityRow } from '@/lib/geocode'

const amsterdam: CityRow = { id: 'a', name: 'Amsterdam', lat: 52.37, lon: 4.89 }
const utrecht: CityRow = { id: 'u', name: 'Utrecht', lat: 52.09, lon: 5.12 }

describe('pickCity', () => {
  it('hergebruikt een stad op naam, ongeacht hoofdletters', () => {
    expect(pickCity([amsterdam, utrecht], { name: 'amsterdam', lat: 52.35, lon: 4.9 })?.id).toBe('a')
  })
  it('hergebruikt een stad binnen 12 km (Diemen → Amsterdam), niet daarbuiten (Haarlem)', () => {
    expect(pickCity([amsterdam, utrecht], { name: 'Diemen', lat: 52.34, lon: 4.96 })?.id).toBe('a')
    expect(pickCity([amsterdam, utrecht], { name: 'Haarlem', lat: 52.38, lon: 4.64 })).toBeNull()
  })
  it('kiest de dichtstbijzijnde als er meerdere binnen bereik liggen', () => {
    const zaandam: CityRow = { id: 'z', name: 'Zaandam', lat: 52.44, lon: 4.83 }
    expect(pickCity([amsterdam, zaandam], { name: 'Koog aan de Zaan', lat: 52.46, lon: 4.8 })?.id).toBe('z')
  })
})

describe('afstand en invoer', () => {
  it('Amsterdam–Utrecht is ~35 km', () => {
    expect(distanceKm(amsterdam, utrecht)).toBeGreaterThan(30)
    expect(distanceKm(amsterdam, utrecht)).toBeLessThan(40)
  })
  it('parsePlaceInput laat alleen bruikbare invoer door en knipt lange namen af', () => {
    expect(parsePlaceInput(null)).toBeNull()
    expect(parsePlaceInput({})).toBeNull()
    expect(parsePlaceInput({ city: '  ' })).toBeNull()
    expect(parsePlaceInput({ lat: 52.3 })).toBeNull()
    expect(parsePlaceInput({ city: 'Amsterdam' })).toEqual({ city: 'Amsterdam', lat: null, lon: null })
    expect(parsePlaceInput({ lat: 52.37, lon: 4.89 })).toEqual({ city: null, lat: 52.37, lon: 4.89 })
    expect(parsePlaceInput({ city: 'x'.repeat(200), lat: 999, lon: 4 })).toEqual({ city: 'x'.repeat(80), lat: null, lon: null })
  })
  it('coördinaten worden op 2 decimalen afgerond (~1 km)', () => {
    expect(roundCoord(52.37312)).toBe(52.37)
  })
})
