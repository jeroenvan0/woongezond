// The app is served under a base path in production (e.g. woongezond.com/admin).
// next/link, next/navigation and next/image are basePath-aware automatically,
// but raw fetch()/href to absolute paths are not — wrap those with withBase().
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

export const withBase = (path: string) => `${BASE_PATH}${path}`
