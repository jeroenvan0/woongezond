// The house questions a resident answers on /start (docs/pilot-cockpit-plan.md §2b).
//
// One place for the question set so the wizard, the profile API and the cockpit agree.
// Every question is a single tap; ten questions ≈ 90 seconds. Each one exists because it
// moves a number the science layer uses (CO₂ build-up, mould risk, insulation class) —
// see CALCULATIONS.md. Nothing here identifies a person.

export interface Option { value: string; label: string; hint?: string }
export interface Question {
  key: keyof HouseProfile
  title: string
  help?: string
  options: Option[]
}

export interface HouseProfile {
  room: string            // where the sensor hangs
  occupants: string       // people usually in that room at night → CO₂ source strength
  house_type: string
  build_period: string    // insulation era (1975 cavity walls, 1992 Bouwbesluit, 2006 EPC)
  glazing: string         // strongest single proxy for insulation class
  ventilation: string
  heating: string
  moisture: string        // baseline for mould risk
  laundry_indoors: string // biggest hidden moisture source in NL homes
  household_size: string
}

export const QUESTIONS: Question[] = [
  {
    key: 'room', title: 'In welke kamer hangt de sensor?',
    options: [
      { value: 'slaapkamer', label: 'Slaapkamer' }, { value: 'kinderkamer', label: 'Kinderkamer' },
      { value: 'woonkamer', label: 'Woonkamer' }, { value: 'keuken', label: 'Keuken' },
      { value: 'badkamer', label: 'Badkamer' }, { value: 'anders', label: 'Ergens anders' },
    ],
  },
  {
    key: 'occupants', title: 'Hoeveel mensen zijn er ’s nachts meestal in die kamer?',
    help: 'Elke persoon ademt CO₂ uit. Dit bepaalt hoe snel de lucht ’s nachts “vol” raakt.',
    options: [
      { value: '0', label: 'Niemand' }, { value: '1', label: '1' }, { value: '2', label: '2' },
      { value: '3', label: '3' }, { value: '4+', label: '4 of meer' },
    ],
  },
  {
    key: 'house_type', title: 'Wat voor woning is het?',
    options: [
      { value: 'appartement', label: 'Appartement / portiek' }, { value: 'tussenwoning', label: 'Tussenwoning' },
      { value: 'hoekwoning', label: 'Hoekwoning' }, { value: 'twee_onder_een_kap', label: '2-onder-1-kap' },
      { value: 'vrijstaand', label: 'Vrijstaand' },
    ],
  },
  {
    key: 'build_period', title: 'Wanneer is de woning ongeveer gebouwd?',
    help: 'Hoeft niet precies. Het bouwjaar zegt veel over de isolatie.',
    options: [
      { value: 'voor_1945', label: 'Vóór 1945' }, { value: '1945_1974', label: '1945 – 1974' },
      { value: '1975_1991', label: '1975 – 1991' }, { value: '1992_2005', label: '1992 – 2005' },
      { value: 'na_2005', label: 'Na 2005' }, { value: 'onbekend', label: 'Weet ik niet' },
    ],
  },
  {
    key: 'glazing', title: 'Wat voor glas zit er in de ramen van die kamer?',
    options: [
      { value: 'enkel', label: 'Enkel glas' }, { value: 'dubbel', label: 'Dubbel glas' },
      { value: 'hr', label: 'HR++ of driedubbel', hint: 'vaak met een klein stickertje in de hoek' },
      { value: 'onbekend', label: 'Weet ik niet' },
    ],
  },
  {
    key: 'ventilation', title: 'Hoe wordt die kamer geventileerd?',
    options: [
      { value: 'raam', label: 'Raam open zetten' }, { value: 'roosters', label: 'Roosters boven de ramen' },
      { value: 'mechanisch', label: 'Mechanische afzuiging', hint: 'een box op zolder of in de keuken' },
      { value: 'wtw', label: 'Balansventilatie (WTW)' }, { value: 'geen', label: 'Eigenlijk niet' },
      { value: 'onbekend', label: 'Weet ik niet' },
    ],
  },
  {
    key: 'heating', title: 'Hoe wordt die kamer verwarmd?',
    options: [
      { value: 'radiator', label: 'Radiator (cv)' }, { value: 'vloer', label: 'Vloerverwarming' },
      { value: 'warmtepomp', label: 'Warmtepomp' }, { value: 'elektrisch', label: 'Elektrische kachel' },
      { value: 'geen', label: 'Niet verwarmd' },
    ],
  },
  {
    key: 'moisture', title: 'Zie je vocht in die kamer?',
    options: [
      { value: 'geen', label: 'Nee' }, { value: 'condens', label: 'Soms condens op de ramen' },
      { value: 'schimmel', label: 'Er zijn schimmelplekken' },
    ],
  },
  {
    key: 'laundry_indoors', title: 'Wordt er was binnen gedroogd?',
    help: 'Eén was aan het rek brengt zo’n 2 liter water in de lucht.',
    options: [
      { value: 'nooit', label: 'Nooit' }, { value: 'soms', label: 'Soms' }, { value: 'vaak', label: 'Vaak' },
    ],
  },
  {
    key: 'household_size', title: 'Hoeveel mensen wonen er in totaal in huis?',
    options: [
      { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' },
      { value: '4', label: '4' }, { value: '5+', label: '5 of meer' },
    ],
  },
]

// Validate a raw body into a HouseProfile. Unknown keys are dropped, unknown values
// rejected, so the JSON column only ever holds values from QUESTIONS.
export function parseHouseProfile(raw: unknown): { ok: true; profile: HouseProfile } | { ok: false; missing: string[] } {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Partial<HouseProfile> = {}
  const missing: string[] = []
  for (const q of QUESTIONS) {
    const v = src[q.key]
    if (typeof v === 'string' && q.options.some((o) => o.value === v)) out[q.key] = v
    else missing.push(q.key)
  }
  return missing.length ? { ok: false, missing } : { ok: true, profile: out as HouseProfile }
}

// Derive the typed device columns the rest of the app already uses. The insulation
// class follows glazing first (it is what people actually know), then the build era.
export function deriveDeviceColumns(p: HouseProfile): {
  location: string; house_type: string; build_year: number | null; insulation: 'poor' | 'moderate' | 'good' | 'excellent'
} {
  const buildYear: Record<string, number | null> = {
    voor_1945: 1930, '1945_1974': 1960, '1975_1991': 1983, '1992_2005': 1998, na_2005: 2015, onbekend: null,
  }
  let insulation: 'poor' | 'moderate' | 'good' | 'excellent'
  if (p.glazing === 'enkel') insulation = 'poor'
  else if (p.glazing === 'hr') insulation = 'excellent'
  else if (p.glazing === 'dubbel') insulation = ['1992_2005', 'na_2005'].includes(p.build_period) ? 'good' : 'moderate'
  else insulation = ['na_2005'].includes(p.build_period) ? 'good' : ['1992_2005'].includes(p.build_period) ? 'moderate' : 'poor'
  return { location: p.room, house_type: p.house_type, build_year: buildYear[p.build_period] ?? null, insulation }
}

export const CLAIM_CODE_RE = /^DEVICE-[A-Z0-9]{4,6}$/
export function normalizeCode(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, '')
}
