export interface SensorRow {
  created_at: string
  co2: number | null
  temperature: number | null
  humidity: number | null
}

export interface ProcessedRow {
  ts: Date          // Amsterdam local time
  co2: number
  temp: number
  rh: number
  mr: number        // mould risk
  dp: number        // dewpoint
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
