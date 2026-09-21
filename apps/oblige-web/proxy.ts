import { NextResponse, type NextRequest } from 'next/server';

// Issue #326: terminate the proven duplicated reserved chunk prefix locally
// before Next.js fallback rewrites can send it to the backend bridge.
// Release rollout also validates this guard through the canonical www host.
const DUPLICATE_CHUNK_PREFIX = '/_next/static/chunks/static/chunks/';

export function proxy(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith(DUPLICATE_CHUNK_PREFIX)) {
    const response = NextResponse.next();
    // The public frontdoor owns /api/*, so publish non-secret release identity
    // on the actual board response instead of opening an unauthenticated API.
    const revision = process.env.RAILWAY_GIT_COMMIT_SHA;
    if (request.nextUrl.pathname === '/board' && revision && /^[a-f0-9]{40}$/i.test(revision)) {
      response.headers.set('x-oblige-revision', revision);
    }
    return response;
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
  matcher: ['/board', '/_next/static/chunks/static/chunks/:path*'],
};
