// Woongezond brand mark — a house with a heart (a healthy home), in the
// brand blue→green gradient. Pure inline SVG so it scales crisply anywhere.
export default function Logo({ size = 28 }: { size?: number }) {
  const id = 'wz-logo-grad'
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" role="img" aria-label="Woongezond" style={{ flexShrink: 0, display: 'block' }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3B82F6" />
          <stop offset="1" stopColor="#10B981" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id})`} />
      {/* roof + walls */}
      <path d="M6.6 15.6 L16 7.6 L25.4 15.6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.2 14.2 V24.4 H22.8 V14.2" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      {/* heart inside */}
      <path
        d="M16 22.4c-2-1.5-3.7-2.8-3.7-4.6 0-1.2 0.95-2.05 2.05-2.05 0.78 0 1.32 0.4 1.65 0.92 0.33-0.52 0.87-0.92 1.65-0.92 1.1 0 2.05 0.85 2.05 2.05 0 1.8-1.7 3.1-3.7 4.6Z"
        fill="#fff"
      />
    </svg>
  )
}
