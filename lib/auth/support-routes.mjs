// Restricted worker/support console API.
//
// Support staff can inspect customer account status and sign customer devices
// out. They cannot change roles, bans, plans, entitlements, billing, provider
// settings, rules, or any owner-only control.

import { listUsers, findById, revokeSessions } from './store.mjs';
import { allSessions, sessionsForUser, revokeSession, revokeAllForUser, presenceOf } from './presence.mjs';
import { requireSupport, isOwner, ROLES } from './permissions.mjs';
import { currentAccount } from './routes.mjs';
import { csrfValid } from './session.mjs';
import { entitlementFor, publicEntitlement } from '../billing/entitlements.mjs';
import { appendAudit } from './audit.mjs';
import { internalDetail, GENERIC_MESSAGE } from '../safe-error.mjs';

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

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    return new URL(origin).host === host;
  } catch { return false; }
}

function isCustomer(user) {
  return Boolean(user) && user.role === ROLES.MEMBER && !isOwner(user);
}

async function customerRows(now = Date.now()) {
  const [users, sessions] = await Promise.all([listUsers(), allSessions({ now })]);
  const customers = users.filter(isCustomer);
  const byUser = new Map();
  for (const session of sessions) {
    if (!byUser.has(session.userId)) byUser.set(session.userId, []);
    byUser.get(session.userId).push(session);
  }

  return Promise.all(customers.map(async (user) => {
    const live = byUser.get(user.id) || [];
    const mostRecent = live[0] || null;
    const access = publicEntitlement(await entitlementFor(user.id, { now }));
    return {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified === true,
      disabled: user.disabled === true,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt || null,
      presence: mostRecent ? presenceOf(mostRecent.lastSeenAt, now) : 'OFFLINE',
      lastSeenAt: mostRecent?.lastSeenAt || user.lastLoginAt || null,
      activeSessions: live.length,
      plan: access.plan,
      planName: access.planName,
      expiresAt: access.expiresAt || null,
      devices: live.map(({ id, device, presence, lastSeenAt, createdAt }) => ({
        id, device, presence, lastSeenAt, createdAt,
      })),
    };
  }));
}

async function customerTarget(userId) {
  const target = await findById(userId);
  return isCustomer(target) ? target : null;
}

/** @returns {Promise<boolean>} true when handled */
export async function handleSupportRoutes(req, res, url, { sessions, json, secret, log = console }) {
  const path = url.pathname;
  if (!path.startsWith('/api/support')) return false;

  try {
    const { user, token } = await currentAccount(req, sessions);
    const denied = requireSupport(user);
    if (denied) {
      json(res, denied.status, denied.body);
      return true;
    }

    if (req.method === 'GET') {
      const now = Date.now();
      if (path === '/api/support/members') {
        const members = await customerRows(now);
        json(res, 200, { ok: true, members, generatedAt: new Date(now).toISOString() });
        return true;
      }
      if (path === '/api/support/overview') {
        const members = await customerRows(now);
        json(res, 200, {
          ok: true,
          counts: {
            total: members.length,
            online: members.filter((m) => m.presence === 'ONLINE').length,
            pro: members.filter((m) => m.plan === 'pro').length,
            disabled: members.filter((m) => m.disabled).length,
          },
          generatedAt: new Date(now).toISOString(),
        });
        return true;
      }
      return false;
    }

    if (req.method !== 'POST') return false;
    if (!sameOrigin(req)) {
      json(res, 403, { ok: false, code: 'ORIGIN_INVALID', message: 'Cross-origin request rejected.' });
      return true;
    }
    if (!csrfValid(token, req.headers['x-csrf-token'], secret)) {
      json(res, 403, { ok: false, code: 'CSRF_INVALID', message: 'Your session expired. Reload and try again.' });
      return true;
    }
    const body = await readBody(req);

    if (path === '/api/support/session/revoke') {
      const target = await customerTarget(body.userId);
      if (!target) {
        json(res, 404, { ok: false, code: 'CUSTOMER_NOT_FOUND', message: 'That customer account is not available to Support.' });
        return true;
      }
      const sessionId = String(body.sessionId || '');
      const targetSessions = await sessionsForUser(target.id);
      if (!targetSessions.some((session) => session.id === sessionId)) {
        json(res, 404, { ok: false, code: 'SESSION_NOT_FOUND', message: 'That customer session has already ended.' });
        return true;
      }
      const revoked = await revokeSession(sessionId);
      await appendAudit({
        actorId: user.id,
        actorRole: isOwner(user) ? ROLES.OWNER : ROLES.SUPPORT,
        action: 'support.session.revoke',
        targetId: target.id,
        outcome: revoked ? 'success' : 'no-op',
      });
      log?.log?.(`[Oblige Props support] staff ${user.id} revoked one customer session for ${target.id}`);
      json(res, 200, { ok: true, revoked: Boolean(revoked), message: revoked ? 'Customer device signed out.' : 'That session had already ended.' });
      return true;
    }

    if (path === '/api/support/session/revoke-all') {
      const target = await customerTarget(body.userId);
      if (!target) {
        json(res, 404, { ok: false, code: 'CUSTOMER_NOT_FOUND', message: 'That customer account is not available to Support.' });
        return true;
      }
      await revokeSessions(target.id);
      await revokeAllForUser(target.id);
      await appendAudit({
        actorId: user.id,
        actorRole: isOwner(user) ? ROLES.OWNER : ROLES.SUPPORT,
        action: 'support.session.revoke-all',
        targetId: target.id,
      });
      log?.log?.(`[Oblige Props support] staff ${user.id} signed customer ${target.id} out everywhere`);
      json(res, 200, { ok: true, message: 'Customer signed out on every device.' });
      return true;
    }

    return false;
  } catch (error) {
    log?.error?.('[Oblige Props support] request failed', JSON.stringify(internalDetail(error, { stage: 'support-route', path })));
    json(res, error?.code === 'REQUEST_INVALID' ? 400 : 500, {
      ok: false,
      message: error?.code === 'REQUEST_INVALID' ? 'That request could not be processed.' : GENERIC_MESSAGE,
    });
    return true;
  }
}
