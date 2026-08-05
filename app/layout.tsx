import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { Inter } from 'next/font/google'
import './globals.css'

// Self-hosted at build time (KI-5). Exposes --font-inter to globals.css and
// removes the two Google Fonts CSP origins that used to sit on the critical path.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: 'Woongezond — Luchtkwaliteit',
  description: 'Luchtkwaliteit dashboard',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Nonce minted per request by proxy.ts. Next stamps it onto its own bundles
  // automatically; the theme script below is ours, so it needs it explicitly.
  const nonce = (await headers()).get('x-nonce') ?? undefined

  return (
    <html lang="nl" className={inter.variable} suppressHydrationWarning>
      <head>
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
