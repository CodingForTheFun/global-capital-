import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { decodeAvatarDataUrl, sniffAvatarType } from '../lib/auth/avatar-routes.mjs';
import { patchProfileAvatarFrontdoor } from '../lib/auth/avatar-runtime-patch.mjs';
import { patchProfileAvatarUi } from '../lib/auth/avatar-ui-runtime-patch.mjs';

test('avatar uploads accept only bounded raster image types with matching magic bytes', () => {
  const webp = Buffer.from('RIFFxxxxWEBP', 'ascii');
  const decoded = decodeAvatarDataUrl(`data:image/webp;base64,${webp.toString('base64')}`);
  assert.equal(decoded.contentType, 'image/webp');
  assert.deepEqual(decoded.bytes, webp);
  assert.equal(sniffAvatarType(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0])), 'image/png');
  assert.equal(sniffAvatarType(Buffer.from([0xff,0xd8,0xff,0,0,0,0,0,0,0,0,0])), 'image/jpeg');
});

test('avatar validation rejects SVG, malformed base64, mismatched types and oversized images', () => {
  assert.throws(() => decodeAvatarDataUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='), /JPEG, PNG, or WebP/);
  assert.throws(() => decodeAvatarDataUrl('data:image/png;base64,not_base64!!'), /JPEG, PNG, or WebP/);
  const webp = Buffer.from('RIFFxxxxWEBP', 'ascii').toString('base64');
  assert.throws(() => decodeAvatarDataUrl(`data:image/png;base64,${webp}`), /do not match/);
  const tooLarge = Buffer.alloc(512 * 1024 + 1, 0x41);
  tooLarge.write('RIFF', 0, 'ascii');
  tooLarge.write('WEBP', 8, 'ascii');
  assert.throws(() => decodeAvatarDataUrl(`data:image/webp;base64,${tooLarge.toString('base64')}`), /512 KB/);
});

test('production frontdoor patch mounts the private avatar route before generic account routes', async () => {
  const source = await fs.readFile(new URL('../frontdoor-prod.mjs', import.meta.url), 'utf8');
  const patched = patchProfileAvatarFrontdoor(source);
  assert.match(patched, /handleProfileAvatarRoute/);
  assert.ok(patched.indexOf('handleProfileAvatarRoute(req, res, url') < patched.indexOf('handleAccountRoutes(req, res, url'));
  assert.equal(patchProfileAvatarFrontdoor(patched), patched, 'frontdoor patch is idempotent');
});

test('profile UI patch replaces the text account button with an avatar and upload controls', async () => {
  const source = await fs.readFile(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  const patched = patchProfileAvatarUi(source);
  assert.match(patched, /asProfileAvatarImg/);
  assert.match(patched, /Change profile photo/);
  assert.match(patched, /\/api\/account\/avatar/);
  assert.match(patched, /image\/webp/);
  assert.doesNotMatch(patched, /https?:\/\/[^'"`\s]+.*avatar/i, 'avatar UI must not depend on a third-party image host');
  assert.doesNotThrow(() => new Function(patched));
  assert.equal(patchProfileAvatarUi(patched), patched, 'UI patch is idempotent');
});
