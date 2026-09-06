import { ImageResponse } from 'next/og'

// Home-screen icon (iOS "Zet op beginscherm", Android). Same mark as components/Logo,
// rendered at 180×180 with fixed brand colours — CSS variables don't exist here.
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: 180, height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #12B886 0%, #0B7A5C 100%)' }}>
        <svg width="150" height="150" viewBox="0 0 32 32" fill="none">
          <path d="M6.6 15.6 L16 7.6 L25.4 15.6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9.2 14.2 V24.4 H22.8 V14.2" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M16 22.4c-2-1.5-3.7-2.8-3.7-4.6 0-1.2 0.95-2.05 2.05-2.05 0.78 0 1.32 0.4 1.65 0.92 0.33-0.52 0.87-0.92 1.65-0.92 1.1 0 2.05 0.85 2.05 2.05 0 1.8-1.7 3.1-3.7 4.6Z" fill="#fff" />
        </svg>
      </div>
    ),
    size,
  )
}
