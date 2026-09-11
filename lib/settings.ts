import { createServiceClient } from '@/lib/supabase/service'
import { log, errText } from '@/lib/logger'

// Instellingen die een beheerder via /beheer kan wijzigen (adminportaal fase 2).
//
// Elke instelling heeft een env-variabele als bodem. Staat er niets in de database, dan
// geldt de env-waarde — precies zoals het vóór dit bestand werkte. Dat maakt de overgang
// risicoloos: niets verandert tot iemand bewust iets invult, en leegmaken zet de env-waarde
// terug in plaats van het adres weg te gooien.
//
// Secrets staan hier NIET tussen. RESEND_API_KEY en de service-role-key blijven in .env:
// een instelling die je in een scherm kunt lezen, is een instelling die met een gekaapte
// adminsessie meelekt. De adressen hieronder kunnen hooguit mail de verkeerde kant op
// sturen, en elke wijziging staat in app_settings_log.

export type SettingKey =
  | 'report_from_addr'
  | 'alert_from_addr'
  | 'support_from_addr'
  | 'support_reply_to'
  | 'support_admin_addr'

export interface SettingDef {
  key: SettingKey
  label: string
  description: string
  env: string
  kind: 'email'
}

export const SETTINGS: SettingDef[] = [
  {
    key: 'report_from_addr',
    label: 'Afzender rapporten',
    description: 'Staat als afzender op het week- of maandrapport dat de bewoner krijgt.',
    env: 'ALERT_FROM_ADDR',
    kind: 'email',
  },
  {
    key: 'alert_from_addr',
    label: 'Afzender meldingen',
    description: 'Afzender van waarschuwingen (bijvoorbeeld een sensor die stilvalt).',
    env: 'ALERT_FROM_ADDR',
    kind: 'email',
  },
  {
    key: 'support_from_addr',
    label: 'Afzender klantenservice',
    description: 'Afzender van antwoorden uit de klantenservice-inbox.',
    env: 'SUPPORT_FROM_ADDR',
    kind: 'email',
  },
  {
    key: 'support_reply_to',
    label: 'Antwoordadres',
    description: 'Waar antwoorden van bewoners op ál je mail binnenkomen. Moet een adres zijn dat Resend ontvangt.',
    env: 'SUPPORT_REPLY_TO',
    kind: 'email',
  },
  {
    key: 'support_admin_addr',
    label: 'Adres van de beheerder',
    description: 'Krijgt escalaties uit de klantenservice en systeemmeldingen.',
    env: 'SUPPORT_ADMIN_ADDR',
    kind: 'email',
  },
]

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Mail wordt in lussen verstuurd (de weekmail gaat langs elke sensor), dus één DB-hit per
// bericht is zonde. Een minuut cache is ruim korter dan de tijd tussen twee wijzigingen en
// lang genoeg om een verzendronde uit één lezing te bedienen.
const TTL_MS = 60_000
let cache: { at: number; values: Map<string, string> } | null = null

async function loadAll(): Promise<Map<string, string>> {
  const now = Date.now()
  if (cache && now - cache.at < TTL_MS) return cache.values
  const values = new Map<string, string>()
  try {
    const s = createServiceClient()
    const { data, error } = await s.from('app_settings').select('key, value')
    if (error) throw new Error(error.message)
    for (const row of data ?? []) if (row.value) values.set(row.key, row.value)
    cache = { at: now, values }
  } catch (e) {
    // Database onbereikbaar of tabel nog niet gemigreerd: dan geldt env, zoals altijd.
    // Nooit een verzendronde laten klappen op een instellingenlookup.
    log.warn('settings', 'kon instellingen niet laden; env-waarden gelden', { detail: errText(e) })
    return cache?.values ?? values
  }
  return values
}

/** De werkende waarde: database wint, anders env, anders null. */
export async function getSetting(key: SettingKey): Promise<string | null> {
  const def = SETTINGS.find((d) => d.key === key)
  const values = await loadAll()
  return values.get(key) || (def ? process.env[def.env] ?? null : null)
}

/** Waar komt de werkende waarde vandaan? Voor de weergave in /beheer. */
export async function describeSettings() {
  const values = await loadAll()
  return SETTINGS.map((d) => {
    const db = values.get(d.key) ?? null
    const env = process.env[d.env] ?? null
    return { ...d, db_value: db, env_value: env, effective: db || env, source: db ? 'database' : env ? 'env' : 'leeg' }
  })
}

/** Afzender voor het bewonersrapport. */
export const reportFrom = async () =>
  (await getSetting('report_from_addr')) || (await getSetting('alert_from_addr')) || 'Woongezond <rapport@woongezond.com>'

/** Afzender voor klantenservice-antwoorden. */
export const supportFrom = async () =>
  (await getSetting('support_from_addr')) || (await getSetting('alert_from_addr')) || 'Woongezond <hulp@woongezond.com>'

/** Adres van de beheerder; leeg betekent "niemand mailen". */
export const adminAddr = async () => (await getSetting('support_admin_addr')) || ''

/** Cache leegmaken na een wijziging, zodat het scherm meteen klopt. */
export function invalidateSettings() {
  cache = null
}
