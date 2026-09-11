// Subscription entitlements.
//
// This is the seam a payment processor plugs into later. No processor is wired
// yet, so every account resolves to the free plan and nothing here invents a
// paid state. When Stripe or PayPal is added, its webhook is the ONLY thing
// that may call `grantPlan()` — a client can never assert its own plan, because
// a client-asserted subscription is just a free subscription with extra steps.
//
// Entitlements live beside accounts in DATA_DIR so a restart does not wipe
// them, and every write is atomic for the same reason `lib/auth/store.mjs` is.

import fs from 'node:fs/promises';
import path from 'node:path';

const DATA = path.resolve(process.env.DATA_DIR || './data');
const FILE = path.join(DATA, 'entitlements.json');

export const PLANS = Object.freeze({
  free: {
    id: 'free',
    name: 'Free',
    // What a signed-out or unpaid visitor gets. Deliberately generous on the
    // measured research, because that is the product's honest core, and tight
    // on the paid model calls, because those cost money per request.
    predictionsPerDay: 3,
    askPerDay: 5,
    staleLineAlerts: false,
    slipSize: 5,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    predictionsPerDay: 100,
    askPerDay: 200,
    staleLineAlerts: true,
    slipSize: 50,
  },
});

export const DEFAULT_PLAN = 'free';

const text = (value) => String(value ?? '').trim();
let cache = null;

async function readAll() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(await fs.readFile(FILE, 'utf8'));
    cache = parsed && typeof parsed === 'object' && parsed.accounts ? parsed.accounts : {};
  } catch {
    // A missing file is an empty ledger, not an error: nobody has paid yet.
    cache = {};
  }
  return cache;
}

async function writeAll(accounts) {
  cache = accounts;
  await fs.mkdir(DATA, { recursive: true });
  const temp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify({ version: 1, accounts }, null, 2), 'utf8');
  await fs.rename(temp, FILE);
}

function planFor(record, now) {
  if (!record) return PLANS[DEFAULT_PLAN];
  const expires = Date.parse(record.expiresAt || '');
  // An expired subscription is a free account. There is no grace period here
  // because inventing one would hand out paid access nobody paid for.
  if (Number.isFinite(expires) && expires <= now) return PLANS[DEFAULT_PLAN];
  return PLANS[record.plan] || PLANS[DEFAULT_PLAN];
}

/**
 * The plan an account is actually entitled to right now.
 *
 * Unknown account, no record, or an expired one all resolve to free. The
 * caller gets a plan object either way and never has to guard for null.
 */
export async function entitlementFor(accountId, { now = Date.now() } = {}) {
  const id = text(accountId);
  if (!id) return { accountId: null, plan: PLANS[DEFAULT_PLAN], record: null, signedIn: false };
  const accounts = await readAll();
  const record = accounts[id] || null;
  return { accountId: id, plan: planFor(record, now), record, signedIn: true };
}

/**
 * Record a plan against an account. Webhook-only by construction.
 *
 * `source` names what authorised it, so an entitlement can always be traced to
 * a processor event rather than appearing from nowhere. Callers that cannot
 * name a source are rejected.
 */
export async function grantPlan({ accountId, plan, expiresAt = null, source, reference = null } = {}) {
  const id = text(accountId);
  const planId = text(plan);
  const origin = text(source);
  if (!id) throw Object.assign(new Error('An account id is required.'), { code: 'ENTITLEMENT_NO_ACCOUNT' });
  if (!PLANS[planId]) throw Object.assign(new Error('Unknown plan.'), { code: 'ENTITLEMENT_UNKNOWN_PLAN' });
  if (!origin) throw Object.assign(new Error('A source is required.'), { code: 'ENTITLEMENT_NO_SOURCE' });

  const accounts = { ...(await readAll()) };
  accounts[id] = {
    plan: planId,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    source: origin.slice(0, 40),
    reference: reference ? text(reference).slice(0, 120) : null,
    updatedAt: new Date().toISOString(),
  };
  await writeAll(accounts);
  return accounts[id];
}

/** Drop an account back to free — a cancellation, refund or chargeback. */
export async function revokePlan({ accountId, source } = {}) {
  const id = text(accountId);
  if (!id) throw Object.assign(new Error('An account id is required.'), { code: 'ENTITLEMENT_NO_ACCOUNT' });
  const accounts = { ...(await readAll()) };
  if (!accounts[id]) return null;
  accounts[id] = {
    ...accounts[id],
    plan: DEFAULT_PLAN,
    expiresAt: null,
    source: text(source).slice(0, 40) || 'revoked',
    updatedAt: new Date().toISOString(),
  };
  await writeAll(accounts);
  return accounts[id];
}

/** Public shape for the client. Never exposes source or reference. */
export function publicEntitlement(entitlement) {
  const plan = entitlement?.plan || PLANS[DEFAULT_PLAN];
  return {
    plan: plan.id,
    planName: plan.name,
    signedIn: Boolean(entitlement?.signedIn),
    limits: {
      predictionsPerDay: plan.predictionsPerDay,
      askPerDay: plan.askPerDay,
      slipSize: plan.slipSize,
      staleLineAlerts: plan.staleLineAlerts,
    },
    expiresAt: entitlement?.record?.expiresAt || null,
  };
}

/** Test seam: drop the in-process cache so a fresh read hits disk. */
export function resetEntitlementCache() {
  cache = null;
}
