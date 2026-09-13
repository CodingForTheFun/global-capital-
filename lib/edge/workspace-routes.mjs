import { readFileSync } from 'node:fs';
const assets = new Map([
  ['/assets/edge-workspace-nav.js', { type: 'text/javascript; charset=utf-8', body: readFileSync(new URL('../../public/edge-workspace-nav.js', import.meta.url)) }],
  ['/assets/edge-workspace-nav.css', { type: 'text/css; charset=utf-8', body: readFileSync(new URL('../../public/edge-workspace-nav.css', import.meta.url)) }],
]);
export function isSportsWorkspace(pathname) { return pathname === '/sportsbooks' || pathname === '/sportsbooks/'; }
export function serveWorkspaceAsset(req, res) {
  const asset = assets.get(new URL(req.url || '/', 'http://localhost').pathname);
  if (!asset) return false;
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return true; }
  res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
  res.end(req.method === 'HEAD' ? undefined : asset.body);
  return true;
}
