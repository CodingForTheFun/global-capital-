// Zero-dependency Supabase client: PostgREST for data, GoTrue for identity.
// Everything goes through fetch so the worker keeps its single runtime dependency.

const TIMEOUT_MS = Number(process.env.SUPABASE_TIMEOUT_MS || 15_000);

export function supabaseConfig() {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const anonKey = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return {
    url,
    anonKey,
    serviceKey,
    configured: Boolean(url && anonKey),
    // Admin-only surfaces (role changes, user listing) need the service role key.
    adminConfigured: Boolean(url && serviceKey),
  };
}

export class SupabaseError extends Error {
  constructor(message, { status = 500, code = 'SUPABASE_ERROR', details = null } = {}) {
    super(message);
    this.name = 'SupabaseError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function requireConfig() {
  const config = supabaseConfig();
  if (!config.configured) {
    throw new SupabaseError(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.',
      { status: 503, code: 'SUPABASE_UNCONFIGURED' },
    );
  }
  return config;
}

async function call(path, { method = 'GET', headers = {}, body, key, accessToken, raw = false } = {}) {
  const config = requireConfig();
  const apiKey = key || config.anonKey;
  const response = await fetch(`${config.url}${path}`, {
    method,
    headers: {
      apikey: apiKey,
      authorization: `Bearer ${accessToken || apiKey}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const text = await response.text();
  let payload = null;
  if (text) { try { payload = JSON.parse(text); } catch { payload = { raw: text }; } }

  if (!response.ok) {
    const message = payload?.msg || payload?.message || payload?.error_description
      || payload?.error || payload?.hint || `Supabase request failed (${response.status}).`;
    throw new SupabaseError(message, {
      status: response.status,
      code: payload?.error_code || payload?.code || 'SUPABASE_ERROR',
      details: payload,
    });
  }
  return raw ? { payload, headers: response.headers } : payload;
}

// --- GoTrue (identity) ----------------------------------------------------

export const auth = {
  signUp: ({ email, password, data }) =>
    call('/auth/v1/signup', { method: 'POST', body: { email, password, data } }),

  // type: 'signup' confirms a new address, 'recovery' completes a password reset,
  // 'email' confirms an OTP sign-in. All three return a session on success.
  verifyOtp: ({ email, token, type }) =>
    call('/auth/v1/verify', { method: 'POST', body: { email, token, type } }),

  signInWithPassword: ({ email, password }) =>
    call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } }),

  refresh: (refreshToken) =>
    call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: refreshToken } }),

  // Re-sends the signup confirmation code without creating a duplicate user.
  resend: ({ email, type = 'signup' }) =>
    call('/auth/v1/resend', { method: 'POST', body: { email, type } }),

  requestPasswordReset: ({ email, redirectTo }) =>
    call(`/auth/v1/recover${redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : ''}`, {
      method: 'POST', body: { email },
    }),

  getUser: (accessToken) => call('/auth/v1/user', { accessToken }),

  updateUser: (accessToken, body) => call('/auth/v1/user', { method: 'PUT', accessToken, body }),

  signOut: (accessToken) =>
    call('/auth/v1/logout', { method: 'POST', accessToken }).catch(() => null),
};

// --- GoTrue admin (service role only) ------------------------------------

export const adminAuth = {
  available: () => supabaseConfig().adminConfigured,

  listUsers: ({ page = 1, perPage = 50 } = {}) => {
    const config = supabaseConfig();
    return call(`/auth/v1/admin/users?page=${page}&per_page=${perPage}`, { key: config.serviceKey });
  },

  updateUser: (userId, body) => {
    const config = supabaseConfig();
    return call(`/auth/v1/admin/users/${userId}`, { method: 'PUT', key: config.serviceKey, body });
  },

  deleteUser: (userId) => {
    const config = supabaseConfig();
    return call(`/auth/v1/admin/users/${userId}`, { method: 'DELETE', key: config.serviceKey });
  },
};

// --- PostgREST (data) -----------------------------------------------------

function buildQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [field, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    search.append(field, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export function from(table, { accessToken, serviceRole = false } = {}) {
  const config = supabaseConfig();
  const key = serviceRole ? (config.serviceKey || config.anonKey) : config.anonKey;

  return {
    async select(columns = '*', { filters = {}, order, limit, offset, count } = {}) {
      const headers = {};
      if (count) headers.prefer = `count=${count}`;
      if (limit !== undefined) headers.range = `${offset || 0}-${(offset || 0) + limit - 1}`;
      const params = { select: columns, ...filters };
      if (order) params.order = order;
      const result = await call(`/rest/v1/${table}${buildQuery(params)}`, { key, accessToken, headers, raw: true });
      return { rows: result.payload || [], contentRange: result.headers.get('content-range') };
    },

    async insert(rows, { upsert = false, onConflict, returning = 'representation' } = {}) {
      const prefer = [`return=${returning}`];
      if (upsert) prefer.push('resolution=merge-duplicates');
      return call(`/rest/v1/${table}${onConflict ? `?on_conflict=${onConflict}` : ''}`, {
        method: 'POST',
        key,
        accessToken,
        headers: { prefer: prefer.join(',') },
        body: Array.isArray(rows) ? rows : [rows],
      });
    },

    async update(values, { filters = {}, returning = 'representation' } = {}) {
      return call(`/rest/v1/${table}${buildQuery(filters)}`, {
        method: 'PATCH',
        key,
        accessToken,
        headers: { prefer: `return=${returning}` },
        body: values,
      });
    },

    async remove({ filters = {} } = {}) {
      return call(`/rest/v1/${table}${buildQuery(filters)}`, { method: 'DELETE', key, accessToken });
    },
  };
}

export async function rpc(fn, args = {}, { accessToken, serviceRole = false } = {}) {
  const config = supabaseConfig();
  return call(`/rest/v1/rpc/${fn}`, {
    method: 'POST',
    key: serviceRole ? (config.serviceKey || config.anonKey) : config.anonKey,
    accessToken,
    body: args,
  });
}

// Cheap liveness probe used by the admin console diagnostics panel.
export async function healthCheck() {
  const config = supabaseConfig();
  if (!config.configured) return { ok: false, configured: false, message: 'SUPABASE_URL / SUPABASE_ANON_KEY are not set.' };
  const startedAt = Date.now();
  try {
    await call('/rest/v1/sports?select=key&limit=1', {});
    return { ok: true, configured: true, adminConfigured: config.adminConfigured, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      adminConfigured: config.adminConfigured,
      latencyMs: Date.now() - startedAt,
      message: error?.message || String(error),
    };
  }
}
