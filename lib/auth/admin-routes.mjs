// Owner-only administration.
//
// Every handler calls requireOwner() itself. The owner identity is pinned to
// ACCOUNT_OWNER_EMAIL by permissions.mjs; a stored role string alone is never
// enough in production.

import { listUsers, findById, updateUser, revokeSessions } from './store.mjs';
import { allSessions, revokeSession, revokeAllForUser, presenceOf, ONLINE_MS, IDLE_MS } from './presence.mjs';
import { requireOwner, isOwner, capabilitiesFor, navFor, ROLES } from './permissions.mjs';
import { currentAccount } from './routes.mjs';
import { csrfValid } from './session.mjs';
import { appendAudit, readAudit } from './audit.mjs';
import { createAccountNotice } from './account-notices.mjs';
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

async function membersWithPresence(now = Date.now()) {
  const [users, sessions] = await Promise.all([listUsers(), allSessions({ now })]);
  const byUser = new Map();
  for (const session of sessions) {
    if (!byUser.has(session.userId)) byUser.set(session.userId, []);
    byUser.get(session.userId).push(session);
  }
  return users.map((user) => {
    const live = byUser.get(user.id) || [];
    const mostRecent = live[0] ?? null;
    return {
      ...user,
      presence: mostRecent ? presenceOf(mostRecent.lastSeenAt, now) : 'OFFLINE',
      activeSessions: live.length,
      lastSeenAt: mostRecent?.lastSeenAt ?? user.lastLoginAt ?? null,
      devices: live.map(({ id, device, ip, presence, lastSeenAt, createdAt }) => ({ id, device, ip, presence, lastSeenAt, createdAt })),
    };
  }).sort((a, b) => {
    const rank = { ONLINE: 0, IDLE: 1, OFFLINE: 2 };
    return (rank[a.presence] - rank[b.presence])
      || (Date.parse(b.lastSeenAt || 0) - Date.parse(a.lastSeenAt || 0));
  });
}

