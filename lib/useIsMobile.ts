'use client'
import { useEffect, useState } from 'react'

// Eén bron voor "is dit een telefoonscherm". Nodig waar CSS niet volstaat: op mobiel tonen
// we één grafiek in plaats van drie, en dat is een verschil in wát er gerenderd wordt, niet
// alleen in hoe het eruitziet. Drie grafieken verbergen met CSS zou ze wél laten tekenen —
// zonde van de rekentijd op precies het apparaat dat het minst te makken heeft.
//
// Start op `false` en zet pas na mount de echte waarde: de server weet de schermbreedte
// niet, dus elke andere startwaarde geeft een hydration-mismatch.

const QUERY = '(max-width: 639px)'

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const update = () => setMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  return mobile
}
