import test from 'node:test';
import assert from 'node:assert/strict';

import { createSupabaseStore, supabaseStoreConfigured } from '../lib/auth/store-supabase.mjs';
import { roleFromDatabase, roleToDatabase } from '../lib/auth/user-shape.mjs';

const URL_ENV = 'https://project.supabase.co';

function withEnv(fn) {
  const before = {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    aUrl: process.env.AUTOSCOUT_SUPABASE_URL,
    aKey: process.env.AUTOSCOUT_SUPABASE_SERVICE_ROLE_KEY,
  };
  process.env.SUPABASE_URL = URL_ENV;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  delete process.env.AUTOSCOUT_SUPABASE_URL;
  delete process.env.AUTOSCOUT_SUPABASE_SERVICE_ROLE_KEY;
  return (async () => {
    try { return await fn(); } finally {
      for (const [name, value] of [
        ['SUPABASE_URL', before.url], ['SUPABASE_SERVICE_ROLE_KEY', before.key],
        ['AUTOSCOUT_SUPABASE_URL', before.aUrl], ['AUTOSCOUT_SUPABASE_SERVICE_ROLE_KEY', before.aKey],
      ]) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
  })();
}

/** A fake PostgREST + GoTrue admin surface backed by in-memory rows. */
function fakeSupabase({ profiles = [], states = [], failWith = null } = {}) {
  const calls = [];
  const json = (body, headers = {}) => ({
    ok: true, status: 200,
    text: async () => JSON.stringify(body),
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  });

  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (failWith) throw failWith;
    const target = String(url);
    const method = options.method || 'GET';

    if (target.includes('/auth/v1/admin/users') && method === 'POST') {
      const body = JSON.parse(options.body);
      const id = `id-${profiles.length + 1}`;
      // Mirror the handle_new_user trigger: profile + state appear together.
      profiles.push({ id, email: body.email, role: profiles.length === 0 ? 'OWNER' : 'USER', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' });
      states.push({ user_id: id, password_hash: null, email_verified: false, session_version: 1, failed_attempts: 0, locked_until: null, disabled: false, pending_codes: {}, last_login_at: null, last_login_ip: null });
      return json({ id, email: body.email });
    }

    if (target.includes('/rest/v1/users')) {
      if (method === 'PATCH') {
        const id = decodeURIComponent(target.split('id=eq.')[1] || '');
        const row = profiles.find((p) => p.id === id);
        if (row) Object.assign(row, JSON.parse(options.body));
        return json([]);
      }
      if (target.includes('email=eq.')) {
        const email = decodeURIComponent(target.split('email=eq.')[1].split('&')[0]);
        return json(profiles.filter((p) => p.email === email));
      }
      if (target.includes('id=eq.')) {
        const id = decodeURIComponent(target.split('id=eq.')[1].split('&')[0]);
        return json(profiles.filter((p) => p.id === id));
      }
      return json(profiles, { 'content-range': `0-${profiles.length}/${profiles.length}` });
    }

    if (target.includes('/rest/v1/account_state')) {
      if (method === 'PATCH') {
        const id = decodeURIComponent(target.split('user_id=eq.')[1] || '');
        const row = states.find((s) => s.user_id === id);
        if (row) Object.assign(row, JSON.parse(options.body));
        return json([]);
      }
      if (target.includes('user_id=eq.')) {
        const id = decodeURIComponent(target.split('user_id=eq.')[1].split('&')[0]);
        return json(states.filter((s) => s.user_id === id));
      }
      return json(states);
    }
    throw new Error(`unexpected request: ${method} ${target}`);
  };

  return { fetchImpl, calls, profiles, states };
}

test('the supabase backend is only configured when url and service key are both present', async () => {
  const before = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.equal(supabaseStoreConfigured(), false);
  process.env.SUPABASE_URL = URL_ENV;
  assert.equal(supabaseStoreConfigured(), false, 'a url alone is not enough');
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  assert.equal(supabaseStoreConfigured(), true);
  if (before.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = before.url;
  if (before.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = before.key;
});

test('creating an account mints an auth.users identity, not a local id', () => withEnv(async () => {
  const fake = fakeSupabase();
  const store = createSupabaseStore({ fetchImpl: fake.fetchImpl });

  const { created, user } = await store.createUser({ email: 'Owner@Example.com', passwordHash: 'scrypt$abc', role: 'owner' });
  assert.equal(created, true);
  assert.equal(user.email, 'owner@example.com', 'email is normalised before storage');

  const adminCall = fake.calls.find((c) => c.url.includes('/auth/v1/admin/users'));
  assert.ok(adminCall, 'identity must be created through the GoTrue admin API');
  assert.equal(adminCall.body.email_confirm, false, 'this app confirms the address with its own code');
  assert.equal(user.id, fake.profiles[0].id, 'the account id is the auth.users id');
}));

test('the password hash lands in account_state, never in the profile row', () => withEnv(async () => {
  const fake = fakeSupabase();
  const store = createSupabaseStore({ fetchImpl: fake.fetchImpl });
  await store.createUser({ email: 'a@example.com', passwordHash: 'scrypt$secret', role: 'member' });

  assert.equal(fake.states[0].password_hash, 'scrypt$secret');
  assert.ok(!('password_hash' in fake.profiles[0]), 'the profile row must not carry credentials');
  const profilePatch = fake.calls.find((c) => c.url.includes('/rest/v1/users') && c.method === 'PATCH');
  assert.ok(!JSON.stringify(profilePatch.body).includes('secret'), 'no credential may be written to public.users');
}));

test('a duplicate address returns the existing account instead of a second identity', () => withEnv(async () => {
  const fake = fakeSupabase();
  const store = createSupabaseStore({ fetchImpl: fake.fetchImpl });
  await store.createUser({ email: 'dup@example.com', passwordHash: 'h1' });
  const second = await store.createUser({ email: 'dup@example.com', passwordHash: 'h2' });

  assert.equal(second.created, false);
  assert.equal(fake.profiles.length, 1, 'exactly one identity');
  const adminCalls = fake.calls.filter((c) => c.url.includes('/auth/v1/admin/users'));
  assert.equal(adminCalls.length, 1, 'the admin API is not called twice');
}));

test('findByEmail composes the profile and state rows into one account', () => withEnv(async () => {
  const fake = fakeSupabase({
    profiles: [{ id: 'u1', email: 'x@example.com', role: 'OWNER', created_at: '2026-01-01T00:00:00Z' }],
    states: [{
      user_id: 'u1', password_hash: 'scrypt$x', email_verified: true, session_version: 4,
      failed_attempts: 2, locked_until: null, disabled: false,
      pending_codes: { verify_email: { hash: 'h' } }, last_login_at: '2026-02-02T00:00:00Z', last_login_ip: '1.2.3.4',
    }],
  });
  const store = createSupabaseStore({ fetchImpl: fake.fetchImpl });
  const user = await store.findByEmail('X@Example.com');

  assert.equal(user.id, 'u1');
  assert.equal(user.role, 'owner', 'OWNER maps to the product owner role');
  assert.equal(user.emailVerified, true);
  assert.equal(user.sessionVersion, 4);
  assert.equal(user.failedAttempts, 2);
  assert.equal(user.passwordHash, 'scrypt$x');
  assert.deepEqual(user.pendingCodes, { verify_email: { hash: 'h' } });
}));

test('updateUser writes only the columns the mutation changed', () => withEnv(async () => {
  const fake = fakeSupabase({
    profiles: [{ id: 'u1', email: 'x@example.com', role: 'USER', created_at: '2026-01-01T00:00:00Z' }],
    states: [{ user_id: 'u1', session_version: 1, failed_attempts: 0, pending_codes: {}, email_verified: false }],
  });
  const store = createSupabaseStore({ fetchImpl: fake.fetchImpl });
  await store.updateUser('u1', () => ({ failedAttempts: 3, lockedUntil: '2026-03-03T00:00:00Z' }));

  const patch = fake.calls.find((c) => c.url.includes('account_state') && c.method === 'PATCH');
  assert.deepEqual(Object.keys(patch.body).sort(), ['failed_attempts', 'locked_until', 'updated_at']);
  assert.equal(fake.states[0].failed_attempts, 3);
  assert.ok(!fake.calls.some((c) => c.url.includes('/rest/v1/users') && c.method === 'PATCH'), 'the profile is untouched');
}));

test('revoking sessions bumps the version the session cookie is checked against', () => withEnv(async () => {
  const fake = fakeSupabase({
    profiles: [{ id: 'u1', email: 'x@example.com', role: 'USER', created_at: '2026-01-01T00:00:00Z' }],
    states: [{ user_id: 'u1', session_version: 7, pending_codes: {} }],
  });
  const store = createSupabaseStore({ fetchImpl: fake.fetchImpl });
  await store.revokeSessions('u1');
  assert.equal(fake.states[0].session_version, 8);
}));

test('a database outage fails closed rather than looking like a missing account', () => withEnv(async () => {
  const fake = fakeSupabase({ failWith: new Error('ECONNREFUSED') });
  const store = createSupabaseStore({ fetchImpl: fake.fetchImpl });
  await assert.rejects(
    () => store.findByEmail('x@example.com'),
    (error) => {
      assert.equal(error.code, 'AUTH_STORE_UNAVAILABLE');
      return true;
    },
  );
}));

test('the supabase backend refuses to be wiped like a test fixture', () => withEnv(async () => {
  const store = createSupabaseStore({ fetchImpl: fakeSupabase().fetchImpl });
  await assert.rejects(() => store._reset(), (error) => error.code === 'AUTH_STORE_RESET_REFUSED');
}));

test('database roles map onto the two product capability levels', () => {
  assert.equal(roleFromDatabase('OWNER'), 'owner');
  assert.equal(roleFromDatabase('ADMIN'), 'owner');
  assert.equal(roleFromDatabase('PREMIUM'), 'member');
  assert.equal(roleFromDatabase('USER'), 'member');
  assert.equal(roleToDatabase('owner'), 'OWNER');
  assert.equal(roleToDatabase('member'), 'USER');
  assert.equal(roleToDatabase('member', { premium: true }), 'PREMIUM');
});
