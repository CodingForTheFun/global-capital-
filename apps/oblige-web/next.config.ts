import type { NextConfig } from 'next';

const backend = (process.env.OBLIGE_BACKEND_ORIGIN || 'https://autoprop-live-production.up.railway.app').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return {
      // Progressive migration: anything not implemented by this Next.js app
      // continues to resolve through the existing Railway application.
      fallback: [{ source: '/:path*', destination: `${backend}/:path*` }],
    };
  },
};

export default nextConfig;
