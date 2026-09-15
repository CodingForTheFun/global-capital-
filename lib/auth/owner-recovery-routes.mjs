// Passwordless recovery for the single designated Oblige Props owner.
//
// This is intentionally NOT a backdoor. Recovery is bound to ACCOUNT_OWNER_EMAIL,
// delivers a short-lived one-time code to that inbox, rate-limits both issuance
// and verification, stores only a hash of the code, revokes older sessions on
// success, and never returns the configured owner email or code to the browser.

import crypto from 'node:crypto';
import {
  CODE_RESULT,
  attemptsRemaining,
  issueCode,
  verifyCode,
  withinCooldown,
} from './codes.mjs';
import { createUser, findByEmail, publicUser, updateUser } from './store.mjs';
import { hashPassword } from './passwords.mjs';
import { configuredOwnerEmail, isOwner, capabilitiesFor, navFor } from './permissions.mjs';
import { isConfigured as mailConfigured, send as sendMail } from './mailer.mjs';
import { accountCookie, csrfTokenFor } from './session.mjs';
import { startSession, revokeAllForUser } from './presence.mjs';
import { appendAudit } from './audit.mjs';
import { createRateLimiter, clientKey } from '../session.mjs';

const PURPOSE = 'owner_recovery';
const limiter = createRateLimiter();
const NEUTRAL_START = 'If owner recovery is available, a one-time code has been sent to the configured owner inbox.';

function clientIp(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req?.socket?.remoteAddress || null;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    return new URL(origin).host === host;
  } catch { return false; }
}

