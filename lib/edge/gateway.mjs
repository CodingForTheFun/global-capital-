// Legacy name retained for the existing frontdoor hook. No sportsbook/Next process.
import { readFileSync } from 'node:fs';
import { isSportsWorkspace, serveWorkspaceAsset } from './workspace-routes.mjs';
import { isOwner, isSupport } from '../auth/permissions.mjs';
import { siteOrigin } from '../web/public-surface.mjs';

// Hostnames that must land on the canonical site rather than serve a second
// copy of it. www.obligepay.com is the retired brand domain and obligeprops.com
// is the bare domain; both resolve to this service, so without this they answer
// as themselves and split the site across three origins.
//
// Railway hostnames are deliberately absent. The platform healthcheck and the
// deploy smoke tests call the service domain directly, and redirecting those
// would fail every deploy.
const retiredHosts = new Set(['obligepay.com', 'www.obligepay.com', 'obligeprops.com']);

function normalizeHost(value) {
  return String(value || '').toLowerCase().split(':')[0].trim();
}

function requestHost(req) {
  // Railway/proxies can rewrite either Host or X-Forwarded-Host depending on
  // the route through the edge. Prefer an explicitly retired customer-facing
  // hostname from either header so a proxy-internal forwarded host cannot hide
  // the actual retired Host and accidentally serve a second copy of the app.
  const forwarded = normalizeHost(String(req?.headers?.['x-forwarded-host'] || '').split(',')[0]);
  const direct = normalizeHost(req?.headers?.host);
  if (retiredHosts.has(forwarded)) return forwarded;
  if (retiredHosts.has(direct)) return direct;
  return forwarded || direct;
}

/**
 * Send a retired hostname to the canonical origin, preserving path and query.
 *
 * GET/HEAD get 301 so browsers and crawlers cache the move. Anything else gets
 * 308, which is the only redirect that obliges a client to keep the method and
 * body -- a 301 on a POST is allowed to become a GET and would silently drop it.
 */
