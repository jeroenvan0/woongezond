# ML module — self-learning CO₂ / RH prediction

A lightweight, self-improving forecaster built from scratch (Ridge Regression,
no ML library). Browser-safe: feature engineering + prediction run client-side;
training + persistence run in the Next.js API routes.

## Files

| File | Responsibility |
|------|----------------|
| `types.ts`    | Interfaces + stable `FEATURE_NAMES` column order |
| `features.ts` | `buildFeatureVector`, `buildTrainingSet`, lag/rolling/sin-cos helpers |
| `model.ts`    | Ridge Regression (`train`, `predict`) + from-scratch linear algebra |
| `index.ts`    | Public API — import only from `@/lib/ml` |

Persistence lives in the API routes (they hold the Supabase server client):
- `POST /api/ml/retrain` — pull the user's `air_quality`, build features, train, upsert `ml_models`
- `GET  /api/ml/model`   — return the user's stored weights

## How it works

- **Features**: CO₂ lags (1/3/6h), RH lag (1h), 24h rolling mean+std, cyclic
  time encodings (hour/dow/month as sin+cos), and exogenous slots
  (outdoor temp/RH, wind, window, occupants — 0 when unavailable).
- **Targets**: CO₂ and RH ~1h ahead (chronological windowing).
- **Model**: `w = (XᵀXᵀ + λI)⁻¹Xᵀy`, λ = 0.01, intercept unregularised,
  z-scored features and targets, last 20 % chronological holdout for MAE/RMSE.
- **Confidence**: soft function of sample count (caps at 0.5 below 200 samples,
  asymptotes to 0.95 around 5 000).

## Retrain triggers

The dashboard card exposes a manual **Hertrainen** button. For automation, call
`POST /api/ml/retrain` from a cron / Supabase scheduled function, e.g. daily.

## Swapping Ridge for a tree model later

Replace the `train` import in `app/api/ml/retrain/route.ts` with a `trainTree`
implementation that returns the same `ModelWeights` shape — nothing else changes.

## Supabase tables (already migrated)

```sql
CREATE TABLE ml_models (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  weights JSONB NOT NULL, trained_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sample_count INTEGER NOT NULL, metrics JSONB NOT NULL
);
CREATE TABLE ml_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  recommendation_id TEXT NOT NULL, was_helpful BOOLEAN NOT NULL,
  scenario_values JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- both RLS-guarded: auth.uid() = user_id
```
