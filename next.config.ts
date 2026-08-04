import type { NextConfig } from "next";

// When NEXT_PUBLIC_BASE_PATH is set (e.g. "/admin"), the whole app is served
// under that prefix. Leaving it unset serves the app at the domain root.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  basePath,
};

export default nextConfig;
