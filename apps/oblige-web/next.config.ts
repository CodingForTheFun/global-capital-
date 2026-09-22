import path from 'node:path';
import type { NextConfig } from 'next';

const backend = (process.env.OBLIGE_BACKEND_ORIGIN || 'https://autoprop-live-production.up.railway.app').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The app imports shared modules from the repo's top-level lib/ (e.g.
  // lib/constants/books.mjs). Turbopack only resolves files inside its root,
  // and apps/oblige-web/Dockerfile ships only this app's lockfile, so the
  // inferred root stopped at this folder and every oblige-web build failed.
  // Pin the root to the repository in every build context.
  turbopack: { root: path.join(__dirname, '..', '..') },
  async rewrites() {
    return {
      // Progressive migration: anything not implemented by this Next.js app
      // continues to resolve through the existing Railway application.
      fallback: [{ source: '/:path*', destination: `${backend}/:path*` }],
    };
  },
};

export default nextConfig;
