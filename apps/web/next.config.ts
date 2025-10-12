import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactCompiler: true,
  typedRoutes: true,
  experimental: {
    turbopackFileSystemCacheForDev: true,
  }
}

export default nextConfig