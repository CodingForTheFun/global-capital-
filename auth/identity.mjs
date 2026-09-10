import { auth, from, supabaseConfig, SupabaseError } from '../db/supabase.mjs';
import { sealSession, openSession, deviceFingerprint } from './session.mjs';
import { checkPasswordPolicy } from './passwords.mjs';
import { sendMail, mailerConfig } from './mailer.mjs';
import { newDeviceEmail, passwordChangedEmail } from './templates.mjs';

export const ROLES = { USER: 'USER', PREMIUM: 'PREMIUM', ADMIN: 'ADMIN', OWNER: 'OWNER' };
const ADMIN_ROLES = new Set([ROLES.ADMIN, ROLES.OWNER]);
const REFRESH_MARGIN_MS = 60 * 1000;

export class AuthError extends Error {
  constructor(message, { status = 400, code = 'AUTH_ERROR', details = null, retryAfterSeconds = null } = {}) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

const EMAIL_PATTERN = /^[^\s@,;:<>"[\]\\]+@[^\s@.,;:<>"[\]\\]+(\.[^\s@.,;:<>"[\]\\]+)+$/;
export function isValidEmail(email) {
  const clean = normalizeEmail(email);
  return clean.length >= 6 && clean.length <= 254 && EMAIL_PATTERN.test(clean);
}

export function maskEmailAddress(email = '') {
  const [name = '', domain = ''] = String(email).split('@');
  if (!domain) return '';
  const shown = name.length <= 2 ? name.slice(0, 1) : name.slice(0, 2);
  return `${shown}${'•'.repeat(Math.max(2, Math.min(6, name.length - shown.length)))}@${domain}`;
}

// Translate GoTrue failures into messages a person can act on, without
// confirming whether an address is registered.
function translate(error) {
  if (!(error instanceof SupabaseError)) return error;
  const raw = String(error.message || '').toLowerCase();
  const code = String(error.code || '').toLowerCase();

  if (code === 'supabase_unconfigured') {
    return new AuthError(
      'Accounts are not available yet — this deployment has no Supabase credentials configured.',
      { status: 503, code: 'AUTH_UNCONFIGURED' },
    );
  }
  if (raw.includes('email not confirmed') || code === 'email_not_confirmed') {
    return new AuthError('Confirm your email to finish signing in.', { status: 403, code: 'EMAIL_UNVERIFIED' });
  }
  if (raw.includes('invalid login credentials') || code === 'invalid_credentials') {
    return new AuthError('That email or password is not correct.', { status: 401, code: 'CREDENTIALS_INVALID' });
  }
  if (raw.includes('token has expired') || raw.includes('expired')) {
    return new AuthError('That code expired. Request a new one.', { status: 400, code: 'CODE_EXPIRED' });
  }
  if (raw.includes('invalid') && (raw.includes('token') || raw.includes('otp'))) {
    return new AuthError('That code is not correct.', { status: 400, code: 'CODE_INVALID' });
  }
  if (error.status === 429 || code === 'over_email_send_rate_limit' || raw.includes('rate limit')) {
    return new AuthError(
      'Too many email requests. Wait a minute and try again.',
      { status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 60 },
    );
  }
  if (raw.includes('password') && raw.includes('should be')) {
    return new AuthError(error.message, { status: 400, code: 'PASSWORD_WEAK' });
  }
  if (raw.includes('user already registered') || code === 'user_already_exists') {
    return new AuthError('That account already exists.', { status: 409, code: 'ALREADY_REGISTERED' });
  }
  return new AuthError(error.message || 'Authentication failed.', { status: error.status || 400, code: error.code || 'AUTH_ERROR' });
}

function sessionEnvelope(payload, { user, device } = {}) {
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + (Number(payload.expires_in || 3600) * 1000),
    userId: user?.id || payload.user?.id || null,
    device: device || null,
    issuedAt: Date.now(),
  };
}

async function deliver(to, message) {
  try { await sendMail({ to, ...message }); return true; }
  catch (error) { console.error('[auth mail error]', error?.message || error); return false; }
}

// --- profile ---------------------------------------------------------------

export async function loadProfile(accessToken, userId) {
  const { rows } = await from('users', { accessToken })
    .select('id,email,display_name,role,created_at,updated_at', { filters: { id: `eq.${userId}` }, limit: 1 });
  return rows[0] || null;
}

export async function loadSubscription(accessToken, userId) {
  const { rows } = await from('subscriptions', { accessToken })
    .select('tier,status,current_period_end,provider', { filters: { user_id: `eq.${userId}` }, limit: 1 });
  return rows[0] || null;
}

export function publicUser(profile, authUser, subscription) {
  if (!profile && !authUser) return null;
  const role = profile?.role || ROLES.USER;
  const email = profile?.email || authUser?.email || '';
  return {
    id: profile?.id || authUser?.id,
    email,
    maskedEmail: maskEmailAddress(email),
    displayName: profile?.display_name || '',
    role,
    isAdmin: ADMIN_ROLES.has(role),
    isOwner: role === ROLES.OWNER,
    emailVerified: Boolean(authUser?.email_confirmed_at || authUser?.confirmed_at),
    createdAt: profile?.created_at || authUser?.created_at || null,
    lastSignInAt: authUser?.last_sign_in_at || null,
    subscription: subscription
      ? {
        tier: subscription.tier,
        status: subscription.status,
        currentPeriodEnd: subscription.current_period_end,
        provider: subscription.provider,
        active: subscription.status === 'active' || subscription.status === 'trialing',
      }
      : { tier: 'free', status: 'inactive', active: false },
  };
}

// --- registration ----------------------------------------------------------

export async function registerAccount({ email, password, displayName } = {}) {
  const cleanEmail = normalizeEmail(email);
  const cleanName = String(displayName || '').trim().slice(0, 80);
  if (!isValidEmail(cleanEmail)) throw new AuthError('Enter a valid email address.', { status: 400, code: 'EMAIL_INVALID' });

  const policy = checkPasswordPolicy(password, { email: cleanEmail, displayName: cleanName });
  if (!policy.ok) throw new AuthError(policy.issues[0], { status: 400, code: 'PASSWORD_WEAK', details: policy.issues });

  try {
    const result = await auth.signUp({
      email: cleanEmail,
      password: String(password),
      data: cleanName ? { display_name: cleanName } : {},
    });

    // GoTrue returns a session immediately when email confirmation is disabled.
    if (result?.access_token) {
      return { ok: true, status: 'active', autoConfirmed: true, raw: result, email: cleanEmail };
    }
    return {
      ok: true,
      status: 'verification_sent',
      email: cleanEmail,
      maskedEmail: maskEmailAddress(cleanEmail),
      autoConfirmed: false,
    };
  } catch (error) {
    const translated = translate(error);
    // Never confirm that an address is taken — Supabase already returns the
    // same "confirmation sent" shape for a repeat sign-up when configured to.
    if (translated.code === 'ALREADY_REGISTERED') {
      return {
        ok: true,
        status: 'verification_sent',
        email: cleanEmail,
        maskedEmail: maskEmailAddress(cleanEmail),
        autoConfirmed: false,
      };
    }
    throw translated;
  }
}

export async function resendCode({ email, type = 'signup' } = {}) {
  const cleanEmail = normalizeEmail(email);
  if (!isValidEmail(cleanEmail)) throw new AuthError('Enter a valid email address.', { status: 400, code: 'EMAIL_INVALID' });
  try {
    await auth.resend({ email: cleanEmail, type });
  } catch (error) {
    const translated = translate(error);
    if (translated.code === 'RATE_LIMITED') throw translated;
    // Anything else is swallowed so a probe cannot tell registered from not.
  }
  return { ok: true, maskedEmail: maskEmailAddress(cleanEmail) };
}

export async function verifyEmail({ email, code, ip, userAgent } = {}) {
  const cleanEmail = normalizeEmail(email);
  const token = String(code ?? '').replace(/\D/g, '');
  if (!isValidEmail(cleanEmail)) throw new AuthError('Enter a valid email address.', { status: 400, code: 'EMAIL_INVALID' });
  if (!token) throw new AuthError('Enter the code from your email.', { status: 400, code: 'CODE_INVALID' });

  let payload;
  try {
    payload = await auth.verifyOtp({ email: cleanEmail, token, type: 'signup' });
  } catch (error) {
    // A confirmed address that is signing in again uses the magic-link type.
    try { payload = await auth.verifyOtp({ email: cleanEmail, token, type: 'email' }); }
    catch { throw translate(error); }
  }

  const envelope = sessionEnvelope(payload, { device: deviceFingerprint({ ip, userAgent }) });
  const profile = await loadProfile(envelope.accessToken, payload.user?.id).catch(() => null);
  const subscription = await loadSubscription(envelope.accessToken, payload.user?.id).catch(() => null);
  return {
    ok: true,
    envelope,
    cookie: await sealSession(envelope),
    user: publicUser(profile, payload.user, subscription),
  };
}

// --- sign in ---------------------------------------------------------------

export async function login({ email, password, ip, userAgent } = {}) {
  const cleanEmail = normalizeEmail(email);
  if (!isValidEmail(cleanEmail) || !password) {
    throw new AuthError('That email or password is not correct.', { status: 401, code: 'CREDENTIALS_INVALID' });
  }

  let payload;
  try {
    payload = await auth.signInWithPassword({ email: cleanEmail, password: String(password) });
  } catch (error) {
    const translated = translate(error);
    if (translated.code === 'EMAIL_UNVERIFIED') {
      await resendCode({ email: cleanEmail }).catch(() => {});
      throw new AuthError('Confirm your email to finish signing in. We sent you a new code.', {
        status: 403, code: 'EMAIL_UNVERIFIED',
      });
    }
    throw translated;
  }

  const device = deviceFingerprint({ ip, userAgent });
  const envelope = sessionEnvelope(payload, { device });
  const profile = await loadProfile(envelope.accessToken, payload.user?.id).catch(() => null);
  const subscription = await loadSubscription(envelope.accessToken, payload.user?.id).catch(() => null);
  const user = publicUser(profile, payload.user, subscription);

  // Supabase does not send new-device alerts; this deployment does.
  if (String(process.env.AUTH_ALERT_NEW_DEVICE || 'true').toLowerCase() !== 'false') {
    const seen = String(payload.user?.user_metadata?.known_devices || '').split(',').filter(Boolean);
    if (!seen.includes(device)) {
      await auth.updateUser(envelope.accessToken, {
        data: { known_devices: [device, ...seen].slice(0, 12).join(',') },
      }).catch(() => {});
      if (seen.length) {
        await deliver(user.email, newDeviceEmail({
          displayName: user.displayName, ip, userAgent, at: new Date().toUTCString(),
        }));
      }
    }
  }

  return { ok: true, envelope, cookie: await sealSession(envelope), user };
}

export async function logout(envelope) {
  if (envelope?.accessToken) await auth.signOut(envelope.accessToken);
  return { ok: true };
}

// --- recovery --------------------------------------------------------------

export async function forgotPassword({ email } = {}) {
  const cleanEmail = normalizeEmail(email);
  if (!isValidEmail(cleanEmail)) throw new AuthError('Enter a valid email address.', { status: 400, code: 'EMAIL_INVALID' });
  try {
    await auth.requestPasswordReset({ email: cleanEmail });
  } catch (error) {
    const translated = translate(error);
    if (translated.code === 'RATE_LIMITED') throw translated;
  }
  // Always the same answer, registered or not.
  return { ok: true, maskedEmail: maskEmailAddress(cleanEmail) };
}

export async function resetPassword({ email, code, password, ip, userAgent } = {}) {
  const cleanEmail = normalizeEmail(email);
  const token = String(code ?? '').replace(/\D/g, '');
  if (!isValidEmail(cleanEmail)) throw new AuthError('Enter a valid email address.', { status: 400, code: 'EMAIL_INVALID' });

  const policy = checkPasswordPolicy(password, { email: cleanEmail });
  if (!policy.ok) throw new AuthError(policy.issues[0], { status: 400, code: 'PASSWORD_WEAK', details: policy.issues });

  let payload;
  try { payload = await auth.verifyOtp({ email: cleanEmail, token, type: 'recovery' }); }
  catch (error) { throw translate(error); }

  const envelope = sessionEnvelope(payload, { device: deviceFingerprint({ ip, userAgent }) });
  try { await auth.updateUser(envelope.accessToken, { password: String(password) }); }
  catch (error) { throw translate(error); }

  const profile = await loadProfile(envelope.accessToken, payload.user?.id).catch(() => null);
  const subscription = await loadSubscription(envelope.accessToken, payload.user?.id).catch(() => null);
  const user = publicUser(profile, payload.user, subscription);
  await deliver(user.email, passwordChangedEmail({ displayName: user.displayName, at: new Date().toUTCString() }));

  return { ok: true, envelope, cookie: await sealSession(envelope), user };
}

export async function changePassword({ envelope, currentPassword, password, email } = {}) {
  const policy = checkPasswordPolicy(password, { email });
  if (!policy.ok) throw new AuthError(policy.issues[0], { status: 400, code: 'PASSWORD_WEAK', details: policy.issues });

  // Re-authenticate before accepting a change, so a stolen cookie alone is not enough.
  try { await auth.signInWithPassword({ email: normalizeEmail(email), password: String(currentPassword ?? '') }); }
  catch { throw new AuthError('Your current password is not correct.', { status: 401, code: 'CREDENTIALS_INVALID' }); }

  try { await auth.updateUser(envelope.accessToken, { password: String(password) }); }
  catch (error) { throw translate(error); }

  await deliver(email, passwordChangedEmail({ displayName: '', at: new Date().toUTCString() }));
  return { ok: true };
}

export async function updateProfile({ envelope, userId, displayName } = {}) {
  const name = String(displayName || '').trim().slice(0, 80);
  await from('users', { accessToken: envelope.accessToken })
    .update({ display_name: name, updated_at: new Date().toISOString() }, { filters: { id: `eq.${userId}` } });
  await auth.updateUser(envelope.accessToken, { data: { display_name: name } }).catch(() => {});
  return { ok: true, displayName: name };
}

// --- session resolution ----------------------------------------------------

// Returns { envelope, user, refreshed } or null. Refreshes the Supabase token
// transparently so a signed-in browser is never bounced mid-session.
export async function resolveSession(cookieValue) {
  const envelope = await openSession(cookieValue);
  if (!envelope?.accessToken) return null;

  let active = envelope;
  let refreshed = false;

  if (envelope.expiresAt - Date.now() < REFRESH_MARGIN_MS) {
    if (!envelope.refreshToken) return null;
    try {
      const payload = await auth.refresh(envelope.refreshToken);
      active = { ...sessionEnvelope(payload), device: envelope.device };
      refreshed = true;
    } catch { return null; }
  }

  let authUser;
  try { authUser = await auth.getUser(active.accessToken); }
  catch { return null; }
  if (!authUser?.id) return null;

  const profile = await loadProfile(active.accessToken, authUser.id).catch(() => null);
  const subscription = await loadSubscription(active.accessToken, authUser.id).catch(() => null);

  return {
    envelope: active,
    refreshed,
    cookie: refreshed ? await sealSession(active) : null,
    authUser,
    user: publicUser(profile, authUser, subscription),
  };
}

export function authStatus() {
  const supabase = supabaseConfig();
  const mailer = mailerConfig();
  return {
    provider: 'supabase',
    configured: supabase.configured,
    adminConfigured: supabase.adminConfigured,
    alertsConfigured: mailer.configured,
  };
}

export { ADMIN_ROLES };
