/**
 * Serves the rebuilt front end (apps/oblige-web) for the pages it owns, from
 * the existing frontdoor, so www.obligeprops.com keeps pointing exactly where
 * it already points and nothing about DNS or Railway domains has to change.
 *
 * Rollback is unsetting OBLIGE_WEB_ORIGIN: with no origin set this returns
 * false for every request before doing any work, and the site serves exactly
 * what it serves today.
 *
 * Only the pages the new app actually implements are claimed. Everything else
 * — /terms, /checkout, /login, the whole legacy board, and critically every
 * /api/* route — is left to the existing handlers, so the browser talks to the
 * real API on the same origin with no extra hop and no cookie rewriting.
 */

const PAGES = new Set(['/', '/board', '/research', '/account']);
const PREFIXES = ['/_next/', '/icon.svg'];

// Hop-by-hop headers must not be forwarded, and the length/encoding are
// recalculated by whichever server writes the body.
const DROP_REQUEST = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'keep-alive', 'upgrade']);
const DROP_RESPONSE = new Set(['content-length', 'content-encoding', 'connection', 'transfer-encoding', 'keep-alive', 'upgrade']);

export function newWebOrigin(env = process.env) {
  return String(env.OBLIGE_WEB_ORIGIN || '').trim().replace(/\/+$/, '');
}

export function ownsPath(pathname) {
  if (PAGES.has(pathname)) return true;
  return PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

/**
 * @returns {Promise<boolean>} true when this request was fully served here.
 *   False means nothing was written and the caller should carry on as before.
 */
export async function serveNewWeb(req, res, { origin = newWebOrigin(), fetchImpl = fetch } = {}) {
  if (!origin) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  let url;
  try {
    url = new URL(req.url || '/', 'http://localhost');
  } catch {
    return false;
  }
  if (!ownsPath(url.pathname)) return false;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers || {})) {
    if (DROP_REQUEST.has(key.toLowerCase())) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
  }
  // The app renders absolute URLs from the host it was asked for, not from the
  // Railway hostname this hop happens to use.
  const host = String(req.headers?.host || '');
  if (host) {
    headers.set('x-forwarded-host', host);
    headers.set('x-forwarded-proto', 'https');
  }

  let upstream;
  try {
    upstream = await fetchImpl(origin + url.pathname + url.search, {
      method: req.method,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // The new front end being down must never take the site down with it.
    return false;
  }
  // A 5xx from the new app is the same kind of failure as not reaching it.
  if (upstream.status >= 500) return false;

  const out = {};
  upstream.headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (DROP_RESPONSE.has(name) || name === 'set-cookie') return;
    out[key] = value;
  });
  const cookies = upstream.headers.getSetCookie?.() || [];
  if (cookies.length) out['set-cookie'] = cookies;

  const body = Buffer.from(await upstream.arrayBuffer());
  // Nothing is written to the response until the upstream body is in hand, so
  // every failure above can still fall through to the existing handlers.
  res.writeHead(upstream.status, out);
  if (req.method === 'HEAD') res.end();
  else res.end(body);
  return true;
}
