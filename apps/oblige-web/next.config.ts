import type { NextConfig } from 'next';

const backend = (process.env.OBLIGE_BACKEND_ORIGIN || 'https://autoprop-live-production.up.railway.app').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Identity-scoped public headshots through this origin; preserve the self-only CSP.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'img.mlbstatic.com', pathname: '/mlb-photos/image/upload/**', search: '' },
      { protocol: 'https', hostname: 'cdn.nba.com', pathname: '/headshots/nba/latest/1040x760/**', search: '' },
      { protocol: 'https', hostname: 'a.espncdn.com', port: '', pathname: '/i/headshots/*/players/full/*.png', search: '' },
    ],
    maximumRedirects: 0,
    qualities: [75],
  },
  async rewrites() {
    return {
      fallback: [{ source: '/:path*', destination: `${backend}/:path*` }],
    };
  },
};

export default nextConfig;
