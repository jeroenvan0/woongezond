// Type definitions for the ML module. Ported from ml/types.py.

export interface SensorReading {
  timestamp: number // epoch ms
  co2: number
  temperature: number
  humidity: number
  outdoorTemp?: number
  outdoorHumidity?: number
  windSpeed?: number
  windowOpen?: boolean
  occupants?: number
}

// Stable feature column order — keep identical across train/save/load/predict.
export const FEATURE_NAMES = [
  'co2_lag1h',
  'co2_lag3h',
  'co2_lag6h',
  'rh_lag1h',
  'co2_rolling_mean_24h',
  'co2_rolling_std_24h',
  'hour_sin',
  'hour_cos',
  'dow_sin',
  'dow_cos',
  'month_sin',
  'month_cos',
  'outdoor_temp',
  'outdoor_rh',
  'wind_speed',
  'window_open',
  'occupants',
] as const

export type FeatureVector = number[] // length === FEATURE_NAMES.length

export interface ModelMetrics {
  mae: number
  rmse: number
}

export interface ModelWeights {
  version: string
  trainedAt: string // ISO
  sampleCount: number
  co2Coefficients: number[]
  rhCoefficients: number[]
  featureMeans: number[]
  featureStds: number[]
  co2TargetMean: number
  co2TargetStd: number
  rhTargetMean: number
  rhTargetStd: number
  metrics: ModelMetrics
}

export interface Prediction {
  co2_1h: number
  co2_3h: number
  rh_1h: number
  moldRisk: number
  confidence: number // 0–1
  modelVersion: string
}
