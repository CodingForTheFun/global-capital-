import type { NextConfig } from 'next';

const backend = (process.env.OBLIGE_BACKEND_ORIGIN || 'https://autoprop-live-production.up.railway.app').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Public, identity-scoped headshots only. The browser requests /_next/image
  // on this origin, preserving the backend's self-only image CSP.
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'a.espncdn.com', port: '', pathname: '/i/headshots/*/players/full/*.png', search: '' }],
    maximumRedirects: 0,
    qualities: [75],
  },
  async rewrites() {
    return {
      // Progressive migration: anything not implemented by this Next.js app
      // continues to resolve through the existing Railway application.
      fallback: [{ source: '/:path*', destination: `${backend}/:path*` }],
    };
  },
};

export default nextConfig;
