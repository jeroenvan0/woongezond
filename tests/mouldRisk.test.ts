import { describe, it, expect } from 'vitest'
import {
  pSat, vAbs, surfaceConditions, coldSpotFactor, vttRhCrit, vttAdvance, vttDaysTo,
  assessMould, loadLevel, profileMoisturePrior, groundTemp, demoInputs, MONTH_NORMAL_C,
  houseProfileType, growthSentence,
  type IndoorSample, type OutdoorSample, type VttState,
} from '@/lib/mouldRisk'

const H = 3_600_000
const DAY = 24 * H

describe('fysica', () => {
  it('verzadigingsdampdruk en absolute vochtigheid kloppen met tabelwaarden', () => {
    expect(pSat(20)).toBeCloseTo(23.37, 1)       // hPa
    expect(pSat(0)).toBeCloseTo(6.11, 1)
    expect(vAbs(20, 100)).toBeCloseTo(17.3, 0)   // g/m³
    expect(vAbs(20, 50)).toBeCloseTo(8.6, 0)
  })

  it('f = 1 is de luchttemperatuur, lagere f is kouder en vochtiger', () => {
    const same = surfaceConditions(20, 60, 5, 1)
    expect(same.t).toBeCloseTo(20)
    expect(same.rh).toBeCloseTo(60)
    const corner = surfaceConditions(20, 60, 5, 0.5)
    expect(corner.t).toBeCloseTo(12.5)
    expect(corner.rh).toBeGreaterThan(80)          // 60% bij 20 °C is ~97% bij 12,5 °C
    expect(surfaceConditions(20, 90, 0, 0.3).rh).toBe(100) // condens wordt afgekapt
  })
})

describe('coldSpotFactor', () => {
  const fs = (r: { f: number; source: string }) => ({ f: r.f, source: r.source })
  it('gemeten gaat voor bouwperiode, bouwperiode voor isolatieklasse', () => {
    expect(fs(coldSpotFactor({ build_period: 'voor_1945' }, 'good', 0.62))).toEqual({ f: 0.62, source: 'gemeten' })
    expect(fs(coldSpotFactor({ build_period: 'voor_1945', glazing: 'dubbel', renovation: 'nee' }, 'moderate'))).toEqual({ f: 0.5, source: 'bouwperiode' })
    expect(fs(coldSpotFactor(null, 'good'))).toEqual({ f: 0.7, source: 'isolatie' })
  })

  it('dubbel glas maakt een oud huis niet warmer; enkel glas maakt een nieuw huis wel kouder', () => {
    // De oude regel gaf sensor 2 (vóór 1945, dubbel glas) de spouwmuurwaarde.
    expect(coldSpotFactor({ build_period: 'voor_1945', glazing: 'hr', renovation: 'nee' }).f).toBe(0.5)
    expect(coldSpotFactor({ build_period: 'na_2005', glazing: 'enkel' }).f).toBe(0.5)
  })

  it('renovatie: gevelisolatie maakt een oud huis warm, onbekend maakt het vooral onzeker', () => {
    const nee = coldSpotFactor({ build_period: 'voor_1945', renovation: 'nee' })
    const gevel = coldSpotFactor({ build_period: 'voor_1945', renovation: 'gevel' })
    const deels = coldSpotFactor({ build_period: 'voor_1945', renovation: 'deels' })
    const onbekend = coldSpotFactor({ build_period: 'voor_1945', renovation: 'onbekend' })
    const leeg = coldSpotFactor({ build_period: 'voor_1945' }) // oudere vragenlijst zonder deze vraag
    expect(gevel).toMatchObject({ f: 0.7, source: 'renovatie' })
    expect(deels.f).toBe(0.55)
    expect(onbekend.f).toBeGreaterThan(nee.f)
    expect(onbekend.f).toBeLessThan(deels.f)
    expect(onbekend.sd).toBeGreaterThan(nee.sd)
    expect(leeg).toEqual(onbekend)
    // Een nieuw huis verandert niet door de vraag.
    expect(coldSpotFactor({ build_period: 'na_2005', renovation: 'gevel' }).f).toBe(0.75)
  })

  it('gemeten is het zekerst', () => {
    expect(coldSpotFactor(null, null, 0.6).sd).toBeLessThan(coldSpotFactor({ build_period: '1975_1991' }).sd)
  })

  it('negeert onzinnige metingen', () => {
    expect(coldSpotFactor({ build_period: '1992_2005' }, null, 1.4).source).toBe('bouwperiode')
  })
})

