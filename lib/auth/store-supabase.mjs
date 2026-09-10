// Supabase-backed account storage.
//
// Identity lives in auth.users, so every account has a real id that
// public.users, subscriptions, favorites, alerts and saved_props can key off.
// The file backend could not do this: its ids existed only in users.json, so
// every one of those foreign keys was unusable.
//
// Responsibilities are split deliberately:
//   auth.users          identity registry (created via the GoTrue admin API)
//   public.users        profile and role, provisioned by the handle_new_user trigger
//   public.account_state credentials and auth-service state (RLS on, no policies)
//
// Credential verification stays in this app's auth service, so there is one
// password hash in one place. Moving verification into GoTrue is a later step
// and would replace account_state.password_hash rather than duplicate it.

import { newUser, publicUser, normalizeEmail, roleFromDatabase, roleToDatabase } from './user-shape.mjs';

const text = (value) => String(value ?? '').trim();
const SUPABASE_URL = () => text(process.env.AUTOSCOUT_SUPABASE_URL || process.env.SUPABASE_URL).replace(/\/$/, '');
const SERVICE_KEY = () => text(process.env.AUTOSCOUT_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

/** True when this backend has everything it needs to be authoritative. */
export function supabaseStoreConfigured() {
  return Boolean(SUPABASE_URL() && SERVICE_KEY());
}

function unavailable(message, cause) {
  return Object.assign(new Error(message), { code: 'AUTH_STORE_UNAVAILABLE', cause });
}

// Columns on account_state, keyed by the field name the auth service uses.
const STATE_COLUMNS = Object.freeze({
  passwordHash: 'password_hash',
  emailVerified: 'email_verified',
  sessionVersion: 'session_version',
  failedAttempts: 'failed_attempts',
  lockedUntil: 'locked_until',
  disabled: 'disabled',
  pendingCodes: 'pending_codes',
  lastLoginAt: 'last_login_at',
  lastLoginIp: 'last_login_ip',
});

export function createSupabaseStore({ fetchImpl } = {}) {
  const doFetch = (...args) => (fetchImpl || fetch)(...args);

  function headers(extra = {}) {
    const key = SERVICE_KEY();
    return {
      accept: 'application/json',
      'content-type': 'application/json',
      apikey: key,
      authorization: `Bearer ${key}`,
      ...extra,
    };
  }

  async function call(path, { method = 'GET', body, prefer } = {}) {
    if (!supabaseStoreConfigured()) throw unavailable('Supabase account storage is not configured.');
    let response;
    try {
      response = await doFetch(`${SUPABASE_URL()}${path}`, {
        method,
        headers: headers(prefer ? { prefer } : {}),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      // A network failure must never look like "no such account".
      throw unavailable('The account database is unreachable.', error);
    }
    const raw = await response.text();
    let payload = null;
    if (raw) { try { payload = JSON.parse(raw); } catch { payload = null; } }
    if (!response.ok) {
      throw unavailable(`Account database request failed with HTTP ${response.status}.`, payload);
    }
    return { payload, response };
  }

  /** Combine a profile row and its account_state row into the account shape. */
  function compose(profile, state) {
    if (!profile) return null;
    const base = newUser({
      id: profile.id,
      email: profile.email,
      passwordHash: state?.password_hash ?? null,
      role: roleFromDatabase(profile.role),
      emailVerified: state?.email_verified === true,
      createdAt: profile.created_at,
    });
    return {
      ...base,
      updatedAt: state?.updated_at || profile.updated_at || base.updatedAt,
      sessionVersion: Number(state?.session_version ?? 1),
      lastLoginAt: state?.last_login_at ?? null,
      lastLoginIp: state?.last_login_ip ?? null,
      failedAttempts: Number(state?.failed_attempts ?? 0),
      lockedUntil: state?.locked_until ?? null,
      disabled: state?.disabled === true,
      pendingCodes: state?.pending_codes && typeof state.pending_codes === 'object' ? state.pending_codes : {},
    };
  }

  async function stateFor(userId) {
    const { payload } = await call(`/rest/v1/account_state?select=*&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
    return Array.isArray(payload) ? payload[0] ?? null : null;
  }

  async function profileBy(column, value) {
    const query = `/rest/v1/users?select=id,email,role,created_at,updated_at&${column}=eq.${encodeURIComponent(value)}&limit=1`;
    const { payload } = await call(query);
    return Array.isArray(payload) ? payload[0] ?? null : null;
  }

  async function hydrate(profile) {
    if (!profile) return null;
    return compose(profile, await stateFor(profile.id));
  }

  return {
    name: 'supabase',

    async findByEmail(email) {
      const normalized = normalizeEmail(email);
      if (!normalized) return null;
      return hydrate(await profileBy('email', normalized));
    },

    async findById(id) {
      if (!id) return null;
      return hydrate(await profileBy('id', String(id)));
    },

    async countUsers() {
      const { payload, response } = await call('/rest/v1/users?select=id', { prefer: 'count=exact' });
      const range = response.headers?.get?.('content-range');
      const total = range && range.includes('/') ? Number(range.split('/')[1]) : Number.NaN;
      if (Number.isFinite(total)) return total;
      return Array.isArray(payload) ? payload.length : 0;
    },

    async listUsers() {
      const { payload } = await call('/rest/v1/users?select=id,email,role,created_at,updated_at&order=created_at.asc');
      const profiles = Array.isArray(payload) ? payload : [];
      if (!profiles.length) return [];
      const { payload: states } = await call('/rest/v1/account_state?select=*');
      const byUser = new Map((Array.isArray(states) ? states : []).map((row) => [row.user_id, row]));
      return profiles.map((profile) => publicUser(compose(profile, byUser.get(profile.id))));
    },

    /**
     * Create an account.
     *
     * The GoTrue admin API mints the auth.users row; the handle_new_user
     * trigger provisions the profile, a free subscription and the state row.
     * Uniqueness is enforced by auth.users, so a duplicate address is reported
     * rather than creating a second identity.
     */
    async createUser({ email, passwordHash, role = 'member', emailVerified = false }) {
      const normalized = normalizeEmail(email);
      if (!normalized) throw Object.assign(new Error('Email is required.'), { code: 'AUTH_EMAIL_REQUIRED' });

      const existing = await profileBy('email', normalized);
      if (existing) return { created: false, user: await hydrate(existing) };

      let created;
      try {
        const { payload } = await call('/auth/v1/admin/users', {
          method: 'POST',
          body: {
            email: normalized,
            // This app verifies the address with its own emailed code, so the
            // identity starts unconfirmed and is confirmed by our flow.
            email_confirm: false,
            user_metadata: {},
          },
        });
        created = payload;
      } catch (error) {
        // Losing a race against a concurrent registration is not an error.
        const raced = await profileBy('email', normalized);
        if (raced) return { created: false, user: await hydrate(raced) };
        throw error;
      }

      const userId = created?.id;
      if (!userId) throw unavailable('The account database did not return a user id.');

      // The trigger assigns OWNER to the first account; the auth service is
      // authoritative for the role it asked for, so reconcile explicitly.
      await call(`/rest/v1/users?id=eq.${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        body: { role: roleToDatabase(role), updated_at: new Date().toISOString() },
        prefer: 'return=minimal',
      });

      await call(`/rest/v1/account_state?user_id=eq.${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        body: {
          password_hash: passwordHash ?? null,
          email_verified: emailVerified === true,
          updated_at: new Date().toISOString(),
        },
        prefer: 'return=minimal',
      });

      const user = await this.findById(userId);
      if (!user) throw unavailable('The account was created but could not be read back.');
      return { created: true, user };
    },

    /** Apply a mutation to one user, writing only the fields it changed. */
    async updateUser(id, mutate) {
      const current = await this.findById(id);
      if (!current) return null;

      const patch = mutate(current) || {};
      const statePatch = {};
      for (const [field, column] of Object.entries(STATE_COLUMNS)) {
        if (Object.prototype.hasOwnProperty.call(patch, field)) statePatch[column] = patch[field];
      }

      if (Object.keys(statePatch).length) {
        statePatch.updated_at = new Date().toISOString();
        await call(`/rest/v1/account_state?user_id=eq.${encodeURIComponent(current.id)}`, {
          method: 'PATCH', body: statePatch, prefer: 'return=minimal',
        });
      }

      const profilePatch = {};
      if (Object.prototype.hasOwnProperty.call(patch, 'role')) profilePatch.role = roleToDatabase(patch.role);
      if (Object.prototype.hasOwnProperty.call(patch, 'email')) profilePatch.email = normalizeEmail(patch.email);
      if (Object.keys(profilePatch).length) {
        profilePatch.updated_at = new Date().toISOString();
        await call(`/rest/v1/users?id=eq.${encodeURIComponent(current.id)}`, {
          method: 'PATCH', body: profilePatch, prefer: 'return=minimal',
        });
      }

      return { ...current, ...patch, updatedAt: new Date().toISOString() };
    },

    /** Invalidate every session for this user by bumping the version. */
    async revokeSessions(id) {
      return this.updateUser(id, (user) => ({ sessionVersion: Number(user.sessionVersion || 1) + 1 }));
    },

    /** Deliberately refuses: this backend points at a real database. */
    async _reset() {
      throw Object.assign(
        new Error('Refusing to wipe accounts: the Supabase backend is not a test fixture.'),
        { code: 'AUTH_STORE_RESET_REFUSED' },
      );
    },
  };
}
