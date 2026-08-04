// Public API for the ML module. Import only from '@/lib/ml'.
export { buildFeatureVector, buildTrainingSet, sinCos } from './features'
export { train, predict, MODEL_VERSION, RIDGE_LAMBDA } from './model'
export type { SensorReading, FeatureVector, ModelWeights, ModelMetrics, Prediction } from './types'
export { FEATURE_NAMES } from './types'
