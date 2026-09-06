import type { NextConfig } from "next";

// When NEXT_PUBLIC_BASE_PATH is set (e.g. "/admin"), the whole app is served
// under that prefix. Leaving it unset serves the app at the domain root.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

// Content-Security-Policy is NOT set here — it is minted per request with a fresh
// nonce in proxy.ts. Setting it in both places would mean the static one silently
// overrides the nonce policy on some routes.
const securityHeaders = [
  // Redundant with the CSP's frame-ancestors for modern browsers, kept for older ones.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app needs none of these. Sensor data is not geolocation data.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // 2 years. Safe: the app is HTTPS-only behind the reverse proxy.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Let a phone on the LAN load the dev bundles (the /start wizard test via
  // http://<mac-ip>:3005). Next 16 blocks cross-origin /_next/* requests in dev otherwise,
  // which leaves a server-rendered page with no JavaScript. Dev-only setting.
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '172.16.*.*', '*.local'],
  basePath,
  // The floating Next.js badge in dev mode distracts residents during LAN tests of /start.
  devIndicators: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // API responses carry per-user data; no proxy should ever cache them.
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
