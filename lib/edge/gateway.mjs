// Legacy name retained for the existing frontdoor hook. No sportsbook/Next process.
import { isSportsWorkspace, serveWorkspaceAsset } from './workspace-routes.mjs';
const retiredPages = new Set(['/preview', '/preview/', '/sportsbook', '/sportsbook/']);
const retiredApis = new Set(['/api/ask-prop', '/api/guest-health', '/api/apex/game-markets']);
export function createEdgeGateway() {
  return async function handleResearchHome(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
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
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ code: 'RETIRED_WORKSPACE', message: 'This workspace has been retired. Use Auto Scout at /apex.' }));
      return true;
    }
    // In particular, / falls through to the ORIGINAL account gate and v5 shell.
    // /api/account, /api/props, research, saves, health and payments are untouched.
    return false;
  };
}