describe('VTT (Hukka & Viitanen 1999; Ojanen 2010)', () => {
  it('kritieke RV: 80% boven 20 °C, hoger als het kouder is, 85% voor matig bestand', () => {
    expect(vttRhCrit(25)).toBe(80)
    expect(vttRhCrit(5)).toBeGreaterThan(85)
    expect(vttRhCrit(25, 85)).toBe(85)
  })

  it('groeit niet onder de kritieke RV', () => {
    expect(vttAdvance({ m: 0, hoursUnfavourable: 0 }, 20, 75, 24).m).toBe(0)
  })

  it('tijdschalen in dagen, niet uren: gevoelig materiaal bij 20 °C/95% begint na ~3–4 weken', () => {
    const d = vttDaysTo(1, 20, 95, 'S')!
    expect(d).toBeGreaterThan(18)
    expect(d).toBeLessThan(32)
    // Onbehandeld hout sneller, beton veel langzamer.
    expect(vttDaysTo(1, 20, 95, 'VS')!).toBeLessThan(d)
    expect(vttDaysTo(1, 20, 95, 'MR', 365) ?? Infinity).toBeGreaterThan(d * 3)
  })

  it('vochtiger groeit sneller en hoger (de oude port deed het omgekeerde)', () => {
    let a: VttState = { m: 0, hoursUnfavourable: 0 }
    let b: VttState = { m: 0, hoursUnfavourable: 0 }
    for (let h = 0; h < 120 * 24; h++) { a = vttAdvance(a, 15, 88, 1); b = vttAdvance(b, 15, 98, 1) }
    expect(b.m).toBeGreaterThan(a.m)
  })

  it('blijft onder M_max: bij 85% nooit zichtbare schimmel op gevoelig materiaal', () => {
    let s: VttState = { m: 0, hoursUnfavourable: 0 }
    for (let h = 0; h < 365 * 24; h++) s = vttAdvance(s, 20, 85, 1)
    expect(s.m).toBeLessThan(2)
  })

  it('afname volgens het model: 6 uur −0,032/dag, dan een dag niets, daarna −0,016/dag', () => {
    const start: VttState = { m: 2, hoursUnfavourable: 0 }
    const after6 = vttAdvance(start, 20, 50, 6, 'VS')
    expect(start.m - after6.m).toBeCloseTo((0.032 * 6) / 24, 6)
    const after24 = vttAdvance(after6, 20, 50, 18, 'VS')
    expect(after24.m).toBeCloseTo(after6.m, 9)
    const week = vttAdvance(after24, 20, 50, 7 * 24, 'VS')
    expect(after24.m - week.m).toBeCloseTo(0.016 * 7, 6)
    // Gevoelig materiaal (cMat 0,5) neemt half zo snel af: geheugen van weken, niet uren.
    expect(vttAdvance({ m: 1, hoursUnfavourable: 0 }, 20, 50, 24, 'S').m).toBeGreaterThan(0.99)
  })
})

describe('vochtbelasting', () => {
  it('klassen rond de ISO 13788-waarden voor woningen (~4 en ~6 g/m³)', () => {
    expect(loadLevel(2)).toBe('laag')
    expect(loadLevel(4)).toBe('normaal')
    expect(loadLevel(6)).toBe('hoog')
    expect(loadLevel(8)).toBe('zeer hoog')
  })

  it('schatting uit de vragenlijst: was binnen en geen ventilatie verhogen, WTW verlaagt', () => {
    expect(profileMoisturePrior({ laundry_indoors: 'vaak', ventilation: 'geen' })).toBeGreaterThan(profileMoisturePrior({}))
    expect(profileMoisturePrior({ ventilation: 'wtw' })).toBeLessThan(profileMoisturePrior({}))
  })
})

// Synthetisch huis: binnen T/RV vast, buiten vast; elke 3 uur, `days` dagen.
function house(opts: { ti: number; dv: number; te: number; rhe: number; days: number; weather?: boolean }) {
  const now = Date.parse('2026-11-20T12:00:00Z')
  const indoor: IndoorSample[] = []
  const outdoor: OutdoorSample[] = []
  for (let ts = now - opts.days * DAY; ts <= now; ts += H) {
    if (opts.weather !== false) outdoor.push({ ts, t: opts.te, rh: opts.rhe })
    if ((ts - now) % (3 * H) === 0) {
      const vi = vAbs(opts.te, opts.rhe) + opts.dv
      const rh = ((vi * (opts.ti + 273.15)) / 216.7 / pSat(opts.ti)) * 100
      indoor.push({ ts, t: opts.ti, rh })
    }
  }
  return { indoor, outdoor, now }
}

