/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: false,
  },
  // Workaround for the Next.js 16.3.0 + Vercel regression (vercel/next.js#96646):
  // combining `output: 'standalone'` with Vercel's adapter makes onBuildComplete fail
  // with ENOENT .next/next-server.js.nft.json. Keep standalone for self-hosted/Docker
  // builds only; Vercel uses its own platform output.
  output: process.env.VERCEL ? undefined : 'standalone',
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Prevent MIME sniffing + clickjacking + referrer leakage. A strict
          // Content-Security-Policy is intentionally NOT set: the dashboard and
          // agent panel rely heavily on inline style attributes.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
        ],
      },
    ]
  },
}

module.exports = nextConfig