export interface SensorRow {
  created_at: string
  co2: number | null
  temperature: number | null
  humidity: number | null
  // Per blok uit /api/data (lib/bucketing.ts): laagste en hoogste meting in het blok.
  // Ontbreekt bij ruwe rijen (KPI-kaarten) en bij een oudere RPC.
  co2_min?: number | null
  co2_max?: number | null
  temperature_min?: number | null
  temperature_max?: number | null
  humidity_min?: number | null
  humidity_max?: number | null
  n?: number
}

/** Laagste en hoogste meting binnen één grafiekblok, voor de band achter de lijn. */
export interface RowBand {
  co2: [number, number]
  temp: [number, number]
  rh: [number, number]
}

export interface ProcessedRow {
  ts: Date          // Amsterdam local time
  co2: number
  temp: number
  rh: number
  mr: number        // mould risk
  dp: number        // dewpoint
  band?: RowBand    // alleen bij samengevoegde blokken met echte spreiding
}

export interface DashboardData {
  rows: ProcessedRow[]
  rawCount: number
  bucketMinutes: number
  fallback: boolean
}

export interface WeatherData {
  temp: number
  feelsLike: number
  humidity: number
  pressure: number
  windSpeed: number
  description: string
  iconCode: string
  cityName: string
  precipitation1h: number
  outdoorDewpoint: number
}

export interface PollutionData {
  aqi: number
  pm2_5: number
  pm10: number
  no2: number
  o3: number
}

export interface ScenarioInput {
  season: string
  outdoorTemp: number
  outdoorRh: number
  occupants: number
  ach: number
  heating: boolean
  windowHabit: 'never' | 'sometimes' | 'daily'
}

export interface ScenarioResult {
  co2Night: number
  co2Day: number
  indoorRh: number
  wallTemp: number
  dewpoint: number
  mouldRisk: number
  pctCo2Above1000: number
  healthScore: number
}
