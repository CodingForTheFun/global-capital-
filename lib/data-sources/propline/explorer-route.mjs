import { readExplorer, explorerError } from './explorer.mjs';

/** Account/session and customer sanitizer are supplied by the existing frontdoor. */
export function createExplorerHandler({ account, rateAllowed, json, read = readExplorer }) {
  if (![account, rateAllowed, json, read].every((v) => typeof v === 'function')) throw new TypeError('Explorer requires the existing account, rate-limit and response boundaries.');
  return async function maybeServeMarketExplorer(req, res) {
    let url;
    try { url = new URL(req.url || '/', 'http://localhost'); } catch { return false; }
    if (url.pathname !== '/api/apex/market-explorer') return false;
    if (req.method !== 'GET') { json(res, 405, { ok: false, message: 'Method not allowed.' }, { allow: 'GET' }); return true; }
    const { user } = await account(req).catch(() => ({ user: null }));
    if (!user) { json(res, 401, { ok: false, state: 'sign-in', message: 'Sign in to open the market explorer.' }); return true; }
    if (url.search.length > 24000) { json(res, 414, { ok: false, state: 'invalid', message: 'Choose fewer market filters.' }); return true; }
    if (!rateAllowed(req)) { json(res, 429, { ok: false, state: 'rate-limited', message: 'Too many research requests. Try again shortly.', retryAfterSeconds: 60 }, { 'retry-after': '60' }); return true; }
    try {
      const input = Object.fromEntries(url.searchParams);
      const result = await read(String(input.kind || ''), input);
      json(res, 200, result);
    } catch (error) {
      const result = explorerError(error);
      const status = result.state === 'invalid' ? 400 : result.state === 'rate-limited' ? 429 : result.state === 'not-found' ? 404 : result.state === 'not-enabled' ? 403 : 503;
      const headers = result.retryAfterSeconds !== null ? { 'retry-after': String(result.retryAfterSeconds) } : {};
      json(res, status, result, headers);
    }
    return true;
  };
}
