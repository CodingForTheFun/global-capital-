// Customer-facing one-time account notification routes.

import { currentAccount } from './routes.mjs';
import { csrfValid } from './session.mjs';
import { pendingAccountNotices, acknowledgeAccountNotice } from './account-notices.mjs';

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function readBody(req, limit = 8_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request body is too large.'), { code: 'REQUEST_INVALID' });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON request.'), { code: 'REQUEST_INVALID' }); }
}

/**
 * GET  /api/notices/account
 * POST /api/notices/account/ack  { noticeId }
 */
export async function handleAccountNoticeRoutes(req, res, url, { sessions, json, secret, log = console } = {}) {
  const pathname = url.pathname;
  if (pathname !== '/api/notices/account' && pathname !== '/api/notices/account/ack') return false;

  try {
    if (pathname === '/api/notices/account' && req.method === 'GET') {
      const { user } = await currentAccount(req, sessions);
      if (!user) {
        json(res, 401, { ok: false, code: 'AUTH_REQUIRED', message: 'Sign in to continue.' });
        return true;
      }
      json(res, 200, { ok: true, notices: await pendingAccountNotices(user.id) });
      return true;
    }

    if (pathname === '/api/notices/account/ack' && req.method === 'POST') {
      if (!sameOrigin(req)) {
        json(res, 403, { ok: false, code: 'ORIGIN_INVALID', message: 'Cross-origin request rejected.' });
        return true;
      }
      const { user, token } = await currentAccount(req, sessions);
      if (!user) {
        json(res, 401, { ok: false, code: 'AUTH_REQUIRED', message: 'Sign in to continue.' });
        return true;
      }
      if (!csrfValid(token, req.headers['x-csrf-token'], secret)) {
        json(res, 403, { ok: false, code: 'CSRF_INVALID', message: 'Your session expired. Reload and try again.' });
        return true;
      }
      const body = await readBody(req);
      const acknowledged = await acknowledgeAccountNotice(user.id, body.noticeId);
      json(res, acknowledged ? 200 : 404, acknowledged
        ? { ok: true }
        : { ok: false, code: 'NOTICE_NOT_FOUND', message: 'That notification is no longer pending.' });
      return true;
    }

    json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
    return true;
  } catch (error) {
    log?.error?.('[Oblige Props notices] request failed', String(error?.code || error?.message || 'NOTICE_ERROR').slice(0, 120));
    json(res, error?.code === 'REQUEST_INVALID' ? 400 : 500, {
      ok: false,
      message: error?.code === 'REQUEST_INVALID' ? 'That request could not be processed.' : 'That request could not be completed.',
    });
    return true;
  }
}