async function readBody(req, limit = 4_000) {
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

function startAllowed(req) {
  return limiter.allow(clientKey(req, 'owner-recovery-start'), 3, 60 * 60_000)
    && limiter.allow('owner-recovery-start:global', 6, 60 * 60_000);
}

function verifyAllowed(req) {
  return limiter.allow(clientKey(req, 'owner-recovery-verify'), 10, 15 * 60_000)
    && limiter.allow('owner-recovery-verify:global', 30, 60 * 60_000);
}

function recoveryEmail(code) {
  const escaped = String(code).replace(/[^0-9]/g, '');
  return {
    subject: `${escaped} is your Oblige Props owner access code`,
    text: `Your Oblige Props owner access code is ${escaped}.\n\nIt expires in 10 minutes and works once. A successful recovery signs older owner sessions out.\n\nIf you did not request this, ignore the email.`,
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#07090d;font-family:system-ui,-apple-system,Segoe UI,sans-serif"><div style="max-width:480px;margin:0 auto;background:#101722;border:1px solid #2b2e34;border-radius:18px;padding:28px;color:#f7f8fa"><div style="font-size:11px;font-weight:800;letter-spacing:.15em;color:#d8a94a">OBLIGE PROPS · OWNER RECOVERY</div><h1 style="font-size:21px;margin:14px 0 8px">Private owner sign-in</h1><p style="margin:0;color:#9aa4b2;font-size:14px;line-height:1.6">Enter this one-time code on the private owner recovery screen. It expires in 10 minutes and can only be used once.</p><div style="margin:20px 0;padding:18px;border:1px solid #5d4a27;border-radius:14px;background:#0a0e14;text-align:center;font:700 30px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.28em;color:#f0c86e">${escaped}</div><p style="font-size:12px;line-height:1.6;color:#7f8997;border-top:1px solid #232a35;padding-top:14px">A successful recovery revokes older owner sessions. If this was not requested by you, do nothing.</p></div></body></html>`,
  };
}

async function ownerRecord({ createIfMissing = false } = {}) {
  const email = configuredOwnerEmail();
  if (!email) return null;
  let user = await findByEmail(email);
  // The designated inbox is the production owner identity. If the owner never
  // completed account registration, recovery can safely bootstrap a locked
  // account with an unknowable random password; inbox proof is still required
  // before it is verified or a session is issued.
  if (!user && createIfMissing) {
    const randomPassword = crypto.randomBytes(32).toString('base64url');
    const passwordHash = await hashPassword(randomPassword);
    const created = await createUser({ email, passwordHash, role: 'member', emailVerified: false });
    user = created.user;
  }
  if (!user || user.disabled || !isOwner(user)) return null;
  return user;
}

async function startRecovery({ log = console } = {}) {
  const user = await ownerRecord({ createIfMissing: true });
  if (!user || !mailConfigured()) return { ok: true, code: 'OWNER_RECOVERY_SENT', message: NEUTRAL_START };

  const existing = user.pendingCodes?.[PURPOSE];
  if (withinCooldown(existing)) return { ok: true, code: 'OWNER_RECOVERY_SENT', message: NEUTRAL_START };

  const secret = process.env.DASHBOARD_SESSION_SECRET || process.env.AUTOPROP_MASTER_KEY || process.env.DASHBOARD_PASSWORD;
  if (!secret) return { ok: true, code: 'OWNER_RECOVERY_SENT', message: NEUTRAL_START };

  const { code, record } = issueCode({ userId: user.id, purpose: PURPOSE, secret });
  await updateUser(user.id, (current) => ({
    pendingCodes: { ...current.pendingCodes, [PURPOSE]: record },
  }));
  const delivered = await sendMail({ to: user.email, ...recoveryEmail(code) }, { log });
  if (!delivered.ok) log?.error?.('[Oblige Props owner recovery] code delivery failed');
  return { ok: true, code: 'OWNER_RECOVERY_SENT', message: NEUTRAL_START };
}

async function verifyRecovery({ code, req, sessions, secret, log = console }) {
  const submitted = String(code || '').trim();
  if (!/^\d{6}$/.test(submitted)) {
    return { status: 400, body: { ok: false, code: 'AUTH_CODE_INVALID', message: 'Enter the 6-digit owner access code.' } };
  }

  const user = await ownerRecord();
  const codeSecret = process.env.DASHBOARD_SESSION_SECRET || process.env.AUTOPROP_MASTER_KEY || process.env.DASHBOARD_PASSWORD;
  if (!user || !codeSecret) {
    return { status: 400, body: { ok: false, code: 'AUTH_CODE_INVALID', message: 'That code is not valid. Request a new one.' } };
  }

  const outcome = verifyCode(user.pendingCodes?.[PURPOSE], submitted, {
    userId: user.id,
    purpose: PURPOSE,
    secret: codeSecret,
  });

  if (outcome.result !== CODE_RESULT.OK) {
    await updateUser(user.id, (current) => {
      const pending = { ...current.pendingCodes };
      if (outcome.record) pending[PURPOSE] = outcome.record;
      else delete pending[PURPOSE];
      return { pendingCodes: pending };
    });
    if (outcome.result === CODE_RESULT.EXPIRED) {
      return { status: 400, body: { ok: false, code: 'AUTH_CODE_EXPIRED', message: 'That code expired. Request a new one.' } };
    }
    if (outcome.result === CODE_RESULT.EXHAUSTED) {
      return { status: 429, body: { ok: false, code: 'AUTH_CODE_EXHAUSTED', message: 'Too many incorrect attempts. Request a new code.' } };
    }
    const left = attemptsRemaining(outcome.record);
    return { status: 400, body: { ok: false, code: 'AUTH_CODE_INVALID', message: `That code is not correct. ${left} attempt${left === 1 ? '' : 's'} remaining.` } };
  }

  const updated = await updateUser(user.id, (current) => {
    const pending = { ...current.pendingCodes };
    delete pending[PURPOSE];
    return {
      pendingCodes: pending,
      emailVerified: true,
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date().toISOString(),
      lastLoginIp: clientIp(req) ? String(clientIp(req)).slice(0, 64) : null,
      // Recovery is security-sensitive: evict every older account token.
      sessionVersion: Number(current.sessionVersion || 1) + 1,
    };
  });

  if (!updated || !isOwner(updated)) {
    return { status: 403, body: { ok: false, code: 'OWNER_REQUIRED', message: 'Owner recovery is unavailable.' } };
  }

  await revokeAllForUser(updated.id);
  const sessionId = await startSession({
    userId: updated.id,
    ip: clientIp(req),
    userAgent: req.headers['user-agent'],
  });
  const token = sessions.issue(updated.id, updated.sessionVersion, sessionId);
  const cookie = accountCookie(req, token, { ttlMs: sessions.ttlMs });
  const csrfToken = csrfTokenFor(token, secret);
  await appendAudit({ actorId: updated.id, actorRole: 'owner', action: 'owner.recovery.signin', outcome: 'success' }).catch(() => {});
  log?.log?.(`[Oblige Props owner recovery] passwordless owner session issued for ${updated.id}`);

  return {
    status: 200,
    headers: { 'set-cookie': cookie },
    body: {
      ok: true,
      code: 'OWNER_RECOVERY_COMPLETE',
      authenticated: true,
      message: 'Owner access verified.',
      user: publicUser(updated),
      capabilities: capabilitiesFor(updated),
      nav: navFor(updated),
      csrfToken,
      redirect: '/owner',
    },
  };
}

/**
 * POST /api/owner-recovery/start  -> send code to configured owner inbox
 * POST /api/owner-recovery/verify -> code -> owner account session
 */
export async function handleOwnerRecoveryRoutes(req, res, url, { sessions, json, secret, log = console }) {
  const path = url.pathname;
  if (path !== '/api/owner-recovery/start' && path !== '/api/owner-recovery/verify') return false;

  if (req.method !== 'POST') {
    json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' }, { allow: 'POST' });
    return true;
  }
  if (!sameOrigin(req)) {
    json(res, 403, { ok: false, code: 'ORIGIN_REJECTED', message: 'Cross-origin request rejected.' });
    return true;
  }

  try {
    if (path === '/api/owner-recovery/start') {
      if (!startAllowed(req)) {
        json(res, 429, { ok: false, code: 'RATE_LIMITED', message: 'Owner recovery was requested recently. Try again later.' }, { 'retry-after': '3600' });
        return true;
      }
      const result = await startRecovery({ log });
      json(res, 200, result);
      return true;
    }

    if (!verifyAllowed(req)) {
      json(res, 429, { ok: false, code: 'RATE_LIMITED', message: 'Too many verification attempts. Try again later.' }, { 'retry-after': '900' });
      return true;
    }
    const body = await readBody(req);
    const result = await verifyRecovery({ code: body.code, req, sessions, secret, log });
    json(res, result.status, result.body, result.headers || {});
    return true;
  } catch (error) {
    log?.error?.('[Oblige Props owner recovery] request failed', String(error?.code || error?.message || 'OWNER_RECOVERY_ERROR').slice(0, 120));
    json(res, error?.code === 'REQUEST_INVALID' ? 400 : 500, {
      ok: false,
      code: error?.code === 'REQUEST_INVALID' ? 'REQUEST_INVALID' : 'OWNER_RECOVERY_ERROR',
      message: error?.code === 'REQUEST_INVALID' ? 'That request could not be processed.' : 'Owner recovery is temporarily unavailable.',
    });
    return true;
  }
}

export const _ownerRecoveryTest = Object.freeze({ PURPOSE });
