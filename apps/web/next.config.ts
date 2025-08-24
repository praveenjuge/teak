import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    reactCompiler: true,
    ppr: 'incremental'
  },
  typedRoutes: true,
}

export default nextConfig