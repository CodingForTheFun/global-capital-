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
import { generateAccessCode, listAccessCodes, revokeAccessCode } from '../../access-codes.mjs';
import { internalDetail, GENERIC_MESSAGE } from '../safe-error.mjs';

const MAX_ACCESS_DAYS = 3650;
const MAX_CODE_USES = 100000;
const CODE_PATHS = new Set([
  '/api/admin/access-codes',
  '/api/admin/access-codes/generate',
  '/api/admin/access-codes/revoke',
]);

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

function processorManaged(entitlement) {
  const source = String(entitlement?.record?.source || '').trim();
  return entitlement?.plan?.id === 'pro' && Boolean(source) && source !== 'owner-console';
}

function unlimited(value) {
  return value === null || String(value ?? '').trim().toLowerCase() === 'unlimited';
}

function finiteInteger(value, min, max) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

/**
 * GET  /api/admin/entitlements
 * GET  /api/admin/access-codes
 * POST /api/admin/member/access { userId, action: grant|extend|revoke, days?, unlimited? }
 * POST /api/admin/access-codes/generate { label, expiresInDays?, neverExpires?, maxUses?, unlimitedUses? }
 * POST /api/admin/access-codes/revoke { id }
 */
export async function handleAdminAccessRoutes(req, res, url, { sessions, json, secret, log = console }) {
  const path = url.pathname;
  if (path !== '/api/admin/entitlements' && path !== '/api/admin/member/access' && !CODE_PATHS.has(path)) return false;

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

    if (path === '/api/admin/access-codes' && req.method === 'GET') {
      json(res, 200, { ok: true, codes: await listAccessCodes(), generatedAt: new Date().toISOString() });
      return true;
    }

    if (req.method !== 'POST') return false;

    if (!csrfValid(token, req.headers['x-csrf-token'], secret)) {
      json(res, 403, { ok: false, code: 'CSRF_INVALID', message: 'Your session expired. Reload and try again.' });
      return true;
    }

    const body = await readBody(req);

    if (path === '/api/admin/access-codes/generate') {
      const neverExpires = body.neverExpires === true || unlimited(body.expiresInDays);
      const unlimitedUses = body.unlimitedUses === true || unlimited(body.maxUses);
      const expiresInDays = neverExpires ? null : finiteInteger(body.expiresInDays, 1, MAX_ACCESS_DAYS);
      const maxUses = unlimitedUses ? null : finiteInteger(body.maxUses, 1, MAX_CODE_USES);

      if (!neverExpires && expiresInDays === null) {
        json(res, 400, { ok: false, code: 'ACCESS_DAYS_INVALID', message: `Code duration must be between 1 and ${MAX_ACCESS_DAYS} days, or Unlimited.` });
        return true;
      }
      if (!unlimitedUses && maxUses === null) {
        json(res, 400, { ok: false, code: 'ACCESS_USES_INVALID', message: `Redemptions must be between 1 and ${MAX_CODE_USES}, or Unlimited.` });
        return true;
      }

      const created = await generateAccessCode({
        label: body.label,
        expiresInDays,
        maxUses,
        neverExpires,
        unlimitedUses,
      });
      log?.log?.(`[Oblige Props admin] owner ${user.id} generated access code ${created.id}`);
      json(res, 200, {
        ok: true,
        code: created.code,
        accessCode: { ...created, code: undefined },
        message: 'Access code generated. Copy it now; only the final four characters remain visible after you leave this page.',
      });
      return true;
    }

    if (path === '/api/admin/access-codes/revoke') {
      const id = String(body.id || '').trim();
      if (!id) {
        json(res, 400, { ok: false, code: 'ACCESS_CODE_ID_REQUIRED', message: 'Choose an access code to revoke.' });
        return true;
      }
      const revoked = await revokeAccessCode(id);
      if (!revoked) {
        json(res, 404, { ok: false, code: 'ACCESS_CODE_NOT_FOUND', message: 'That access code no longer exists.' });
        return true;
      }
      log?.log?.(`[Oblige Props admin] owner ${user.id} revoked access code ${revoked.id}`);
      json(res, 200, { ok: true, accessCode: revoked, message: 'Access code revoked. Existing sessions using it will stop working on their next request.' });
      return true;
    }

    if (path !== '/api/admin/member/access') return false;

    const target = await findById(body.userId);
    if (!target) {
      json(res, 404, { ok: false, code: 'ACCOUNT_NOT_FOUND', message: 'No such account.' });
      return true;
    }

    const action = String(body.action || '').trim().toLowerCase();
    const current = await entitlementFor(target.id);

    // Payment processors remain the authority over paid subscriptions. The
    // owner console cannot overwrite, extend, or revoke a processor-managed
    // record because doing so would corrupt refund/cancellation reconciliation.
    if (processorManaged(current)) {
      json(res, 409, {
        ok: false,
        code: 'PROCESSOR_ACCESS_LOCKED',
        message: 'This active Pro subscription is processor-managed. Use the billing system for changes; owner-granted time can be added after it ends.',
      });
      return true;
    }

    if (action === 'revoke') {
      await revokePlan({ accountId: target.id, source: 'owner-console' });
      const access = await entitlementFor(target.id);
      log?.log?.(`[Oblige Props admin] owner ${user.id} revoked complimentary pro access for ${target.id}`);
      json(res, 200, { ok: true, access: ownerAccessShape(access), message: 'Complimentary Pro access removed.' });
      return true;
    }

    if (!['grant', 'extend'].includes(action)) {
      json(res, 400, { ok: false, code: 'ACCESS_ACTION_INVALID', message: 'Choose grant, extend, or revoke.' });
      return true;
    }

    const lifetime = body.unlimited === true || unlimited(body.days);
    const days = lifetime ? null : finiteInteger(body.days, 1, MAX_ACCESS_DAYS);
    if (!lifetime && days === null) {
      json(res, 400, { ok: false, code: 'ACCESS_DAYS_INVALID', message: `Access time must be between 1 and ${MAX_ACCESS_DAYS} days, or Unlimited.` });
      return true;
    }

    const now = Date.now();
    const currentExpiry = Date.parse(current?.record?.expiresAt || '');
    const base = action === 'extend' && Number.isFinite(currentExpiry) && currentExpiry > now ? currentExpiry : now;
    const expiresAt = lifetime ? null : new Date(base + days * 24 * 60 * 60 * 1000).toISOString();

    await grantPlan({
      accountId: target.id,
      plan: 'pro',
      expiresAt,
      source: 'owner-console',
      reference: `owner:${user.id}`,
    });

    const access = await entitlementFor(target.id);
    log?.log?.(`[Oblige Props admin] owner ${user.id} ${action}ed ${lifetime ? 'unlimited' : `${days} day(s) of`} complimentary pro access for ${target.id}`);
    json(res, 200, {
      ok: true,
      access: ownerAccessShape(access),
      message: lifetime
        ? 'Unlimited complimentary Pro access granted.'
        : action === 'extend'
          ? `Complimentary access extended by ${days} day${days === 1 ? '' : 's'}.`
          : `Complimentary Pro access granted for ${days} day${days === 1 ? '' : 's'}.`,
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
