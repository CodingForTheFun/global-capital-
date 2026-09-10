// User account storage.
//
// One account system, two storage backends, chosen once at startup:
//
//   Supabase  when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.
//             Identity lives in auth.users, so public.users, subscriptions,
//             favorites, alerts and saved_props finally have valid foreign
//             keys to key off.
//   File      otherwise. JSON under DATA_DIR, for local development, tests
//             and any deployment running without a database.
//
// Callers (service.mjs, routes.mjs, admin-routes.mjs) see the same interface
// either way, so there is no second auth implementation to keep in step.

import * as fileBackend from './store-file.mjs';
import { createSupabaseStore, supabaseStoreConfigured } from './store-supabase.mjs';

export { normalizeEmail, looksLikeEmail, publicUser } from './user-shape.mjs';

let backend = null;

function active() {
  if (!backend) backend = supabaseStoreConfigured() ? createSupabaseStore() : fileBackend;
  return backend;
}

/** Which backend is serving accounts. Surfaced in admin diagnostics. */
export function activeBackend() {
  return active().name;
}

export const findByEmail = (email) => active().findByEmail(email);
export const findById = (id) => active().findById(id);
export const countUsers = () => active().countUsers();
export const listUsers = () => active().listUsers();
export const createUser = (input) => active().createUser(input);
export const updateUser = (id, mutate) => active().updateUser(id, mutate);
export const revokeSessions = (id) => active().revokeSessions(id);

/** Test seam only. Re-resolves the backend so env changes take effect. */
export async function _reset() {
  const current = active();
  backend = null;
  await current._reset();
}

/** Test seam only: force a backend, bypassing environment detection. */
export function _setBackend(next) {
  backend = next;
}
