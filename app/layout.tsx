import type { Metadata } from 'next'
import { headers } from 'next/headers'
import './globals.css'

export const metadata: Metadata = {
  title: 'Woongezond — Luchtkwaliteit',
  description: 'Luchtkwaliteit dashboard',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Nonce minted per request by proxy.ts. Next stamps it onto its own bundles
  // automatically; the theme script below is ours, so it needs it explicitly.
  const nonce = (await headers()).get('x-nonce') ?? undefined

  return (
    <html lang="nl" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        {/* Applies the stored theme before first paint, so dark mode does not flash
            white. Must stay inline and synchronous for that reason.
            suppressHydrationWarning: browsers blank out the `nonce` content attribute
            once consumed, so React sees server "abc" vs client "" and would warn on
            every load. The mismatch is expected and harmless. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: `try{const t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')}catch(e){}` }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