describe('assessMould', () => {
  it('droog, goed geïsoleerd huis: overal laag', () => {
    const h = house({ ti: 20, dv: 1.5, te: 6, rhe: 85, days: 30 })
    const r = assessMould({ ...h, profile: { build_period: 'na_2005', room: 'woonkamer' } })
    expect(r.now.level).toBe('laag')
    expect(r.load.level).toBe('laag')
    expect(r.load.basis).toBe('dagen')
    expect(r.winter.level).toBe('laag')
  })

  it('vochtig, ongeïsoleerd huis in de herfst: nu al risico, winter hoog, groei binnen de winter', () => {
    const h = house({ ti: 18, dv: 5, te: 8, rhe: 88, days: 60 })
    const r = assessMould({ ...h, profile: { build_period: 'voor_1945', room: 'slaapkamer' } })
    expect(r.now.pctAbove80).toBeGreaterThan(50)
    expect(r.now.level).toBe('hoog')
    expect(r.load.level).toMatch(/hoog/)
    expect(r.winter.level).toBe('hoog')
    expect(r.winter.daysToStart).not.toBeNull()
  })

  it('zomer: een risicohuis valt nu nog mee maar krijgt een hoge winterverwachting', () => {
    const now = Date.parse('2026-09-10T12:00:00Z')
    const indoor: IndoorSample[] = [], outdoor: OutdoorSample[] = []
    for (let ts = now - 14 * DAY; ts <= now; ts += H) {
      const night = new Date(ts).getUTCHours() < 6
      const te = night ? 12 : 18
      outdoor.push({ ts, t: te, rh: 75 })
      if ((ts - now) % (3 * H) === 0) {
        // Binnen ~57% bij 23 °C overdag; 's nachts ramen dicht → 2,5 g/m³ vochtoverschot
        // (≈ 6 g/m³ op winterniveau, zoals sensor 2).
        const vi = vAbs(te, 75) + (night ? 2.5 : 0.3)
        indoor.push({ ts, t: 23, rh: ((vi * 296.15) / 216.7 / pSat(23)) * 100 })
      }
    }
    const r = assessMould({ indoor, outdoor, now, profile: { build_period: 'voor_1945', room: 'slaapkamer' } })
    expect(r.now.level).toBe('laag')
    expect(r.load.basis).toBe('nachten')
    expect(r.load.reliability).toBe('laag')
    expect(r.winter.level).toBe('hoog')
    expect(r.winter.tiMeasured).toBe(false)
  })

  it('zonder weerdata de maandnormaal, geen vaste 5 °C (in augustus is de muur dus warm)', () => {
    const now = Date.parse('2026-08-15T12:00:00Z')
    const indoor: IndoorSample[] = []
    for (let ts = now - 7 * DAY; ts <= now; ts += 3 * H) indoor.push({ ts, t: 22, rh: 65 })
    const r = assessMould({ indoor, outdoor: [], now, profile: { build_period: 'voor_1945' } })
    expect(r.now.outdoorMeasured).toBe(false)
    const expected = surfaceConditions(22, 65, MONTH_NORMAL_C[7], 0.5).rh
    expect(r.now.rhSurface).toBeCloseTo(expected, 0)
    expect(r.now.rhSurface!).toBeLessThan(80)
    expect(r.load.basis).toBe('vragenlijst')
  })

  it('souterrain rekent in de zomer met de koelere bodem', () => {
    const now = Date.parse('2026-08-15T12:00:00Z')
    const h = { indoor: [] as IndoorSample[], outdoor: [] as OutdoorSample[] }
    for (let ts = now - 7 * DAY; ts <= now; ts += H) { h.outdoor.push({ ts, t: 20, rh: 70 }); if ((ts - now) % (3 * H) === 0) h.indoor.push({ ts, t: 21, rh: 70 }) }
    const ground = assessMould({ ...h, now, profile: { build_period: '1945_1974', floor: 'souterrain' } })
    const upstairs = assessMould({ ...h, now, profile: { build_period: '1945_1974', floor: '2' } })
    expect(groundTemp(now)).toBeLessThan(20)
    expect(ground.now.rhSurface!).toBeGreaterThan(upstairs.now.rhSurface! + 5)
  })

  it('voorbeelddata geeft een volledig resultaat', () => {
    const r = assessMould(demoInputs(Date.parse('2026-10-20T12:00:00Z')))
    expect(r.series.ts.length).toBeGreaterThan(100)
    expect(['laag', 'verhoogd', 'hoog']).toContain(r.winter.level)
  })
})

