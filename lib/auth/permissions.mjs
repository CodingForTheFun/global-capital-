// Account capabilities, and the navigation each role may see.
//
// One place decides what a role can do. Routes check the capability, and the
// UI renders tabs from the same object — so a tab can never appear without the
// backend permission behind it, and a permission can never exist with no way
// to reach it.
//
// Hiding a tab is presentation, not security. Every owner-only route checks
// requireOwner() server-side regardless of what the client rendered.

export const ROLES = Object.freeze({ OWNER: 'owner', MEMBER: 'member' });

export function capabilitiesFor(role) {
  const owner = role === ROLES.OWNER;
  return {
    role: role ?? null,
    // Everyone signed in
    viewProps: Boolean(role),
    viewAutoFinder: Boolean(role),
    viewPropDetail: Boolean(role),
    saveProps: Boolean(role),
    manageOwnAccount: Boolean(role),
    // Owner only. The owner console deliberately has no customer-facing nav
    // entry; these capabilities exist so the protected backend can enforce it.
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
 * Customer-visible navigation only. Owner tooling is intentionally excluded.
 * Owners reach the private console directly at /owner; non-owners receive 404.
 */
export const NAV = Object.freeze([
  { id: 'props', label: 'All Props', href: '/props', capability: 'viewProps' },
  { id: 'finder', label: 'Auto Finder', href: '/props?view=finder', capability: 'viewAutoFinder' },
  { id: 'live', label: 'Live', href: '/live', capability: 'viewProps' },
  { id: 'saved', label: 'Saved', href: '/saved', capability: 'saveProps' },
  { id: 'settings', label: 'Settings', href: '/settings', capability: 'manageOwnAccount' },
]);

/** Nav filtered to what this role may actually reach. */
export function navFor(role) {
  const capabilities = capabilitiesFor(role);
  return NAV
    .filter((item) => capabilities[item.capability] === true)
    .map(({ id, label, href, ownerOnly }) => ({ id, label, href, ownerOnly: ownerOnly === true }));
}

export function can(role, capability) {
  return capabilitiesFor(role)[capability] === true;
}

export function isOwner(user) {
  return user?.role === ROLES.OWNER;
}

/**
 * Guard for an owner-only route.
 * Returns null when allowed, or a {status, body} to send when not.
 */
export function requireOwner(user) {
  if (!user) return { status: 401, body: { ok: false, code: 'AUTH_REQUIRED', message: 'Sign in to continue.' } };
  if (!isOwner(user)) return { status: 403, body: { ok: false, code: 'OWNER_REQUIRED', message: 'Owner access is required for this.' } };
  return null;
}