function redirectRetiredHost(req, res) {
  const host = requestHost(req);
  if (!retiredHosts.has(host)) return false;

  // Keep same-origin API calls working for installed/cached clients that were
  // created before the ObligeProps domain migration. Redirecting fetch/XHR
  // across registrable domains breaks auth cookies and same-origin checks.
  // Normal page navigation still canonicalizes below, so fresh browser visits
  // land on www.obligeprops.com.
  let pathname = '/';
  try { pathname = new URL(req.url || '/', 'http://localhost').pathname; } catch {}
  if (pathname === '/api' || pathname.startsWith('/api/')) return false;

  const origin = siteOrigin();
  let canonical = '';
  try { canonical = new URL(origin).host.toLowerCase(); } catch { return false; }
  // Never redirect a host to itself: if the canonical origin is ever pointed at
  // one of these names, serving it beats an infinite loop.
  if (!canonical || canonical === host) return false;
  const status = ['GET', 'HEAD'].includes(req.method) ? 301 : 308;
  res.writeHead(status, {
    location: origin + (req.url || '/'),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end();
  return true;
}

const retiredPages = new Set(['/preview', '/preview/', '/sportsbook', '/sportsbook/']);
const retiredApis = new Set(['/api/ask-prop', '/api/guest-health', '/api/apex/game-markets']);
const ownerAssets = new Map([
  ['/owner', { type: 'text/html; charset=utf-8', body: readFileSync(new URL('../../public/owner-v2.html', import.meta.url)) }],
  ['/owner/', { type: 'text/html; charset=utf-8', body: readFileSync(new URL('../../public/owner-v2.html', import.meta.url)) }],
  ['/owner.html', { type: 'text/html; charset=utf-8', body: readFileSync(new URL('../../public/owner-v2.html', import.meta.url)) }],
  ['/owner.css', { type: 'text/css; charset=utf-8', body: readFileSync(new URL('../../public/owner-v2.css', import.meta.url)) }],
  ['/owner-v2-core.css', { type: 'text/css; charset=utf-8', body: readFileSync(new URL('../../public/owner-v2-core.css', import.meta.url)) }],
  ['/owner-v2-members.css', { type: 'text/css; charset=utf-8', body: readFileSync(new URL('../../public/owner-v2-members.css', import.meta.url)) }],
  ['/owner-v2-responsive.css', { type: 'text/css; charset=utf-8', body: readFileSync(new URL('../../public/owner-v2-responsive.css', import.meta.url)) }],
  ['/owner-integrated.css', { type: 'text/css; charset=utf-8', body: readFileSync(new URL('../../public/owner-integrated.css', import.meta.url)) }],
  ['/owner.js', { type: 'text/javascript; charset=utf-8', body: readFileSync(new URL('../../public/owner-v2.js', import.meta.url)) }],
  ['/owner-v2-render.js', { type: 'text/javascript; charset=utf-8', body: readFileSync(new URL('../../public/owner-v2-render.js', import.meta.url)) }],
]);
const ownerRecoveryAssets = new Map([
  ['/owner-access', { type: 'text/html; charset=utf-8', body: readFileSync(new URL('../../public/owner-access.html', import.meta.url)) }],
  ['/owner-access/', { type: 'text/html; charset=utf-8', body: readFileSync(new URL('../../public/owner-access.html', import.meta.url)) }],
  ['/owner-access.html', { type: 'text/html; charset=utf-8', body: readFileSync(new URL('../../public/owner-access.html', import.meta.url)) }],
  ['/owner-access.css', { type: 'text/css; charset=utf-8', body: readFileSync(new URL('../../public/owner-access.css', import.meta.url)) }],
  ['/owner-access.js', { type: 'text/javascript; charset=utf-8', body: readFileSync(new URL('../../public/owner-access.js', import.meta.url)) }],
]);
const supportAssets = new Map([
  ['/support', { type: 'text/html; charset=utf-8', body: readFileSync(new URL('../../public/support.html', import.meta.url)) }],
  ['/support/', { type: 'text/html; charset=utf-8', body: readFileSync(new URL('../../public/support.html', import.meta.url)) }],
  ['/support.html', { type: 'text/html; charset=utf-8', body: readFileSync(new URL('../../public/support.html', import.meta.url)) }],
  ['/support.css', { type: 'text/css; charset=utf-8', body: readFileSync(new URL('../../public/support.css', import.meta.url)) }],
  ['/support.js', { type: 'text/javascript; charset=utf-8', body: readFileSync(new URL('../../public/support.js', import.meta.url)) }],
]);

function hideStaffRoute(req, res) {
  res.writeHead(404, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
    'x-content-type-options': 'nosniff',
    'x-robots-tag': 'noindex, nofollow, noarchive',
  });
  res.end(req.method === 'HEAD' ? undefined : 'Not found.');
  return true;
}

function serveNoindexAsset(req, res, asset) {
  res.writeHead(200, {
    'content-type': asset.type,
    'content-length': asset.body.length,
    'cache-control': 'no-store, max-age=0',
    'x-content-type-options': 'nosniff',
    'x-robots-tag': 'noindex, nofollow, noarchive',
    'referrer-policy': 'same-origin',
    ...(asset.type.startsWith('text/html') ? {
      'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    } : {}),
  });
  res.end(req.method === 'HEAD' ? undefined : asset.body);
  return true;
}

export function createEdgeGateway({ currentAccount, sessions } = {}) {
  return async function handleResearchHome(req, res) {
    // Before anything else, so a retired hostname never serves a page, a staff
    // 404, or a redirect of its own from a later branch.
    if (redirectRetiredHost(req, res)) return true;

    const url = new URL(req.url || '/', 'http://localhost');

    // Private recovery is deliberately unlinked and noindexed, but its security
    // comes from the short-lived code sent to ACCOUNT_OWNER_EMAIL — never from
    // pretending a URL is a secret. It must be reachable while signed out.
    const ownerRecoveryAsset = ownerRecoveryAssets.get(url.pathname);
    if (ownerRecoveryAsset) {
      if (!['GET', 'HEAD'].includes(req.method)) return hideStaffRoute(req, res);
      return serveNoindexAsset(req, res, ownerRecoveryAsset);
    }

    // Staff consoles are intentionally not discoverable through customer UI.
    // The page AND its assets re-check the signed session; unauthorized users
    // get an ordinary 404 instead of an admin/support login surface.
    const ownerAsset = ownerAssets.get(url.pathname);
    if (ownerAsset) {
      if (!['GET', 'HEAD'].includes(req.method)) return hideStaffRoute(req, res);
      if (typeof currentAccount !== 'function' || !sessions) return hideStaffRoute(req, res);
      const { user } = await currentAccount(req, sessions).catch(() => ({ user: null }));
      if (!isOwner(user)) return hideStaffRoute(req, res);
      return serveNoindexAsset(req, res, ownerAsset);
    }

    const supportAsset = supportAssets.get(url.pathname);
    if (supportAsset) {
      if (!['GET', 'HEAD'].includes(req.method)) return hideStaffRoute(req, res);
      if (typeof currentAccount !== 'function' || !sessions) return hideStaffRoute(req, res);
      const { user } = await currentAccount(req, sessions).catch(() => ({ user: null }));
      if (!isSupport(user)) return hideStaffRoute(req, res);
      return serveNoindexAsset(req, res, supportAsset);
    }

    if (serveWorkspaceAsset(req, res)) return true;
    if (isSportsWorkspace(url.pathname) || retiredPages.has(url.pathname)) {
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' }); res.end(); return true;
      }
      const params = new URLSearchParams();
      const sport = url.searchParams.get('sport');
      if (/^(NFL|NBA|WNBA|MLB|NHL|NCAAF|NCAAB|MLS|EPL|UCL)$/.test(sport || '')) params.set('sport', sport);
      res.writeHead(302, { location: '/apex' + (params.size ? '?' + params : ''), 'cache-control': 'no-store' });
      res.end(); return true;
    }
    if (retiredApis.has(url.pathname) || url.pathname.startsWith('/_next/') || url.pathname.startsWith('/sportsbooks/') || url.pathname.startsWith('/assets/edge-')) {
      res.writeHead(410, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ code: 'RETIRED_WORKSPACE', message: 'This workspace has been retired. Use Oblige Props at /apex.' }));
      return true;
    }
    return false;
  };
}
