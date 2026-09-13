// Owner-only subscription/access controls for the Oblige Props control center.
//
// This module is deliberately separate from payment webhooks. Owner-granted
// access is recorded as `owner-console`, so a complimentary extension can never
// be mistaken for a processor-confirmed subscription.

import { currentAccount } from './routes.mjs';
import { findById, listUsers } from './store.mjs';
import { requireOwner } from './permissions.mjs';
import { csrfValid } from './session.mjs';
import { entitlementFor, grantPlan, revokePlan, publicEntitlement } from '../billing/entitlements.mjs';
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

function ownerAccessShape(entitlement) {
  const publicAccess = publicEntitlement(entitlement);
  return {
    ...publicAccess,
    source: entitlement?.record?.source || null,
    updatedAt: entitlement?.record?.updatedAt || null,
  };
}

async function allEntitlements() {
  const users = await listUsers();
  return Promise.all(users.map(async (user) => ({
    userId: user.id,
    email: user.email,
    access: ownerAccessShape(await entitlementFor(user.id)),
  })));
}

/**
 * GET  /api/admin/entitlements
 * POST /api/admin/member/access { userId, action: grant|extend|revoke, days? }
 */
export async function handleAdminAccessRoutes(req, res, url, { sessions, json, secret, log = console }) {
  const path = url.pathname;
  if (path !== '/api/admin/entitlements' && path !== '/api/admin/member/access') return false;

  try {
    const { user, token } = await currentAccount(req, sessions);
    const denied = requireOwner(user);
    if (denied) {
      json(res, denied.status, denied.body);
      return true;
    }

    if (path === '/api/admin/entitlements' && req.method === 'GET') {
      json(res, 200, { ok: true, entitlements: await allEntitlements(), generatedAt: new Date().toISOString() });
      return true;
    }

    if (path !== '/api/admin/member/access' || req.method !== 'POST') return false;

    if (!csrfValid(token, req.headers['x-csrf-token'], secret)) {
      json(res, 403, { ok: false, code: 'CSRF_INVALID', message: 'Your session expired. Reload and try again.' });
      return true;
    }

    const body = await readBody(req);
    const target = await findById(body.userId);
    if (!target) {
      json(res, 404, { ok: false, code: 'ACCOUNT_NOT_FOUND', message: 'No such account.' });
      return true;
    }

    const action = String(body.action || '').trim().toLowerCase();
    if (action === 'revoke') {
      await revokePlan({ accountId: target.id, source: 'owner-console' });
      const access = await entitlementFor(target.id);
      log?.log?.(`[Oblige Props admin] owner ${user.id} revoked pro access for ${target.id}`);
      json(res, 200, { ok: true, access: ownerAccessShape(access), message: 'Pro access removed.' });
      return true;
    }

    if (!['grant', 'extend'].includes(action)) {
      json(res, 400, { ok: false, code: 'ACCESS_ACTION_INVALID', message: 'Choose grant, extend, or revoke.' });
      return true;
    }

    const days = Math.trunc(Number(body.days));
    if (!Number.isFinite(days) || days < 1 || days > 3650) {
      json(res, 400, { ok: false, code: 'ACCESS_DAYS_INVALID', message: 'Access time must be between 1 and 3650 days.' });
      return true;
    }

    const current = await entitlementFor(target.id);
    const now = Date.now();
    const currentExpiry = Date.parse(current?.record?.expiresAt || '');
    const base = action === 'extend' && Number.isFinite(currentExpiry) && currentExpiry > now ? currentExpiry : now;
    const expiresAt = new Date(base + days * 24 * 60 * 60 * 1000).toISOString();

    await grantPlan({
      accountId: target.id,
      plan: 'pro',
      expiresAt,
      source: 'owner-console',
      reference: `owner:${user.id}`,
    });

    const access = await entitlementFor(target.id);
    log?.log?.(`[Oblige Props admin] owner ${user.id} ${action}ed ${days} day(s) of pro access for ${target.id}`);
    json(res, 200, {
      ok: true,
      access: ownerAccessShape(access),
      message: action === 'extend' ? `Access extended by ${days} day${days === 1 ? '' : 's'}.` : `Pro access granted for ${days} day${days === 1 ? '' : 's'}.`,
    });
    return true;
  } catch (error) {
    log?.error?.('[Oblige Props admin] access request failed', JSON.stringify(internalDetail(error, { stage: 'admin-access', path })));
    json(res, error?.code === 'REQUEST_INVALID' ? 400 : 500, {
      ok: false,
      message: error?.code === 'REQUEST_INVALID' ? 'That request could not be processed.' : GENERIC_MESSAGE,
    });
    return true;
  }
}
