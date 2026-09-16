import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BACKEND = (process.env.OBLIGE_BACKEND_ORIGIN || 'https://autoprop-live-production.up.railway.app').replace(/\/+$/, '');
const REQUEST_BLOCKLIST = new Set(['host', 'content-length', 'connection', 'transfer-encoding']);
const RESPONSE_BLOCKLIST = new Set(['content-length', 'content-encoding', 'connection', 'transfer-encoding']);

type RouteContext = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const upstream = new URL(`${BACKEND}/api/${(path || []).map(encodeURIComponent).join('/')}`);
  upstream.search = new URL(request.url).search;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!REQUEST_BLOCKLIST.has(key.toLowerCase())) headers.set(key, value);
  });

  const incomingUrl = new URL(request.url);
  // Preserve the actual browser-facing Host when proxying to the backend.
  // Railway/Next can canonicalize request.url to an internal or generated host;
  // using that value for x-forwarded-host makes the backend's same-origin guard
  // reject legitimate browser login/register POSTs with 403.
  const requestHost = request.headers.get('host')?.trim();
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  headers.set('x-forwarded-host', requestHost || forwardedHost || incomingUrl.host);
  headers.set('x-forwarded-proto', incomingUrl.protocol.replace(':', '') || 'https');

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
    cache: 'no-store',
  };

  if (!['GET', 'HEAD'].includes(request.method)) {
    const body = await request.arrayBuffer();
    if (body.byteLength) init.body = body;
  }

  let response: Response;
  try {
    response = await fetch(upstream, init);
  } catch {
    return Response.json({ ok: false, message: 'The Oblige Props service is temporarily unavailable.' }, { status: 502 });
  }

  const responseHeaders = new Headers();
  response.headers.forEach((value, key) => {
    if (!RESPONSE_BLOCKLIST.has(key.toLowerCase()) && key.toLowerCase() !== 'set-cookie') {
      responseHeaders.set(key, value);
    }
  });

  const cookieReader = response.headers as Headers & { getSetCookie?: () => string[] };
  for (const cookie of cookieReader.getSetCookie?.() || []) responseHeaders.append('set-cookie', cookie);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
export const HEAD = proxy;
