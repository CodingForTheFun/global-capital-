// Account capabilities, role boundaries, and the navigation each role may see.
//
// Security rule: the owner is pinned to ACCOUNT_OWNER_EMAIL in production.
// A stale `owner` value in users.json is not enough to pass an owner-only route.
// Support workers get a separate, intentionally narrow capability set.

export const ROLES = Object.freeze({
  OWNER: 'owner',
  SUPPORT: 'support',
  MEMBER: 'member',
});

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function productionLike() {
  return String(process.env.NODE_ENV || '').toLowerCase() === 'production'
    || Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_PROJECT_ID);
}

export function configuredOwnerEmail() {
  return normalizeEmail(process.env.ACCOUNT_OWNER_EMAIL || '');
}

/**
 * The production owner boundary is email-pinned, not role-string-pinned.
 * This also repairs older installs where the designated account was stored as
 * a member: the configured address is still the owner. Conversely, an old
 * account carrying role=owner is NOT owner if its address is not designated.
 *
 * Local/test installs without ACCOUNT_OWNER_EMAIL retain the legacy role
 * fallback for developer ergonomics. Production fails closed without it.
 */
export function isOwner(user) {
  if (!user) return false;
  const designated = configuredOwnerEmail();
  if (designated) return normalizeEmail(user.email) === designated;
  if (productionLike()) return false;
  return user.role === ROLES.OWNER;
}

export function isSupport(user) {
  return Boolean(user) && (isOwner(user) || user.role === ROLES.SUPPORT);
}

/**
 * Convert either a stored role string or a complete account into the role that
 * authorization should actually use. Passing the whole user is important in
 * production because the designated owner can still have a legacy `member`
 * value in persisted account storage.
 */
export function effectiveRole(subject) {
  if (!subject) return null;
  if (typeof subject === 'string') {
    if (subject === ROLES.OWNER) return ROLES.OWNER;
    if (subject === ROLES.SUPPORT) return ROLES.SUPPORT;
    return ROLES.MEMBER;
  }
  if (isOwner(subject)) return ROLES.OWNER;
  if (subject.role === ROLES.SUPPORT) return ROLES.SUPPORT;
  return ROLES.MEMBER;
}

export function capabilitiesFor(subject) {
  const role = effectiveRole(subject);
  const owner = role === ROLES.OWNER;
  const support = owner || role === ROLES.SUPPORT;
  return {
    role: role ?? null,
    // Everyone signed in.
    viewProps: Boolean(role),
    viewAutoFinder: Boolean(role),
    viewPropDetail: Boolean(role),
    saveProps: Boolean(role),
    manageOwnAccount: Boolean(role),
    // Staff support. Support can inspect customer status and revoke customer
    // sessions, but cannot change roles, billing, entitlements, or bans.
    viewSupportConsole: support,
    viewCustomerSupport: support,
    revokeCustomerSessions: support,
    // Owner only.
    viewOwnerConsole: owner,
    viewMembers: owner,
    viewPresence: owner,
    revokeSessions: owner,
    disableAccounts: owner,
    promoteAccounts: owner,
    manageAccessTime: owner,
    viewProviderDiagnostics: owner,
    manageConnection: owner,
    changeRules: owner,
    generateAccessCodes: owner,
    viewAuditLog: owner,
    runScan: owner,
  };
}

/**
 * Navigation is role-filtered. Customer/member accounts never receive staff
 * items. `/owner` and `/support` are independently protected again server-side.
 */
export const NAV = Object.freeze([
  { id: 'props', label: 'All Props', href: '/props', capability: 'viewProps' },
  { id: 'finder', label: 'Auto Finder', href: '/props?view=finder', capability: 'viewAutoFinder' },
  { id: 'live', label: 'Live', href: '/live', capability: 'viewProps' },
  { id: 'saved', label: 'Saved', href: '/saved', capability: 'saveProps' },
  { id: 'support', label: 'Support', href: '/support', capability: 'viewSupportConsole', staffOnly: true },
  { id: 'members', label: 'Members', href: '/owner#members', capability: 'viewMembers', ownerOnly: true },
  { id: 'presence', label: 'Who’s Online', href: '/owner#presence', capability: 'viewPresence', ownerOnly: true },
  { id: 'providers', label: 'Owner Console', href: '/owner#system', capability: 'viewProviderDiagnostics', ownerOnly: true },
  { id: 'settings', label: 'Settings', href: '/settings', capability: 'manageOwnAccount' },
]);

export function navFor(subject) {
  const capabilities = capabilitiesFor(subject);
  return NAV
    .filter((item) => capabilities[item.capability] === true)
    .map(({ id, label, href, ownerOnly, staffOnly }) => ({
      id, label, href, ownerOnly: ownerOnly === true, staffOnly: staffOnly === true,
    }));
}

export function can(subject, capability) {
  return capabilitiesFor(subject)[capability] === true;
}

export function requireOwner(user) {
  if (!user) return { status: 401, body: { ok: false, code: 'AUTH_REQUIRED', message: 'Sign in to continue.' } };
  if (!isOwner(user)) return { status: 403, body: { ok: false, code: 'OWNER_REQUIRED', message: 'Owner access is required for this.' } };
  return null;
}

export function requireSupport(user) {
  if (!user) return { status: 401, body: { ok: false, code: 'AUTH_REQUIRED', message: 'Sign in to continue.' } };
  if (!isSupport(user)) return { status: 403, body: { ok: false, code: 'SUPPORT_REQUIRED', message: 'Support access is required for this.' } };
  return null;
}
