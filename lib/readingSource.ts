// Welke temperatuur en luchtvochtigheid de app gebruikt: gemeten of gecorrigeerd.
//
// De SCD41 warmt mee met de ESP32 in hetzelfde kastje en leest ~1,5 °C te hoog. De database
// bewaart beide (migratie 20261001120000): `temperature`/`humidity` zijn de ruwe meting,
// `temperature_corrected`/`humidity_corrected` zijn omgerekend (vocht bij gelijke
// dampspanning). Met NEXT_PUBLIC_TEMPERATURE_SOURCE=corrected (dev) krijgen alle rijen de
// gecorrigeerde waarden onder de vertrouwde namen `temperature`/`humidity`, zodat elke
// berekening ze vanzelf gebruikt, en de ruwe waarden als `temperature_raw`/`humidity_raw`
// voor de grijze lijn in de grafiek. Zonder de variabele (prod) verandert er niets.
//
// Uitgaande post (weekmail, rapport, meldingen) en de ML-hertraining blijven bewust op de
// ruwe meting tot de correctie gevalideerd is; die paden gebruiken deze helper niet.
// ml_models deelt prod en dev één rij per gebruiker — een model op gecorrigeerde data zou
// ongemerkt in prod belanden.

export const TEMPERATURE_OFFSET_C = 1.5 // gelijk houden aan de migratie

export const USE_CORRECTED = process.env.NEXT_PUBLIC_TEMPERATURE_SOURCE === 'corrected'

/**
 * PostgREST-select voor meetrijen: `created_at, co2, temperature, humidity` (+ ruw in dev).
 * Getypt als de gewone select: de rijen hebben dezelfde vorm, de ruwe velden zijn optioneel
 * (SensorRow) en de type-parser van supabase-js kan geen wisselende string lezen.
 */
export const READING_SELECT = (USE_CORRECTED
  ? 'created_at, co2, temperature:temperature_corrected, humidity:humidity_corrected, temperature_raw:temperature, humidity_raw:humidity'
  : 'created_at, co2, temperature, humidity') as 'created_at, co2, temperature, humidity'

/** Rij uit de RPC air_quality_bucketed → gekozen bron onder de gewone namen. */
export function pickBucketedSource<T extends Record<string, any>>(r: T): T {
  if (!USE_CORRECTED || r.temperature_corrected === undefined) return r
  return {
    ...r,
    temperature: r.temperature_corrected, humidity: r.humidity_corrected,
    temperature_min: r.temperature_corrected_min, temperature_max: r.temperature_corrected_max,
    humidity_min: r.humidity_corrected_min, humidity_max: r.humidity_corrected_max,
    temperature_raw: r.temperature, humidity_raw: r.humidity,
  }
}
