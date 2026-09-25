import zlib from 'node:zlib';
import { injectScoresCompat } from './scores-compat.mjs';
// Release marker: deploy the embedded current Oblige web fallback through the verified recovery gate.
/** Frontend bridge and authenticated canonical workspace entrypoint.
 * Existing account, billing and ingestion routes are unchanged.
 * Unsetting OBLIGE_WEB_ORIGIN preserves the existing page rollback behavior. */
const PAGES = new Set(['/', '/board', '/scores', '/news', '/moves', '/research', '/account', '/api/news', '/api/news/image', '/app.webmanifest', '/app-worker.js', '/app-icons/180.png', '/app-icons/192.png', '/app-icons/512.png']);
const LEGACY_PAGE_REDIRECTS = new Map([['/apex', '/board'], ['/apex/', '/board']]);
const PREFIXES = ['/_next/', '/icon.svg'];
const DROP_REQUEST = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'keep-alive', 'upgrade']);
const DROP_RESPONSE = new Set(['content-length', 'content-encoding', 'connection', 'transfer-encoding', 'keep-alive', 'upgrade']);
function cleanOrigin(value) { return String(value || '').trim().replace(/\/+$/, ''); }
export function newWebOrigins(env = process.env) {
  return [...new Set([
    cleanOrigin(env.OBLIGE_EMBEDDED_WEB_ORIGIN),
    cleanOrigin(env.OBLIGE_WEB_ORIGIN),
  ].filter(Boolean))];
}
export function newWebOrigin(env = process.env) { return newWebOrigins(env)[0] || ''; }
export function ownsPath(pathname) {
  if (PAGES.has(pathname) || LEGACY_PAGE_REDIRECTS.has(pathname)) return true;
  return PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(prefix));
}
// Issue #326: this exact duplicated reserved prefix cannot name a Next chunk.
// Inspect only a bounded, once-percent-decoded prefix; never rewrite the URL or
// inspect its query, Host, cookies, or other client data. Keep legitimate nested
// app routes (e.g. chunks/app/static/chunks/...) and all non-assets unchanged.
function rejectDuplicatedNextChunk(req, res, pathname) {
  const prefix = '/_next/static/chunks/static/chunks/';
  const decodedPrefix = pathname.slice(0, prefix.length * 3).replace(
    /%([0-9a-f]{2})/gi, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)),
  );
  if (!decodedPrefix.startsWith(prefix)) return false;
  if (res.destroyed || res.writableEnded) return true;
  const body = 'Not found.';
  res.writeHead(404, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store, max-age=0',
    'x-content-type-options': 'nosniff',
    'x-oblige-asset-guard': 'duplicate-chunk-path',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}
export async function serveNewWeb(req, res, { origin, origins, fetchImpl = fetch } = {}) {
  let url;
  try { url = new URL(req.url || '/', 'http://localhost'); } catch { return false; }
  // Before proxying, auth/workspace work, redirects, and the origin rollback gate.
  if (rejectDuplicatedNextChunk(req, res, url.pathname)) return true;
  if (url.pathname === '/api/oblige-workspace') {
    const { handleWorkspace } = await import('./workspace-api.mjs');
    return handleWorkspace(req, res);
  }
  const candidates = Array.isArray(origins)
    ? [...new Set(origins.map(cleanOrigin).filter(Boolean))]
    : origin !== undefined
      ? [cleanOrigin(origin)].filter(Boolean)
      : newWebOrigins();
  if (!candidates.length) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (!ownsPath(url.pathname)) return false;
  const legacyTarget = LEGACY_PAGE_REDIRECTS.get(url.pathname);
  if (legacyTarget) {
    res.writeHead(307, { location: legacyTarget + url.search, 'cache-control': 'no-store, max-age=0', 'x-content-type-options': 'nosniff' });
    res.end(); return true;
  }
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers || {})) {
    if (DROP_REQUEST.has(key.toLowerCase())) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
  }
  const host = String(req.headers?.host || '');
  if (host) { headers.set('x-forwarded-host', host); headers.set('x-forwarded-proto', 'https'); }
  let upstream = null;
  let scoresFallback = false;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    let response;
    let candidateScoresFallback = false;
    try {
      response = await fetchImpl(candidate + url.pathname + url.search, {
        method: req.method,
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      });
      if (req.method === 'GET' && url.pathname === '/scores' && response.status === 404) {
        const shell = await fetchImpl(candidate + '/', {
          method: 'GET',
          headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(8000),
        });
        if (shell.ok) {
          response = shell;
          candidateScoresFallback = true;
        }
      }
    } catch {
      continue;
    }
    if (response.status >= 500) continue;
    const hasFallback = index + 1 < candidates.length;
    if (
      hasFallback &&
      response.status === 404 &&
      (PAGES.has(url.pathname) || url.pathname.startsWith('/_next/'))
    ) {
      continue;
    }
    upstream = response;
    scoresFallback = candidateScoresFallback;
    break;
  }
  if (!upstream) return false;
  const out = {};
  upstream.headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (DROP_RESPONSE.has(name) || name === 'set-cookie') return;
    out[key] = value;
  });
  const cookies = upstream.headers.getSetCookie?.() || [];
  if (cookies.length) out['set-cookie'] = cookies;
  let body = Buffer.from(await upstream.arrayBuffer());
  const contentType = String(upstream.headers.get('content-type') || '');
  const status = scoresFallback ? 200 : upstream.status;
  if (req.method === 'GET' && contentType.includes('text/html') && status >= 200 && status < 400) {
    body = Buffer.from(injectScoresCompat(body.toString('utf8'), { renderFallback: scoresFallback }), 'utf8');
    out['cache-control'] = 'no-store, max-age=0';
    out['x-oblige-scores-compat'] = scoresFallback ? 'fallback' : 'nav';
  }
  // Compress text responses for clients that accept gzip. Next's hashed
  // static chunks never change, so their compressed bytes are kept.
  const acceptsGzip = /\bgzip\b/i.test(String(req.headers?.['accept-encoding'] || ''));
  if (acceptsGzip && status === 200 && body.length >= 1024 && /text\/|javascript|json|svg|manifest/i.test(contentType)) {
    const immutable = url.pathname.startsWith('/_next/static/');
    let packed = immutable ? gzipCache.get(url.pathname) : null;
    if (!packed) {
      packed = zlib.gzipSync(body, { level: 6 });
      if (immutable) {
        gzipCache.set(url.pathname, packed);
        while (gzipCache.size > 400) gzipCache.delete(gzipCache.keys().next().value);
      }
    }
    body = packed;
    out['content-encoding'] = 'gzip';
    out.vary = out.vary ? out.vary + ', Accept-Encoding' : 'Accept-Encoding';
  }
  out['content-length'] = String(body.length);
  res.writeHead(status, out);
  if (req.method === 'HEAD') res.end(); else res.end(body);
  return true;
}

const gzipCache = new Map();
