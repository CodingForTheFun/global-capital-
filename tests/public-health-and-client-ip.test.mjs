import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publicHealth, HEALTH_PATHS } from '../lib/web/public-health.mjs';
import { clientIp, clientKey } from '../lib/session.mjs';

const operatorReport = {
  ok: true,
  service: 'autoscout-apex',
  revision: '36f19f5622f240acfda51069584ca5521ce7d60f',
  startedAt: '2026-09-26T11:13:30.536Z',
  time: '2026-09-26T12:09:46.361Z',
  supportedSports: ['NFL', 'NBA'],
  providerMode: 'Odds provider B',
  sportradarTrials: { configured: true, tested: 20 },
  sportsGameOddsSupplement: { policy: { monthly: { max: 100000, used: 10521, remaining: 89479 } }, provider: { tier: 'rookie', lastNotice: 'Upgrade your API key' } },
  proplineSupplement: { policy: { tier: 'streaming-lite', reserve: 25000 } },
  provider: { id: 'public-feed-database', configured: true },
  storage: { usedPct: 63, totalMB: 433.3 },
};

test('public health keeps only what uptime checks read', () => {
  assert.deepEqual(publicHealth(operatorReport), {
    ok: true,
    service: 'autoscout-apex',
    revision: '36f19f5622f240acfda51069584ca5521ce7d60f',
    startedAt: '2026-09-26T11:13:30.536Z',
    time: '2026-09-26T12:09:46.361Z',
    provider: { configured: true },
  });
  const text = JSON.stringify(publicHealth(operatorReport));
  for (const leak of ['sportradar', 'monthly', 'rookie', 'Upgrade', 'streaming-lite', 'public-feed-database', 'usedPct']) {
    assert.ok(!text.includes(leak), leak + ' must not be public');
  }
  assert.equal(publicHealth({ ok: true, app: 'apex-market-lab-v3', providerMode: 'x' }).service, 'apex-market-lab-v3');
  assert.deepEqual(publicHealth(null), { ok: false });
  assert.equal(publicHealth({ ok: 'yes' }).ok, false);
  assert.equal(publicHealth({ ok: true, revision: 'not a sha; <script>' }).revision, undefined);
});

test('every health path is reduced unless the owner asks', () => {
  for (const path of ['/api/health', '/api/apex/health', '/api/apex-next/health']) assert.ok(HEALTH_PATHS.has(path));
  const source = readFileSync(new URL('../frontdoor-prod.mjs', import.meta.url), 'utf8');
  assert.match(source, /dst\.publicHealth = !isOwner\(user\)/);
  assert.match(source, /dst\.publicHealth \? publicHealth\(parsed\) : sanitizePublicPayload\(parsed\)/);
  assert.match(source, /if \(dst\.publicHealth\) body = JSON\.stringify\(\{ ok: false \}\)/);
});

test('rate limits key on the edge-set client address, not a client-chosen header', () => {
  const spoofed = { headers: { 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }, socket: { remoteAddress: '10.0.0.2' } };
  assert.equal(clientIp(spoofed), '203.0.113.9');
  assert.equal(clientKey(spoofed, 'login'), 'login:203.0.113.9');
  const rotated = { ...spoofed, headers: { ...spoofed.headers, 'x-forwarded-for': '9.9.9.9' } };
  assert.equal(clientKey(rotated, 'login'), clientKey(spoofed, 'login'));
  assert.equal(clientIp({ headers: { 'x-real-ip': '2001:db8::1' } }), '2001:db8::1');
  assert.equal(clientIp({ headers: { 'x-real-ip': 'evil value', 'x-forwarded-for': '5.6.7.8' } }), '5.6.7.8');
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }), '127.0.0.1');
  assert.equal(clientIp({ headers: {} }), null);
});

test('no production rate limiter reads X-Forwarded-For directly any more', () => {
  for (const file of ['frontdoor-prod.mjs', 'lib/auth/routes.mjs', 'lib/auth/google-routes.mjs', 'lib/auth/owner-recovery-routes.mjs', 'lib/ml/routes.mjs']) {
    const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    assert.ok(!/x-forwarded-for/i.test(source), file + ' reads X-Forwarded-For directly');
  }
});

test('only the data core gets the larger heap, and the patched spawn line is unchanged', () => {
  const source = readFileSync(new URL('../frontdoor-prod.mjs', import.meta.url), 'utf8');
  assert.match(source, /label === 'Auto Scout data core' \? \[`--max-old-space-size=\$\{heapMb\}`, file\] : \[file\]/);
  assert.match(source, /Math\.min\(16384, Math\.max\(4096, Number\(process\.env\.AUTOSCOUT_CORE_HEAP_MB\) \|\| 8192\)\)/);
  // frontdoor-clearsports rewrites this exact line at boot; it must not move.
  assert.ok(source.includes("const apex = child('apex-v2/server-core.mjs', APEX_PORT, 'Auto Scout data core');"));
});
