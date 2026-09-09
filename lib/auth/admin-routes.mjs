// Owner-only administration.
//
//   GET  /api/admin/overview          headline counts for the panel
//   GET  /api/admin/members           every account, with live presence
//   GET  /api/admin/presence          live sessions across all accounts
//   POST /api/admin/session/revoke    sign out one device
//   POST /api/admin/member/disable    disable or re-enable an account
//   POST /api/admin/member/role       promote or demote an account
//
// Every handler calls requireOwner() itself. The client hides these tabs from
// members, but that is presentation — this file is the actual boundary.

import { listUsers, findById, updateUser, revokeSessions } from './store.mjs';
import { allSessions, sessionsForUser, revokeSession, revokeAllForUser, presenceOf, ONLINE_MS, IDLE_MS } from './presence.mjs';
import { requireOwner, capabilitiesFor, navFor, ROLES } from './permissions.mjs';
import { currentAccount } from './routes.mjs';
import { csrfValid } from './session.mjs';
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

/** Merge accounts with their live sessions into one row per member. */
async function membersWithPresence(now = Date.now()) {
  const [users, sessions] = await Promise.all([listUsers(), allSessions({ now })]);
  const byUser = new Map();
  for (const session of sessions) {
    if (!byUser.has(session.userId)) byUser.set(session.userId, []);
    byUser.get(session.userId).push(session);
  }
  return users.map((user) => {
    const live = byUser.get(user.id) || [];
    // A person is as present as their most recently active device.
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

/**
 * @param {object} deps { sessions, json, secret, log }
 * @returns {Promise<boolean>} true when handled
 */
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

    // --- reads -------------------------------------------------------------
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
            owners: members.filter((m) => m.role === ROLES.OWNER).length,
          },
          // So the client can label its own thresholds identically.
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
          // Sessions, not people: one person may appear on several devices.
          sessions: live.map((session) => ({ ...session, email: emailById.get(session.userId) ?? null })),
          windows: { onlineMs: ONLINE_MS, idleMs: IDLE_MS },
          generatedAt: new Date(now).toISOString(),
        });
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

    // --- writes ------------------------------------------------------------
    if (path === '/api/admin/session/revoke') {
      const sessionId = String(body.sessionId || '');
      const revoked = await revokeSession(sessionId);
      log?.log?.(`[Scout Pro admin] owner ${user.id} revoked session ${sessionId}`);
      json(res, 200, { ok: true, revoked: Boolean(revoked), message: revoked ? 'That device was signed out.' : 'That session had already ended.' });
      return true;
    }

    if (path === '/api/admin/member/disable') {
      const target = await findById(body.userId);
      if (!target) { json(res, 404, { ok: false, message: 'No such account.' }); return true; }
      // An owner locking themselves out would need database access to undo.
      if (target.id === user.id) {
        json(res, 400, { ok: false, code: 'SELF_DISABLE', message: 'You cannot disable your own account.' });
        return true;
      }
      const disabled = body.disabled !== false;
      await updateUser(target.id, () => ({ disabled }));
      if (disabled) {
        // Disabling must take effect now, not at cookie expiry.
        await revokeSessions(target.id);
        await revokeAllForUser(target.id);
      }
      log?.log?.(`[Scout Pro admin] owner ${user.id} ${disabled ? 'disabled' : 're-enabled'} account ${target.id}`);
      json(res, 200, { ok: true, message: disabled ? 'Account disabled and signed out everywhere.' : 'Account re-enabled.' });
      return true;
    }

    if (path === '/api/admin/member/role') {
      const target = await findById(body.userId);
      if (!target) { json(res, 404, { ok: false, message: 'No such account.' }); return true; }
      const role = body.role === ROLES.OWNER ? ROLES.OWNER : ROLES.MEMBER;
      if (target.id === user.id && role !== ROLES.OWNER) {
        // Demoting the last owner would leave nobody able to administer.
        const members = await listUsers();
        if (members.filter((m) => m.role === ROLES.OWNER).length <= 1) {
          json(res, 400, { ok: false, code: 'LAST_OWNER', message: 'Promote another owner before demoting yourself.' });
          return true;
        }
      }
      await updateUser(target.id, () => ({ role }));
      // A role change alters capabilities, so force a fresh session.
      await revokeSessions(target.id);
      log?.log?.(`[Scout Pro admin] owner ${user.id} set account ${target.id} to ${role}`);
      json(res, 200, { ok: true, message: `Account is now ${role}. They will be signed out and back in with the new access.` });
      return true;
    }

    return false;
  } catch (error) {
    log?.error?.('[Scout Pro admin] request failed', JSON.stringify(internalDetail(error, { stage: 'admin-route', path })));
    json(res, error?.code === 'REQUEST_INVALID' ? 400 : 500, {
      ok: false,
      message: error?.code === 'REQUEST_INVALID' ? 'That request could not be processed.' : GENERIC_MESSAGE,
    });
    return true;
  }
}

export { capabilitiesFor, navFor };