/** @returns {Promise<boolean>} true when handled */
export async function handleAdminRoutes(req, res, url, { sessions, json, secret, log = console }) {
  const path = url.pathname;
  if (!path.startsWith('/api/admin')) return false;

  try {
    const { user, token } = await currentAccount(req, sessions);
    const denied = requireOwner(user);
    if (denied) {
      json(res, denied.status, denied.body);
      return true;
    }

    if (req.method === 'GET') {
      const now = Date.now();

      if (path === '/api/admin/overview') {
        const members = await membersWithPresence(now);
        json(res, 200, {
          ok: true,
          counts: {
            total: members.length,
            online: members.filter((m) => m.presence === 'ONLINE').length,
            idle: members.filter((m) => m.presence === 'IDLE').length,
            verified: members.filter((m) => m.emailVerified).length,
            unverified: members.filter((m) => !m.emailVerified).length,
            disabled: members.filter((m) => m.disabled).length,
            owners: members.filter((m) => isOwner(m)).length,
            support: members.filter((m) => m.role === ROLES.SUPPORT && !isOwner(m)).length,
          },
          windows: { onlineMs: ONLINE_MS, idleMs: IDLE_MS },
          generatedAt: new Date(now).toISOString(),
        });
        return true;
      }

      if (path === '/api/admin/members') {
        json(res, 200, { ok: true, members: await membersWithPresence(now) });
        return true;
      }

      if (path === '/api/admin/presence') {
        const live = await allSessions({ now });
        const users = await listUsers();
        const emailById = new Map(users.map((u) => [u.id, u.email]));
        json(res, 200, {
          ok: true,
          sessions: live.map((session) => ({ ...session, email: emailById.get(session.userId) ?? null })),
          windows: { onlineMs: ONLINE_MS, idleMs: IDLE_MS },
          generatedAt: new Date(now).toISOString(),
        });
        return true;
      }

      if (path === '/api/admin/audit') {
        json(res, 200, { ok: true, entries: await readAudit({ limit: 250 }) });
        return true;
      }

      return false;
    }

    if (req.method !== 'POST') return false;
    if (!csrfValid(token, req.headers['x-csrf-token'], secret)) {
      json(res, 403, { ok: false, code: 'CSRF_INVALID', message: 'Your session expired. Reload and try again.' });
      return true;
    }
    const body = await readBody(req);

    if (path === '/api/admin/session/revoke') {
      const sessionId = String(body.sessionId || '');
      const live = await allSessions({ now: Date.now() });
      const targetSession = live.find((row) => row.id === sessionId) || null;
      const revoked = await revokeSession(sessionId);
      if (revoked && targetSession?.userId) {
        await createAccountNotice({
          userId: targetSession.userId,
          type: 'device-signed-out',
          title: 'Device signed out',
          message: 'The Oblige Props owner signed one of your account devices out. Your other active sessions are unchanged.',
        });
      }
      await appendAudit({ actorId: user.id, actorRole: ROLES.OWNER, action: 'owner.session.revoke', targetId: targetSession?.userId || null, outcome: revoked ? 'success' : 'no-op' });
      log?.log?.(`[Oblige Props admin] owner ${user.id} revoked a session`);
      json(res, 200, { ok: true, revoked: Boolean(revoked), message: revoked ? 'That device was signed out.' : 'That session had already ended.' });
      return true;
    }

    if (path === '/api/admin/member/disable') {
      const target = await findById(body.userId);
      if (!target) { json(res, 404, { ok: false, message: 'No such account.' }); return true; }
      if (isOwner(target)) {
        json(res, 400, { ok: false, code: 'OWNER_PROTECTED', message: 'The designated owner account cannot be disabled here.' });
        return true;
      }
      const disabled = body.disabled !== false;
      await updateUser(target.id, () => ({ disabled }));
      await createAccountNotice({
        userId: target.id,
        type: disabled ? 'account-disabled' : 'account-restored',
        title: disabled ? 'Account banned' : 'Account restored',
        message: disabled
          ? 'Your Oblige Props account was banned by the owner. Access is disabled until the owner restores the account.'
          : 'Your Oblige Props account was restored by the owner. You can sign in and continue using the site.',
      });
      if (disabled) {
        await revokeSessions(target.id);
        await revokeAllForUser(target.id);
      }
      await appendAudit({
        actorId: user.id,
        actorRole: ROLES.OWNER,
        action: disabled ? 'owner.member.disable' : 'owner.member.restore',
        targetId: target.id,
      });
      log?.log?.(`[Oblige Props admin] owner ${user.id} ${disabled ? 'disabled' : 're-enabled'} account ${target.id}`);
      json(res, 200, { ok: true, message: disabled ? 'Account disabled and signed out everywhere.' : 'Account re-enabled.' });
      return true;
    }

    if (path === '/api/admin/member/role') {
      const target = await findById(body.userId);
      if (!target) { json(res, 404, { ok: false, message: 'No such account.' }); return true; }
      if (isOwner(target)) {
        json(res, 400, { ok: false, code: 'OWNER_PROTECTED', message: 'The designated owner account cannot be reassigned.' });
        return true;
      }
      // Owner promotion is intentionally impossible through the browser. The
      // single owner is controlled only by ACCOUNT_OWNER_EMAIL on the server.
      if (body.role === ROLES.OWNER) {
        json(res, 400, { ok: false, code: 'INVALID_ROLE', message: 'Owner access can only be assigned by the server owner identity.' });
        return true;
      }
      if (body.role !== ROLES.SUPPORT && body.role !== ROLES.MEMBER) {
        json(res, 400, { ok: false, code: 'ROLE_INVALID', message: 'Choose either member or support access.' });
        return true;
      }
      const role = body.role === ROLES.SUPPORT ? ROLES.SUPPORT : ROLES.MEMBER;
      await updateUser(target.id, () => ({ role }));
      await createAccountNotice({
        userId: target.id,
        type: role === ROLES.SUPPORT ? 'support-granted' : 'support-removed',
        title: role === ROLES.SUPPORT ? 'Support access granted' : 'Support access removed',
        message: role === ROLES.SUPPORT
          ? 'The Oblige Props owner granted support access to your account. You were signed out so the new permissions can take effect.'
          : 'The Oblige Props owner changed your account back to member access. You were signed out so the updated permissions can take effect.',
      });
      await revokeSessions(target.id);
      await revokeAllForUser(target.id);
      await appendAudit({
        actorId: user.id,
        actorRole: ROLES.OWNER,
        action: role === ROLES.SUPPORT ? 'owner.role.support' : 'owner.role.member',
        targetId: target.id,
      });
      log?.log?.(`[Oblige Props admin] owner ${user.id} set account ${target.id} to ${role}`);
      json(res, 200, { ok: true, message: `Account is now ${role}. They were signed out and must sign in again for the new access.` });
      return true;
    }

    return false;
  } catch (error) {
    log?.error?.('[Oblige Props admin] request failed', JSON.stringify(internalDetail(error, { stage: 'admin-route', path })));
    json(res, error?.code === 'REQUEST_INVALID' ? 400 : 500, {
      ok: false,
      message: error?.code === 'REQUEST_INVALID' ? 'That request could not be processed.' : GENERIC_MESSAGE,
    });
    return true;
  }
}

export { capabilitiesFor, navFor };