describe('schimmelprofiel en jaarverwachting', () => {
  it('typeert het huis naar koude plekken en vocht', () => {
    expect(houseProfileType(0.5, 6).type).toBe('koud-vochtig')
    expect(houseProfileType(0.5, 4).type).toBe('koud')
    expect(houseProfileType(0.75, 6).type).toBe('vochtig')
    expect(houseProfileType(0.75, 4).type).toBe('balans')
  })

  it('jaar: 12 maanden, 2 terug, de winter boven de zomer voor een koud en vochtig huis', () => {
    const h = house({ ti: 18, dv: 5, te: 8, rhe: 88, days: 30 })
    const r = assessMould({ ...h, profile: { build_period: 'voor_1945', room: 'slaapkamer' } })
    expect(r.year).toHaveLength(12)
    expect(r.year.filter((m) => m.isPast)).toHaveLength(2)
    expect(r.year[2].isNow).toBe(true)
    const jan = r.year.find((m) => m.label === 'jan')!
    const jul = r.year.find((m) => m.label === 'jul')!
    expect(jan.rhSurface).toBeGreaterThan(jul.rhSurface)
    expect(r.year.find((m) => m.isNow)!.measured).not.toBeNull() // er zijn metingen deze maand
    expect(r.yearGrowth.start).not.toBeNull()
    expect(growthSentence(r.yearGrowth)).toMatch(/begint|begonnen/)
  })

  it('wat helpt: elke maatregel verlaagt de hoek, alles samen het meest', () => {
    const h = house({ ti: 18, dv: 5, te: 8, rhe: 88, days: 30 })
    const r = assessMould({ ...h, profile: { build_period: 'voor_1945', laundry_indoors: 'vaak' } })
    const keys = r.whatIf.map((w) => w.key)
    // Geen antwoord op de kastvraag = misschien een kast → 'kast van de muur' hoort erbij.
    expect(keys).toEqual(['ventileren', 'was', 'kast', 'warmer', 'combi', 'isoleren', 'alles'])
    for (const w of r.whatIf) expect(w.rhSurface).toBeLessThanOrEqual(r.winter.rhSurface)
    const alles = r.whatIf.find((w) => w.key === 'alles')!
    expect(Math.min(...r.whatIf.map((w) => w.rhSurface))).toBe(alles.rhSurface)
  })

  it('goed huis: geen groei verwacht, en dat staat er ook', () => {
    const h = house({ ti: 20, dv: 1.5, te: 6, rhe: 85, days: 30 })
    const r = assessMould({ ...h, profile: { build_period: 'na_2005', room: 'woonkamer' } })
    expect(r.yearGrowth).toEqual({ start: null, visible: null })
    expect(growthSentence(r.yearGrowth)).toMatch(/geen schimmelgroei/)
    expect(r.whatIf.some((w) => w.key === 'isoleren')).toBe(false)
  })
})

describe('winterlabel volgt de verwachte groei, niet alleen de 80%-grens', () => {
  it('een gewoon huishouden in een oud huis is laag; pas veel vocht maakt het hoog', () => {
    const run = (dv: number, period: string) => {
      const h = house({ ti: 17, dv, te: 8, rhe: 85, days: 30 })
      return assessMould({ ...h, profile: { build_period: period, room: 'slaapkamer' } })
    }
    // Δv0 = dv / 0,6 bij 8 °C buiten: 1,5 → 2,5 g/m³ (gewoon), 3,6 → 6 g/m³ (veel vocht).
    expect(run(1.5, 'voor_1945').winter.level).toBe('laag')
    expect(run(3.6, 'voor_1945').winter.level).toBe('hoog')
    expect(run(3.6, 'na_2005').winter.level).not.toBe('hoog')
  })
})

