import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// access-codes.mjs resolves DATA_DIR at import time, so point it at a temp
// directory before the dynamic import below. The real Railway volume is untouched.
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoprop-codes-'));
process.env.DATA_DIR = dataDir;
process.env.DASHBOARD_SESSION_SECRET = 'test-pepper-value-not-a-real-secret';

const codes = await import('../access-codes.mjs');
const storeFile = path.join(dataDir, 'access-codes.json');

async function storedRows() {
  return JSON.parse(await fs.readFile(storeFile, 'utf8'));
}

test('a generated code is returned exactly once and never persisted in the clear', async () => {
  const created = await codes.generateAccessCode({ label: 'Friend access', expiresInDays: 30, maxUses: 5 });
  assert.match(created.code, /^AP-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  const raw = await fs.readFile(storeFile, 'utf8');
  assert.ok(!raw.includes(created.code), 'the plaintext code must never touch disk');

  const [row] = await storedRows();
  assert.ok(row.codeHash && row.codeHash !== created.code);
  assert.equal(row.codeHash.length, 64, 'stored as a hex digest');

  // The listing the owner sees carries a hint, never the code or its hash.
  const [listed] = await codes.listAccessCodes();
  assert.equal(listed.codeHash, undefined);
  assert.equal(listed.hint, `••••-${created.code.slice(-4)}`);
  assert.ok(!JSON.stringify(listed).includes(created.code));
});

test('a valid code redeems as a member and never as an owner', async () => {
  const created = await codes.generateAccessCode({ label: 'Friend', maxUses: 2 });
  const redeemed = await codes.redeemAccessCode(created.code);
  assert.ok(redeemed);
  assert.equal(redeemed.role, 'member');
  assert.equal(redeemed.uses, 1);
  // Nothing in the redemption result can be mistaken for owner authority.
  const serialised = JSON.stringify(redeemed);
  assert.ok(!/owner/i.test(serialised), 'a member code must not carry owner wording or flags');
  assert.equal(redeemed.codeHash, undefined);
});

test('redemption is case- and whitespace-insensitive but format-checked', async () => {
  const created = await codes.generateAccessCode({ maxUses: 5 });
  assert.ok(await codes.redeemAccessCode(`  ${created.code.toLowerCase()}  `));
  assert.equal(await codes.redeemAccessCode('not-a-code'), null);
  assert.equal(await codes.redeemAccessCode(''), null);
  assert.equal(await codes.redeemAccessCode(null), null);
  assert.equal(await codes.redeemAccessCode('AP-XXXX-XXXX-XXXX'), null, 'well-formed but unknown');
});

test('a code stops working once its uses are spent', async () => {
  const created = await codes.generateAccessCode({ maxUses: 1 });
  assert.ok(await codes.redeemAccessCode(created.code));
  assert.equal(await codes.redeemAccessCode(created.code), null, 'second redemption must fail');
});

test('an expired code cannot be redeemed', async () => {
  const created = await codes.generateAccessCode({ maxUses: 5 });
  const rows = await storedRows();
  rows.find((row) => row.id === created.id).expiresAt = new Date(Date.now() - 1000).toISOString();
  await fs.writeFile(storeFile, JSON.stringify(rows));
  codes.invalidateAccessCodeCache();
  assert.equal(await codes.redeemAccessCode(created.code), null);
  assert.equal(await codes.isAccessCodeActive(created.id), false);
});

test('revoking a code blocks new redemptions and ends live member sessions', async () => {
  const created = await codes.generateAccessCode({ maxUses: 5 });
  assert.ok(await codes.redeemAccessCode(created.code));
  assert.equal(await codes.isAccessCodeActive(created.id), true);

  const revoked = await codes.revokeAccessCode(created.id);
  assert.equal(revoked.active, false);

  assert.equal(await codes.redeemAccessCode(created.code), null, 'revoked code cannot unlock again');
  // The 30-day session cookie is re-checked against this on every request, so a
  // revoke ends an already-open member session rather than waiting for expiry.
  assert.equal(await codes.isAccessCodeActive(created.id), false);
});

test('isAccessCodeActive rejects unknown and empty subjects', async () => {
  assert.equal(await codes.isAccessCodeActive('not-a-real-id'), false);
  assert.equal(await codes.isAccessCodeActive(''), false);
  assert.equal(await codes.isAccessCodeActive(null), false);
  assert.equal(await codes.isAccessCodeActive(undefined), false);
});

test('generation clamps caller-supplied limits', async () => {
  const huge = await codes.generateAccessCode({ expiresInDays: 9999, maxUses: 9999 });
  assert.equal(huge.maxUses, 20);
  const days = (Date.parse(huge.expiresAt) - Date.parse(huge.createdAt)) / 86_400_000;
  assert.ok(days <= 90.1, `expiry clamped to 90 days, got ${days}`);

  const tiny = await codes.generateAccessCode({ expiresInDays: -5, maxUses: 0 });
  assert.equal(tiny.maxUses, 5, 'invalid maxUses falls back to the default');
  assert.ok(Date.parse(tiny.expiresAt) > Date.now());
});

test('generated codes are unique and drawn from an unambiguous alphabet', async () => {
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const { code } = await codes.generateAccessCode({ maxUses: 1 });
    assert.ok(!seen.has(code), 'duplicate code generated');
    seen.add(code);
    assert.ok(!/[01IO]/.test(code), 'ambiguous characters excluded');
  }
});

test.after(async () => { await fs.rm(dataDir, { recursive: true, force: true }); });
