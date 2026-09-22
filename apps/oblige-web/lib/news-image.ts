/**
 * Same-origin relay for ESPN news photos.
 *
 * The site's CSP (lib/web/public-surface.mjs) allows images only from 'self',
 * so an ESPN-hosted photo is blocked in the browser. Rather than loosen the
 * CSP, /api/news/image fetches the photo server-side and serves it from this
 * origin. The relay is deliberately narrow:
 *   - exact hostnames only, https, default port, no credentials in the URL
 *   - redirects are refused, so an allowed host can't bounce it elsewhere
 *   - raster image types only (SVG can carry script) and a size cap
 *   - nothing from the visitor's request is forwarded upstream
 */

/** Hosts the ESPN news feeds use for article photos. Exact names, no suffix matching. */
export const NEWS_IMAGE_HOSTS: ReadonlySet<string> = new Set([
  'a.espncdn.com',
  's.secure.espncdn.com',
  'espnmedia-cdn.akamaized.net',
]);

/** Feed hostnames that always 301 to another allowed host. Mapped up front
 *  because the relay never follows a redirect. */
const CANONICAL_HOST: ReadonlyMap<string, string> = new Map([
  ['s.espncdn.com', 's.secure.espncdn.com'],
]);

export const NEWS_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

export const NEWS_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 6000;

export function allowedNewsImage(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.port !== '') return null;
  const canonical = CANONICAL_HOST.get(url.hostname);
  if (canonical) url.hostname = canonical;
  if (!NEWS_IMAGE_HOSTS.has(url.hostname)) return null;
  return url;
}

/** The same-origin path a news card should load, or null to show the placeholder. */
export function relayedNewsImage(raw: string | null): string | null {
  const url = raw ? allowedNewsImage(raw) : null;
  return url ? '/api/news/image?u=' + encodeURIComponent(url.href) : null;
}

const refuse = (status: number) =>
  new Response(null, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });

async function readCapped(body: ReadableStream<Uint8Array>): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > NEWS_IMAGE_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function relayNewsImage(request: Request, fetchImpl: typeof fetch = fetch): Promise<Response> {
  // The query is never trusted: the URL is checked again here, whatever the
  // news route produced.
  const target = allowedNewsImage(new URL(request.url).searchParams.get('u'));
  if (!target) return refuse(400);

  let upstream: Response;
  try {
    upstream = await fetchImpl(target.href, {
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      headers: { accept: [...NEWS_IMAGE_TYPES].join(',') },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return refuse(502);
  }

  const type = String(upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const declared = Number(upstream.headers.get('content-length'));
  if (
    upstream.status !== 200 ||
    !NEWS_IMAGE_TYPES.has(type) ||
    (Number.isFinite(declared) && declared > NEWS_IMAGE_MAX_BYTES) ||
    !upstream.body
  ) {
    await upstream.body?.cancel().catch(() => {});
    return refuse(502);
  }

  const bytes = await readCapped(upstream.body).catch(() => null);
  if (!bytes || bytes.byteLength === 0) return refuse(502);

  return new Response(bytes as BodyInit, {
    status: 200,
    headers: {
      'content-type': type,
      'content-length': String(bytes.byteLength),
      'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
      'content-disposition': 'inline',
      'content-security-policy': "default-src 'none'",
      'x-content-type-options': 'nosniff',
    },
  });
}
