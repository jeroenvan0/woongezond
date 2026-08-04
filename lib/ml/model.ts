// Ridge Regression from scratch (no ML library). Ported from ml/model.py.
import { FEATURE_NAMES, FeatureVector, ModelWeights, Prediction } from './types'

export const RIDGE_LAMBDA = 0.01
export const HOLDOUT_FRAC = 0.2
export const MODEL_VERSION = 'ridge_v1'

const clip = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// ── Small linear-algebra helpers ────────────────────────────────────────────

function matMul(A: number[][], B: number[][]): number[][] {
  const n = A.length
  const m = B[0].length
  const k = B.length
  const out = Array.from({ length: n }, () => new Array(m).fill(0))
  for (let i = 0; i < n; i++) {
    for (let p = 0; p < k; p++) {
      const a = A[i][p]
      if (a === 0) continue
      for (let j = 0; j < m; j++) out[i][j] += a * B[p][j]
    }
  }
  return out
}

function transpose(A: number[][]): number[][] {
  return A[0].map((_, j) => A.map((row) => row[j]))
}

/** Solve A·x = b for a square symmetric-ish matrix via Gaussian elimination. */
function solve(A: number[][], b: number[]): number[] {
  const n = A.length
  // Augmented matrix
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    // Partial pivot
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r
    if (pivot !== col) [M[col], M[pivot]] = [M[pivot], M[col]]
    const diag = M[col][col] || 1e-12
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = M[r][col] / diag
      if (factor === 0) continue
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c]
    }
  }
  return M.map((row, i) => row[n] / (M[i][i] || 1e-12))
}

function fitScaler(X: number[][]): { means: number[]; stds: number[] } {
  const n = X.length
  const d = X[0].length
  const means = new Array(d).fill(0)
  const stds = new Array(d).fill(0)
  for (const row of X) for (let j = 0; j < d; j++) means[j] += row[j]
  for (let j = 0; j < d; j++) means[j] /= n
  for (const row of X) for (let j = 0; j < d; j++) stds[j] += (row[j] - means[j]) ** 2
  for (let j = 0; j < d; j++) {
    stds[j] = Math.sqrt(stds[j] / n)
    if (stds[j] < 1e-9) stds[j] = 1.0
  }
  return { means, stds }
}

function scale(X: number[][], means: number[], stds: number[]): number[][] {
  return X.map((row) => row.map((v, j) => (v - means[j]) / stds[j]))
}

/** Ridge: w = (XᵀX + λI)⁻¹ Xᵀy, with intercept column (unregularised). */
function ridgeFit(X: number[][], y: number[], lambda: number): number[] {
  const nFeat = X[0].length
  const Xaug = X.map((row) => [1, ...row])
  const nAug = nFeat + 1
  const Xt = transpose(Xaug)
  const XtX = matMul(Xt, Xaug)
  for (let i = 1; i < nAug; i++) XtX[i][i] += lambda // skip intercept
  const Xty = Xt.map((row) => row.reduce((s, v, i) => s + v * y[i], 0))
  return solve(XtX, Xty)
}

function ridgePredict(w: number[], x: number[]): number {
  return w[0] + x.reduce((s, v, i) => s + v * w[i + 1], 0)
}

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length
const std = (a: number[]) => {
  const m = mean(a)
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length) || 1.0
}

export function train(X: number[][], yCo2: number[], yRh: number[], lambda = RIDGE_LAMBDA): ModelWeights {
  if (X.length < 10) throw new Error(`Need at least 10 training samples, got ${X.length}`)
  if (X[0].length !== FEATURE_NAMES.length) throw new Error(`Expected ${FEATURE_NAMES.length} features, got ${X[0].length}`)

  const nHoldout = Math.max(2, Math.floor(X.length * HOLDOUT_FRAC))
  const nTrain = X.length - nHoldout
  const Xtr = X.slice(0, nTrain)
  const Xte = X.slice(nTrain)
  const co2Tr = yCo2.slice(0, nTrain)
  const co2Te = yCo2.slice(nTrain)
  const rhTr = yRh.slice(0, nTrain)
  const rhTe = yRh.slice(nTrain)

  const { means: fMeans, stds: fStds } = fitScaler(Xtr)
  const XtrZ = scale(Xtr, fMeans, fStds)
  const XteZ = scale(Xte, fMeans, fStds)

  const co2Mean = mean(co2Tr), co2Std = std(co2Tr)
  const rhMean = mean(rhTr), rhStd = std(rhTr)
  const co2TrZ = co2Tr.map((v) => (v - co2Mean) / co2Std)
  const rhTrZ = rhTr.map((v) => (v - rhMean) / rhStd)

  const wCo2 = ridgeFit(XtrZ, co2TrZ, lambda)
  const wRh = ridgeFit(XtrZ, rhTrZ, lambda)

  const co2Pred = XteZ.map((x) => ridgePredict(wCo2, x) * co2Std + co2Mean)
  const rhPred = XteZ.map((x) => ridgePredict(wRh, x) * rhStd + rhMean)
  const maeCo2 = mean(co2Pred.map((p, i) => Math.abs(p - co2Te[i])))
  const rmseCo2 = Math.sqrt(mean(co2Pred.map((p, i) => (p - co2Te[i]) ** 2)))
  const maeRh = mean(rhPred.map((p, i) => Math.abs(p - rhTe[i])))
  const rmseRh = Math.sqrt(mean(rhPred.map((p, i) => (p - rhTe[i]) ** 2)))

  return {
    version: MODEL_VERSION,
    trainedAt: new Date().toISOString(),
    sampleCount: X.length,
    co2Coefficients: wCo2,
    rhCoefficients: wRh,
    featureMeans: fMeans,
    featureStds: fStds,
    co2TargetMean: co2Mean,
    co2TargetStd: co2Std,
    rhTargetMean: rhMean,
    rhTargetStd: rhStd,
    metrics: { mae: (maeCo2 + maeRh) / 2, rmse: (rmseCo2 + rmseRh) / 2 },
  }
}

/** Fresh-air baseline (ppm). Indoor CO₂ physically cannot sit below outdoor air. */
export const OUTDOOR_CO2 = 420

export function predict(model: ModelWeights, features: FeatureVector): Prediction {
  const xz = features.map((v, j) => (v - model.featureMeans[j]) / model.featureStds[j])
  const co2z = ridgePredict(model.co2Coefficients, xz)
  const rhz = ridgePredict(model.rhCoefficients, xz)
  const rawCo2 = co2z * model.co2TargetStd + model.co2TargetMean
  const rawRh = rhz * model.rhTargetStd + model.rhTargetMean

  const co2Now = features[0] || rawCo2 // co2_lag1h

  // Keep predictions physically plausible: CO₂ never drops below outdoor air.
  const co2_1h = clip(rawCo2, OUTDOOR_CO2, 5000)
  const rh_1h = clip(rawRh, 5, 100)

  // 3-hour outlook: a *damped* projection of the hourly trend. The old ×3 linear
  // extrapolation amplified noise into impossible (sub-outdoor / negative) values
  // — e.g. a small predicted dip became a CO₂ level never actually observed.
  const hourlyDelta = co2_1h - co2Now
  const co2_3h = clip(co2Now + hourlyDelta * 2.0, OUTDOOR_CO2, 5000)

  const moldRisk = clip((rh_1h - 42.0) * 1.2, 0, 100)

  let confidence = clip(model.sampleCount / 5000.0, 0, 0.95)
  if (model.sampleCount < 200) confidence = Math.min(confidence, 0.5)

  return { co2_1h, co2_3h, rh_1h, moldRisk, confidence, modelVersion: model.version }
}
