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
    // Owner only
    viewMembers: owner,
    viewPresence: owner,
    revokeSessions: owner,
    disableAccounts: owner,
    promoteAccounts: owner,
    viewProviderDiagnostics: owner,
    manageConnection: owner,
    changeRules: owner,
    generateAccessCodes: owner,
    viewAuditLog: owner,
    runScan: owner,
  };
}

/**
 * The tabs a role may see. `id` matches a client route; `capability` is the
 * permission that gates it, so the two can never drift.
 */
export const NAV = Object.freeze([
  { id: 'props', label: 'All Props', href: '/props', capability: 'viewProps' },
  { id: 'finder', label: 'Auto Finder', href: '/props?view=finder', capability: 'viewAutoFinder' },
  { id: 'live', label: 'Live', href: '/live', capability: 'viewProps' },
  { id: 'saved', label: 'Saved', href: '/saved', capability: 'saveProps' },
  { id: 'members', label: 'Members', href: '/admin/members', capability: 'viewMembers', ownerOnly: true },
  { id: 'presence', label: 'Who’s Online', href: '/admin/presence', capability: 'viewPresence', ownerOnly: true },
  { id: 'providers', label: 'Data Sources', href: '/admin/providers', capability: 'viewProviderDiagnostics', ownerOnly: true },
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
 *
 * A member asking for an owner route gets 403 rather than 404: they are
 * legitimately authenticated, and pretending the route does not exist would
 * only confuse a real user without hiding anything from an attacker who can
 * already read the client bundle.
 */
export function requireOwner(user) {
  if (!user) return { status: 401, body: { ok: false, code: 'AUTH_REQUIRED', message: 'Sign in to continue.' } };
  if (!isOwner(user)) return { status: 403, body: { ok: false, code: 'OWNER_REQUIRED', message: 'Owner access is required for this.' } };
  return null;
}
