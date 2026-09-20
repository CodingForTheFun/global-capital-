import { NextResponse, type NextRequest } from 'next/server';

// Issue #326: terminate the proven duplicated reserved chunk prefix locally
// before Next.js fallback rewrites can send it to the backend bridge.
const DUPLICATE_CHUNK_PREFIX = '/_next/static/chunks/static/chunks/';

export function proxy(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith(DUPLICATE_CHUNK_PREFIX)) {
    return NextResponse.next();
  }

  const headers = new Headers({
    'cache-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'x-oblige-asset-guard': 'duplicate-chunk-path',
  });

  return new NextResponse(request.method === 'HEAD' ? null : 'Not found\n', {
    status: 404,
    headers,
  });
}

export const config = {
  matcher: '/_next/static/chunks/static/chunks/:path*',
};
