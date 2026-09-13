import { readFileSync } from 'node:fs';
const assets = new Map([
  ['/assets/autoscout-home.js', { type: 'text/javascript; charset=utf-8', body: readFileSync(new URL('../../public/autoscout-home.js', import.meta.url)) }],
  ['/assets/autoscout-home.css', { type: 'text/css; charset=utf-8', body: readFileSync(new URL('../../public/autoscout-home.css', import.meta.url)) }],
  ['/assets/autoscout-tacos.js', { type: 'text/javascript; charset=utf-8', body: readFileSync(new URL('../../public/autoscout-tacos.js', import.meta.url)) }],
]);
// A retired route alias, not an independently running sportsbook.
export function isSportsWorkspace(pathname) { return pathname === '/sportsbooks' || pathname === '/sportsbooks/'; }
export function serveWorkspaceAsset(req, res) {
  const asset = assets.get(new URL(req.url || '/', 'http://localhost').pathname);
  if (!asset) return false;
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return true; }
  res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
  res.end(req.method === 'HEAD' ? undefined : asset.body);
  return true;
}
