import { NextRequest, NextResponse } from 'next/server'

// Content-Security-Policy with a per-request nonce.
//
// In Next 16 this file is `proxy.ts` exporting `proxy()` — the old `middleware.ts`
// convention is gone (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
//
// Why a nonce rather than the simpler `script-src 'unsafe-inline'` in next.config.ts:
// 'unsafe-inline' on scripts gives essentially no XSS protection, and this app renders
// AI-generated markdown in the chat widget and user-controlled device names. A CSP that
// permits any inline script would be decoration.
//
// The documented cost is that every page becomes dynamically rendered — no static
// prerender, no CDN caching. Accepted deliberately: every page here is a per-user
// dashboard behind auth that fetches its data client-side, so the "static" build output
// was an empty shell and cached nothing useful. On a single VPS serving 10 households
// the extra render cost is immaterial.
//
// Two deviations from the doc's example, both forced by this codebase:
//
//   style-src keeps 'unsafe-inline' and takes NO nonce. Components style themselves with
//   React `style={{…}}` props everywhere (AppShell, NotificationBell, every chart card)
//   and a nonce does not whitelist inline style *attributes*. Adding a nonce here would
//   also make browsers ignore 'unsafe-inline' and break the entire UI. Inline styles are
//   a far weaker vector than inline scripts, so this is a reasonable place to stop.
//
//   Inter is self-hosted via next/font/google (app/layout.tsx), so it is served from
//   'self' and needs no font CSP exception (closes KI-5). The two Google Fonts origins
//   that used to sit here are gone.
//
// openweathermap.org is in img-src for the weather condition icons the dashboard
// renders straight from their CDN (app/dashboard/page.tsx). Images only — the API
// itself is called server-side and stays out of connect-src.

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const isDev = process.env.NODE_ENV === 'development'
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

  const csp = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''};
    style-src 'self' 'unsafe-inline';
    img-src 'self' blob: data: https://openweathermap.org;
    font-src 'self' data:;
    connect-src 'self' ${supabaseUrl} ${supabaseUrl.replace(/^https:/, 'wss:')};
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
  `
    .replace(/\s{2,}/g, ' ')
    .trim()

  // Next.js reads the nonce back off the REQUEST header to stamp it onto the framework
  // and page bundles, so both request and response need the policy.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export const config = {
  matcher: [
    // Skip API routes (JSON, executes nothing), static assets, and prefetches —
    // per the Next.js guide's recommendation.
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
