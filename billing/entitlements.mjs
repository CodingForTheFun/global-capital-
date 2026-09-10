// What each tier may actually do. The server checks these; the UI only mirrors
// them. Role and subscription tier are separate axes: an ADMIN always has full
// product access, a paying USER gets PREMIUM features without admin powers.

export const TIERS = {
  free: {
    key: 'free',
    name: 'Free',
    price: null,
    features: {
      fullScan: true,
      focusedScan: true,
      lineHistory: false,
      lineHistoryHours: 0,
      alerts: false,
      savedSlips: 3,
      scansPerDay: 3,
    },
  },
  pro: {
    key: 'pro',
    name: 'Pro',
    price: process.env.PAYPAL_PRICE_USD || null,
    features: {
      fullScan: true,
      focusedScan: true,
      lineHistory: true,
      lineHistoryHours: 168,
      alerts: true,
      savedSlips: 100,
      scansPerDay: 50,
    },
  },
};

const ACTIVE_STATUSES = new Set(['active', 'trialing']);

export function resolveTier(user) {
  if (!user) return TIERS.free;
  // Admins and owners are never gated out of the product they operate.
  if (user.isAdmin) return TIERS.pro;
  if (user.role === 'PREMIUM') return TIERS.pro;

  const subscription = user.subscription;
  if (subscription && ACTIVE_STATUSES.has(subscription.status)) {
    const notExpired = !subscription.currentPeriodEnd
      || new Date(subscription.currentPeriodEnd).getTime() > Date.now();
    if (notExpired) return TIERS[subscription.tier] || TIERS.pro;
  }
  return TIERS.free;
}

export function entitlements(user) {
  const tier = resolveTier(user);
  return {
    tier: tier.key,
    tierName: tier.name,
    features: { ...tier.features },
    isAdmin: Boolean(user?.isAdmin),
    isOwner: Boolean(user?.isOwner),
  };
}

export function can(user, feature) {
  return Boolean(resolveTier(user).features[feature]);
}

export class UpgradeRequired extends Error {
  constructor(feature, tier) {
    super(`${feature} requires a Pro subscription.`);
    this.name = 'UpgradeRequired';
    this.status = 402;
    this.code = 'UPGRADE_REQUIRED';
    this.feature = feature;
    this.currentTier = tier;
  }
}

export function requireFeature(user, feature) {
  const tier = resolveTier(user);
  if (!tier.features[feature]) throw new UpgradeRequired(feature, tier.key);
  return tier;
}

// Per-user daily scan budget, held in memory. Resets at midnight UTC.
const scanCounters = new Map();

export function consumeScan(user) {
  const tier = resolveTier(user);
  const limit = tier.features.scansPerDay;
  const day = new Date().toISOString().slice(0, 10);
  const key = `${user?.id || 'anonymous'}:${day}`;

  for (const existing of scanCounters.keys()) {
    if (!existing.endsWith(day)) scanCounters.delete(existing);
  }

  const used = scanCounters.get(key) || 0;
  if (used >= limit) {
    return { allowed: false, used, limit, tier: tier.key, resetsAt: `${day}T24:00:00Z` };
  }
  scanCounters.set(key, used + 1);
  return { allowed: true, used: used + 1, limit, tier: tier.key };
}

export function scanUsage(user) {
  const tier = resolveTier(user);
  const day = new Date().toISOString().slice(0, 10);
  return {
    used: scanCounters.get(`${user?.id || 'anonymous'}:${day}`) || 0,
    limit: tier.features.scansPerDay,
    tier: tier.key,
  };
}
