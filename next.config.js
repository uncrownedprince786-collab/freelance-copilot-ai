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
}

module.exports = nextConfig