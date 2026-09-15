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
  return 'https://www.obligeprops.com';
}

/**
 * Headers every response carries.
 *
 * The frontdoor injects a small amount of inline application shell, so inline
 * script/style cannot be removed without a nonce migration. Everything else is
 * fail-closed: no third-party script, connection, object, frame or form target
 * is permitted by default. This materially limits the blast radius of an HTML
 * injection while preserving the current production shell and OAuth redirects.
 */
export const SECURITY_HEADERS = Object.freeze({
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'x-permitted-cross-domain-policies': 'none',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()',
  'cross-origin-opener-policy': 'same-origin-allow-popups',
  'origin-agent-cluster': '?1',
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; '),
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
 * Icon, theme, canonical, search-identity and link-preview tags.
 *
 * Oblige Props is the public company/product brand. Auto Scout remains an
 * internal research-engine name, but it must not compete with the public brand
 * in crawler metadata or social previews.
 */
export function headTags(origin = siteOrigin(), { path = '/', title, description } = {}) {
  const url = origin + path;
  const heading = title || 'Oblige Props — Player Prop Research & Line Comparison';
  const blurb = description || 'Research player props with verified game logs, sportsbook line comparison, hit rates, projections and evidence-backed analysis.';
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const structured = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${origin}/#organization`,
        name: 'Oblige Props',
        url: origin,
        logo: `${origin}/brand/icon-512.png`,
      },
      {
        '@type': 'WebSite',
        '@id': `${origin}/#website`,
        name: 'Oblige Props',
        url: origin,
        description: blurb,
        publisher: { '@id': `${origin}/#organization` },
      },
      {
        '@type': 'WebApplication',
        name: 'Oblige Props',
        url: origin,
        applicationCategory: 'SportsApplication',
        operatingSystem: 'Web',
        description: blurb,
        publisher: { '@id': `${origin}/#organization` },
      },
    ],
  }).replace(/</g, '\\u003c');
  return [
    `<link rel="icon" href="/favicon.ico" sizes="any">`,
    `<link rel="icon" type="image/png" sizes="32x32" href="/brand/icon-32.png">`,
    `<link rel="apple-touch-icon" href="/brand/icon-180.png">`,
    `<link rel="manifest" href="/site.webmanifest">`,
    `<meta name="application-name" content="Oblige Props">`,
    `<meta name="apple-mobile-web-app-title" content="Oblige Props">`,
    `<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">`,
    `<meta name="theme-color" content="#070d18">`,
    `<meta name="color-scheme" content="dark">`,
    `<link rel="canonical" href="${escape(url)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Oblige Props">`,
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
    `<style id="oblige-brand-refresh">header>.logo{background:#03070b url('data:image/webp;base64,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') center/cover no-repeat!important;color:transparent!important;border:1px solid rgba(51,228,155,.28)!important;box-shadow:0 0 24px rgba(51,228,155,.12)}header>.brand{font-weight:900!important;letter-spacing:-.025em!important}</style>`,
    `<script>document.addEventListener('DOMContentLoaded',()=>{const b=document.querySelector('header>.brand');if(b&&/^AUTOSCOUT$/i.test(b.textContent.trim()))b.textContent='OBLIGE PROPS';const l=document.querySelector('header>.logo');if(l&&/^A$/i.test(l.textContent.trim()))l.textContent='';if(/^Auto Scout\\b/i.test(document.title))document.title='${escape(heading)}';});</script>`,
    `<script type="application/ld+json">${structured}</script>`,
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
    name: 'Oblige Props — Player Prop Research',
    short_name: 'Oblige Props',
    description: 'Player prop research, verified game logs, sportsbook line comparisons and evidence-backed projections.',
    start_url: '/',
    display: 'standalone',
    background_color: '#070d18',
    theme_color: '#070d18',
    categories: ['sports', 'utilities'],
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
