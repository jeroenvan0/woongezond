'use client'
import { useEffect, useState, useCallback } from 'react'
import { Brain, RotateCw } from 'lucide-react'
import { withBase } from '@/lib/basePath'
import { getSeries } from '@/lib/useSeries'
import { buildFeatureVector, predict, ModelWeights, SensorReading, Prediction } from '@/lib/ml'
import { co2Status, rhStatus, mouldStatus } from '@/lib/calculations'

interface ModelMeta {
  sampleCount: number
  trainedAt: string
  metrics: { mae: number; rmse: number }
}

export default function MLPredictionCard() {
  const [model, setModel] = useState<ModelWeights | null>(null)
  const [meta, setMeta] = useState<ModelMeta | null>(null)
  const [pred, setPred] = useState<Prediction | null>(null)
  const [loading, setLoading] = useState(true)
  const [training, setTraining] = useState(false)
  const [trainMsg, setTrainMsg] = useState('')

  const buildPrediction = useCallback(async (m: ModelWeights) => {
    const d = await getSeries(4320) // last 3 days, shared cache/dedupe
    const readings: SensorReading[] = (d.rows ?? [])
      .filter((x: any) => x.co2 != null && x.temperature != null && x.humidity != null)
      .map((x: any) => ({
        timestamp: new Date(x.created_at).getTime(),
        co2: +x.co2,
        temperature: +x.temperature,
        humidity: +x.humidity,
      }))
    if (readings.length < 2) {
      setPred(null)
      return
    }
    try {
      setPred(predict(m, buildFeatureVector(readings)))
    } catch {
      setPred(null)
    }
  }, [])

  const loadModel = useCallback(async () => {
    setLoading(true)
    const r = await fetch(withBase('/api/ml/model'))
    const d = await r.json()
    setModel(d.model)
    setMeta(d.meta)
    if (d.model) await buildPrediction(d.model)
    setLoading(false)
  }, [buildPrediction])

  useEffect(() => {
    loadModel()
  }, [loadModel])

  async function retrain() {
    setTraining(true)
    setTrainMsg('')
    try {
      const r = await fetch(withBase('/api/ml/retrain'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const d = await r.json()
      if (d.ok) {
        setTrainMsg(`Getraind op ${d.sampleCount} samples · MAE ${d.metrics.mae.toFixed(0)}`)
        await loadModel()
      } else if (d.reason === 'insufficient_data' || d.reason === 'insufficient_samples') {
        setTrainMsg('Nog niet genoeg data om te trainen — blijf meten.')
      } else {
        setTrainMsg('Trainen mislukt.')
      }
    } catch {
      setTrainMsg('Trainen mislukt.')
    } finally {
      setTraining(false)
    }
  }

  const wrap: React.CSSProperties = {
    background: 'var(--accent-fill)',
    border: '1px solid var(--border)',
    borderLeft: '3px solid var(--accent)',
    borderRadius: 'var(--r-lg)',
    padding: '16px 18px',
    marginBottom: 14,
  }

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
      <Brain size={16} color="var(--accent)" />
      <span style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text)' }}>ML-voorspelling</span>
      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>(op basis van jouw data)</span>
      {meta && (
        <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-2xs)', color: 'var(--subtle)' }}>
          {meta.sampleCount} samples · MAE {meta.metrics.mae.toFixed(0)}
        </span>
      )}
    </div>
  )

  if (loading)
    return (
      <div style={wrap}>
        {header}
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Model laden…</div>
      </div>
    )

  if (!model)
    return (
      <div style={wrap}>
        {header}
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>
          Nog geen getraind model — ML-voorspelling beschikbaar na ~2 weken meten. Je kunt nu alvast trainen op de
          beschikbare data.
        </div>
        <button
          onClick={retrain}
          disabled={training}
          style={{ padding: '8px 14px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'pointer', opacity: training ? 0.7 : 1 }}
        >
          {training ? 'Trainen…' : 'Model trainen'}
        </button>
        <span aria-live="polite" style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginLeft: 10 }}>{trainMsg}</span>
      </div>
    )

  const conf = pred ? Math.round(pred.confidence * 100) : 0
  const cell = (label: string, value: string, sub: string, color: string) => (
    <div style={{ flex: 1, minWidth: 96 }}>
      <div style={{ fontSize: 'var(--fs-2xs)', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--text)', lineHeight: 1.1, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 'var(--fs-xs)', color, fontWeight: 600 }}>{sub}</div>
    </div>
  )

  return (
    <div style={wrap}>
      {header}
      {pred ? (
        <>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {cell('CO₂ +1u', `${pred.co2_1h.toFixed(0)}`, co2Status(pred.co2_1h).label, co2Status(pred.co2_1h).color)}
            {cell('CO₂ +3u', `${pred.co2_3h.toFixed(0)}`, 'ppm verwacht', 'var(--muted)')}
            {cell('RV +1u', `${pred.rh_1h.toFixed(0)}%`, rhStatus(pred.rh_1h).label, rhStatus(pred.rh_1h).color)}
            {cell('Schimmel', `${pred.moldRisk.toFixed(0)}`, mouldStatus(pred.moldRisk).label, mouldStatus(pred.moldRisk).color)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
            <div style={{ flex: 1, height: 5, background: 'var(--border)', borderRadius: 3, maxWidth: 160 }}>
              <div style={{ width: `${conf}%`, height: '100%', background: 'var(--accent)', borderRadius: 3 }} />
            </div>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>Betrouwbaarheid {conf}%</span>
            <button
              onClick={retrain}
              disabled={training}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 'auto', padding: '5px 11px', background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-xs)', fontWeight: 600, cursor: 'pointer', opacity: training ? 0.7 : 1 }}
            >
              <RotateCw size={12} /> {training ? 'Trainen…' : 'Hertrainen'}
            </button>
          </div>
          <div aria-live="polite" style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginTop: 6 }}>{trainMsg}</div>
        </>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Onvoldoende recente metingen voor een voorspelling.</div>
      )}
    </div>
  )
}
