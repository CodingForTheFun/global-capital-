import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ROLES, isOwner, isSupport, requireOwner, requireSupport, capabilitiesFor, navFor,
} from '../lib/auth/permissions.mjs';

function withEnv(values, run) {
  const before = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value == null) delete process.env[key]; else process.env[key] = value;
  }
  try { return run(); }
  finally {
    for (const [key, value] of Object.entries(before)) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test('production owner access is pinned to ACCOUNT_OWNER_EMAIL', () => {
  withEnv({ NODE_ENV:'production', ACCOUNT_OWNER_EMAIL:'owner@example.com', RAILWAY_PROJECT_ID:'project' }, () => {
    assert.equal(isOwner({ email:'owner@example.com', role:ROLES.MEMBER }), true);
    assert.equal(isOwner({ email:'other@example.com', role:ROLES.OWNER }), false);
    assert.equal(requireOwner({ email:'owner@example.com', role:ROLES.MEMBER }), null);
    assert.equal(requireOwner({ email:'other@example.com', role:ROLES.OWNER })?.status, 403);
  });
});

test('production owner access fails closed when no owner email is configured', () => {
  withEnv({ NODE_ENV:'production', ACCOUNT_OWNER_EMAIL:null, RAILWAY_PROJECT_ID:'project' }, () => {
    assert.equal(isOwner({ email:'first@example.com', role:ROLES.OWNER }), false);
  });
});

test('support role receives only support navigation and not owner capabilities', () => {
  const caps = capabilitiesFor(ROLES.SUPPORT);
  assert.equal(caps.viewSupportConsole, true);
  assert.equal(caps.revokeCustomerSessions, true);
  assert.equal(caps.viewOwnerConsole, false);
  assert.equal(caps.manageAccessTime, false);
  assert.equal(caps.promoteAccounts, false);
  const nav = navFor(ROLES.SUPPORT);
  assert.equal(nav.some((item) => item.href === '/support'), true);
  assert.equal(nav.some((item) => item.href.startsWith('/owner')), false);
});

test('owner is also allowed into support while members are not', () => {
  withEnv({ ACCOUNT_OWNER_EMAIL:'owner@example.com', NODE_ENV:'production', RAILWAY_PROJECT_ID:'project' }, () => {
    assert.equal(isSupport({ email:'owner@example.com', role:ROLES.MEMBER }), true);
    assert.equal(isSupport({ email:'worker@example.com', role:ROLES.SUPPORT }), true);
    assert.equal(isSupport({ email:'customer@example.com', role:ROLES.MEMBER }), false);
    assert.equal(requireSupport({ email:'customer@example.com', role:ROLES.MEMBER })?.status, 403);
  });
});

test('support route cannot mutate roles, entitlements, billing, or bans', () => {
  const source = readFileSync(new URL('../lib/auth/support-routes.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /updateUser\s*\(/);
  assert.doesNotMatch(source, /grantPlan\s*\(/);
  assert.doesNotMatch(source, /revokePlan\s*\(/);
  assert.doesNotMatch(source, /member\/role/);
  assert.doesNotMatch(source, /member\/disable/);
  assert.match(source, /\/api\/support\/session\/revoke/);
  assert.match(source, /appendAudit\s*\(/);
});

test('owner role endpoint can assign support/member but never browser-promote another owner', () => {
  const source = readFileSync(new URL('../lib/auth/admin-routes.mjs', import.meta.url), 'utf8');
  assert.match(source, /body\.role === ROLES\.SUPPORT \? ROLES\.SUPPORT : ROLES\.MEMBER/);
  assert.doesNotMatch(source, /body\.role === ROLES\.OWNER \? ROLES\.OWNER/);
  assert.match(source, /OWNER_PROTECTED/);
});

test('gateway hides owner and support assets behind separate server checks', () => {
  const source = readFileSync(new URL('../lib/edge/gateway.mjs', import.meta.url), 'utf8');
  assert.match(source, /if \(!isOwner\(user\)\) return hideStaffRoute/);
  assert.match(source, /if \(!isSupport\(user\)\) return hideStaffRoute/);
  assert.match(source, /'\/support\.js'/);
});

test('frontdoor wires support API and keeps owner/admin routes separate', () => {
  const source = readFileSync(new URL('../lib/edge/frontdoor-patch.mjs', import.meta.url), 'utf8');
  assert.match(source, /handleSupportRoutes/);
  assert.match(source, /handleAdminRoutes/);
  assert.match(source, /handleAdminAccessRoutes/);
});
