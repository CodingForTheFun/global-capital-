// The parts of the site that face the open web rather than a signed-in user:
// response hardening, the brand mark, and the files crawlers and link previews
// ask for. All of it is served before the account gate, because a browser
// fetching a favicon or a crawler reading robots.txt has no session and should
// not be redirected into one.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const text = value => String(value ?? '').trim();

/** The public origin, used for canonical URLs and link previews. */
export function siteOrigin(env = process.env) {
  const explicit = text(env.PUBLIC_SITE_ORIGIN);
  if (explicit) return explicit.replace(/\/+$/, '');
  const railway = text(env.RAILWAY_PUBLIC_DOMAIN);
  if (railway) return `https://${railway.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  return 'https://www.obligepay.com';
}

/**
 * Headers every response carries.
 *
 * The site takes a password on its front page, so framing and referrer leakage
 * are real concerns. The CSP here is deliberately narrow: the app injects its
 * shell inline, so script-src rules would break it, but frame-ancestors,
 * object-src and base-uri cost nothing and close the gaps that matter.
 */
export const SECURITY_HEADERS = Object.freeze({
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'geolocation=(), microphone=(), camera=(), interest-cohort=()',
  'content-security-policy': "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
});

export function applySecurityHeaders(res) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!res.hasHeader?.(name)) res.setHeader(name, value);
  }
}

// Icons are generated from the hit-rate ring the product is built around, so
// the tab, the home-screen icon and the share card all read as the same thing.
const BRAND = Object.freeze({
  '/favicon.ico': ['public/brand/favicon.ico', 'image/x-icon'],
  '/brand/icon-32.png': ['public/brand/icon-32.png', 'image/png'],
  '/brand/icon-180.png': ['public/brand/icon-180.png', 'image/png'],
  '/brand/icon-512.png': ['public/brand/icon-512.png', 'image/png'],
  '/apple-touch-icon.png': ['public/brand/icon-180.png', 'image/png'],
  '/apple-touch-icon-precomposed.png': ['public/brand/icon-180.png', 'image/png'],
  '/brand/og.png': ['public/brand/og.png', 'image/png'],
});

/**
 * Icon, theme, canonical and link-preview tags.
 *
 * Without these a shared link renders as a bare URL in Slack, iMessage,
 * Discord and every social feed, which is the first impression most people
 * ever get of the product.
 */
export function headTags(origin = siteOrigin(), { path = '/', title, description } = {}) {
  const url = origin + path;
  // The signed-out face of the product is Auto Scout; the ObligePay wordmark
  // belongs to the signed-in app. tests/research-home.test.mjs enforces this.
  const heading = title || 'Auto Scout — player prop research and line comparison';
  const blurb = description || 'Real game logs, sharp-book fair value and every sportsbook side by side. Free during beta.';
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return [
    `<link rel="icon" href="/favicon.ico" sizes="any">`,
    `<link rel="icon" type="image/png" sizes="32x32" href="/brand/icon-32.png">`,
    `<link rel="apple-touch-icon" href="/brand/icon-180.png">`,
    `<link rel="manifest" href="/site.webmanifest">`,
    `<meta name="theme-color" content="#070d18">`,
    `<meta name="color-scheme" content="dark">`,
    `<link rel="canonical" href="${escape(url)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Auto Scout">`,
    `<meta property="og:title" content="${escape(heading)}">`,
    `<meta property="og:description" content="${escape(blurb)}">`,
    `<meta property="og:url" content="${escape(url)}">`,
    `<meta property="og:image" content="${escape(origin)}/brand/og.png">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escape(heading)}">`,
    `<meta name="twitter:description" content="${escape(blurb)}">`,
    `<meta name="twitter:image" content="${escape(origin)}/brand/og.png">`,
  ].join('\n');
}

// Paths people type or that other sites link to by convention. The sign-in
// form lives on the front page, so every one of these was a dead end that lost
// a visitor who was actively trying to reach an account.
const ACCOUNT_ALIASES = new Set([
  '/login', '/log-in', '/signin', '/sign-in', '/signup', '/sign-up',
  '/register', '/account', '/join', '/auth',
]);

/** Crawlers get the marketing surface; everything behind the gate is noise. */
export function robotsTxt(origin = siteOrigin()) {
  return [
    'User-agent: *',
    'Allow: /$',
    'Allow: /pricing',
    'Allow: /terms',
    'Allow: /privacy',
    'Allow: /responsible-gaming',
    // The board is account-only, so crawling it yields nothing but redirects,
    // and checkout is a transactional page tied to one account's state.
    'Disallow: /apex',
    'Disallow: /checkout',
    'Disallow: /api/',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
}

export function sitemapXml(origin = siteOrigin(), now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const entry = (loc, priority) =>
    `  <url><loc>${origin}${loc}</loc><lastmod>${day}</lastmod><priority>${priority}</priority></url>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entry('/', '1.0'),
    entry('/pricing', '0.8'),
    entry('/terms', '0.3'),
    entry('/privacy', '0.3'),
    entry('/responsible-gaming', '0.3'),
    '</urlset>',
    '',
  ].join('\n');
}

/** The webmanifest, so an installed shortcut is not a blank square. */
export function webManifest() {
  return JSON.stringify({
    name: 'Auto Scout — Prop Research',
    short_name: 'Auto Scout',
    description: 'Player prop research, verified game logs and sportsbook line comparisons.',
    start_url: '/',
    display: 'standalone',
    background_color: '#070d18',
    theme_color: '#070d18',
    icons: [
      { src: '/brand/icon-180.png', sizes: '180x180', type: 'image/png' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  }, null, 2);
}

/**
 * Serve a public file if this request is for one.
 * @returns true when the response has been written.
 */
export function servePublicSurface(req, res, { root = process.cwd(), origin = siteOrigin() } = {}) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;

  const brand = BRAND[pathname];
  if (brand) {
    let body;
    try { body = readFileSync(path.join(root, brand[0])); }
    catch { return false; }
    res.writeHead(200, {
      'content-type': brand[1],
      // Icons are content-addressed by their look, not their name, so a long
      // cache here is the difference between one request and one per visit.
      'cache-control': 'public, max-age=604800, immutable',
      'content-length': body.length,
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  }

  const plain = (type, body) => {
    const buffer = Buffer.from(body);
    res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=3600', 'content-length': buffer.length });
    res.end(req.method === 'HEAD' ? undefined : buffer);
    return true;
  };
  if (ACCOUNT_ALIASES.has(pathname.replace(/\/+$/, '') || '/')) {
    res.writeHead(302, { location: '/', 'cache-control': 'no-store' });
    res.end();
    return true;
  }
  if (pathname === '/robots.txt') return plain('text/plain; charset=utf-8', robotsTxt(origin));
  if (pathname === '/sitemap.xml') return plain('application/xml; charset=utf-8', sitemapXml(origin));
  if (pathname === '/site.webmanifest' || pathname === '/manifest.webmanifest') {
    return plain('application/manifest+json; charset=utf-8', webManifest());
  }
  return false;
}
