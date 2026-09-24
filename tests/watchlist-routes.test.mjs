import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routes = readFileSync(new URL('../lib/auth/routes.mjs', import.meta.url), 'utf8');

test('watchlist GET requires a current signed-in account and returns a CSRF token', () => {
  const start = routes.indexOf("if (path === '/api/account/watchlist' && req.method === 'GET')");
  assert.ok(start >= 0);
  const block = routes.slice(start, routes.indexOf("if (req.method !== 'POST')", start));
  assert.match(block, /currentAccount\(req, sessions\)/);
  assert.match(block, /if \(!user\) return unauthenticated/);
  assert.match(block, /listWatchlist\(user\.id\)/);
  assert.match(block, /csrfTokenFor\(token, secret\)/);
});

test('watchlist POST is same-origin, authenticated, CSRF-protected and rate-limited', () => {
  const start = routes.indexOf("if (path === '/api/account/watchlist') {");
  assert.ok(start >= 0);
  const block = routes.slice(start, routes.indexOf('// --- registration and verification', start));
  assert.ok(routes.indexOf("if (!sameOrigin(req))") < start, 'same-origin guard runs before watchlist write');
  assert.match(block, /currentAccount\(req, sessions\)/);
  assert.match(block, /csrfValid\(token, req\.headers\['x-csrf-token'\], secret\)/);
  assert.match(block, /allow\(req, 'watchlist', user\.email\)/);
  assert.match(block, /upsertWatchlistItem/);
  assert.match(block, /removeWatchlistItem/);
});
