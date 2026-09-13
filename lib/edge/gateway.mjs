// Legacy name retained for the existing frontdoor hook. No sportsbook/Next process.
import { readFileSync } from 'node:fs';
import { isSportsWorkspace, serveWorkspaceAsset } from './workspace-routes.mjs';

const retiredPages = new Set(['/preview', '/preview/', '/sportsbook', '/sportsbook/']);
const retiredApis = new Set(['/api/ask-prop', '/api/guest-health', '/api/apex/game-markets']);
const ownerAssets = new Map([
  ['/owner', { type: 'text/html; charset=utf-8', body: readFileSync(new URL('../../public/owner.html', import.meta.url)) }],
  ['/owner/', { type: 'text/html; charset=utf-8', body: readFileSync(new URL('../../public/owner.html', import.meta.url)) }],
  ['/owner.html', { type: 'text/html; charset=utf-8', body: readFileSync(new URL('../../public/owner.html', import.meta.url)) }],
  ['/owner.css', { type: 'text/css; charset=utf-8', body: readFileSync(new URL('../../public/owner.css', import.meta.url)) }],
  ['/owner.js', { type: 'text/javascript; charset=utf-8', body: readFileSync(new URL('../../public/owner.js', import.meta.url)) }],
]);

function hideOwnerRoute(req, res) {
  res.writeHead(404, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
    'x-content-type-options': 'nosniff',
    'x-robots-tag': 'noindex, nofollow, noarchive',
  });
  res.end(req.method === 'HEAD' ? undefined : 'Not found.');
  return true;
}

export function createEdgeGateway({ currentAccount, sessions } = {}) {
  return async function handleResearchHome(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');

    // The owner console is intentionally not discoverable through customer UI.
    // It is also not merely "hidden": every page/asset request checks the same
    // signed account session and returns a normal 404 to non-owners.
    const ownerAsset = ownerAssets.get(url.pathname);
    if (ownerAsset) {
      if (!['GET', 'HEAD'].includes(req.method)) return hideOwnerRoute(req, res);
      if (typeof currentAccount !== 'function' || !sessions) return hideOwnerRoute(req, res);
      const { user } = await currentAccount(req, sessions).catch(() => ({ user: null }));
      if (user?.role !== 'owner') return hideOwnerRoute(req, res);
      res.writeHead(200, {
        'content-type': ownerAsset.type,
        'content-length': ownerAsset.body.length,
        'cache-control': 'no-store, max-age=0',
        'x-content-type-options': 'nosniff',
        'x-robots-tag': 'noindex, nofollow, noarchive',
        'referrer-policy': 'same-origin',
        ...(ownerAsset.type.startsWith('text/html') ? {
          'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        } : {}),
      });
      res.end(req.method === 'HEAD' ? undefined : ownerAsset.body);
      return true;
    }

    if (serveWorkspaceAsset(req, res)) return true;
    if (isSportsWorkspace(url.pathname) || retiredPages.has(url.pathname)) {
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' }); res.end(); return true;
      }
      // Same origin and a fixed destination. No account or preference migration.
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
    // In particular, / falls through to the ORIGINAL account gate and v5 shell.
    // /api/account, /api/props, research, saves, health and payments are untouched.
    return false;
  };
}