describe('kans op zichtbare schimmel', () => {
  const oldHouse = (dv: number, renovation?: string) => {
    const h = house({ ti: 17, dv, te: 8, rhe: 85, days: 30 })
    return assessMould({ ...h, profile: { build_period: 'voor_1945', room: 'slaapkamer', ...(renovation ? { renovation } : {}) } })
  }

  it('is een kans tussen 0 en 1 en elke keer hetzelfde voor dezelfde invoer', () => {
    const a = oldHouse(2.4), b = oldHouse(2.4)
    expect(a.winter.pVisible).toBeGreaterThanOrEqual(0)
    expect(a.winter.pVisible).toBeLessThanOrEqual(1)
    expect(a.winter.pVisible).toBe(b.winter.pVisible)
    expect(a.winter.pGrowth).toBeGreaterThanOrEqual(a.winter.pVisible)
  })

  it('stijgt met de vochtbelasting', () => {
    const ps = [1.2, 2.4, 3.6].map((dv) => oldHouse(dv).winter.pVisible)
    expect(ps[0]).toBeLessThanOrEqual(ps[1])
    expect(ps[1]).toBeLessThanOrEqual(ps[2])
    expect(ps[2]).toBeGreaterThan(ps[0])
  })

  it('een gerenoveerd oud huis heeft een kleinere kans dan een ongerenoveerd', () => {
    expect(oldHouse(3, 'gevel').winter.pVisible).toBeLessThan(oldHouse(3, 'nee').winter.pVisible)
  })

  it('wat helpt: alles samen verlaagt de kans het meest', () => {
    const r = oldHouse(3.6)
    const alles = r.whatIf.find((w) => w.key === 'alles')!
    expect(alles.pVisible).toBe(Math.min(...r.whatIf.map((w) => w.pVisible)))
    expect(alles.pVisible).toBeLessThan(r.winter.pVisible)
  })
})

describe('achter een kast tegen de buitenmuur', () => {
  const room = (furniture?: string, dv = 2.4) => {
    const h = house({ ti: 17, dv, te: 8, rhe: 85, days: 30 })
    return assessMould({ ...h, profile: { build_period: 'voor_1945', renovation: 'nee', room: 'slaapkamer', ...(furniture ? { furniture_outer_wall: furniture } : {}) } })
  }

  it('een kast tegen de buitenmuur maakt het risico groter; onbekend zit ertussen', () => {
    const ja = room('ja').winter.pVisible, nee = room('nee').winter.pVisible, onb = room('onbekend').winter.pVisible
    expect(ja).toBeGreaterThan(nee)
    expect(onb).toBeGreaterThanOrEqual(nee)
    expect(onb).toBeLessThanOrEqual(ja)
    expect(room().winter.pVisible).toBe(onb) // oude vragenlijst zonder de vraag = onbekend
  })

  it('open hoek en kastplek staan er apart bij, de kast is kouder en natter', () => {
    const w = room('onbekend').winter
    expect(w.pFurniture).toBeGreaterThanOrEqual(w.pOpen)
    expect(w.rhSurfaceFurniture).toBeGreaterThan(w.rhSurface)
    expect(room('ja').fFurniture).toBeCloseTo(room('ja').f - 0.1, 5)
  })

  it('"kast van de muur" staat alleen bij wat helpt als er (misschien) een kast staat', () => {
    expect(room('ja').whatIf.some((w) => w.key === 'kast')).toBe(true)
    expect(room('onbekend').whatIf.some((w) => w.key === 'kast')).toBe(true)
    expect(room('nee').whatIf.some((w) => w.key === 'kast')).toBe(false)
  })

  it('label: ook microscopische groei telt (≥ 30% kans op groei = verhoogd)', async () => {
    const { probabilityLevel } = await import('@/lib/mouldRisk')
    expect(probabilityLevel(0.05, 0.35)).toBe('verhoogd')
    expect(probabilityLevel(0.05, 0.2)).toBe('laag')
    expect(probabilityLevel(0.6, 0.9)).toBe('hoog')
  })
})

describe('voorlopig', () => {
  it('twee dagen data of alleen de vragenlijst is voorlopig; een maand herfst niet', () => {
    const kort = house({ ti: 18, dv: 2, te: 8, rhe: 85, days: 2 })
    expect(assessMould({ ...kort, profile: { build_period: '1975_1991' } }).winter.provisional).toBe(true)
    const lang = house({ ti: 18, dv: 2, te: 6, rhe: 85, days: 30 })
    expect(assessMould({ ...lang, profile: { build_period: '1975_1991' } }).winter.provisional).toBe(false)
  })
})
