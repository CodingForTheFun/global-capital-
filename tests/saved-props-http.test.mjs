import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('deployed auth server protects saved props, persists them and enforces revocation', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoscout-saves-http-'));
  const port = 18000 + Math.floor(Math.random() * 2000);
  const base = `http://127.0.0.1:${port}`;
  const password = 'isolated-test-owner-password';
  const child = spawn(process.execPath, ['server-scout.mjs'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, DASHBOARD_PASSWORD: password,
      DASHBOARD_SESSION_SECRET: 'isolated-test-session-secret', AUTO_SCAN_MINUTES: '0', NODE_ENV: 'test' },
    stdio: 'ignore',
  });
  async function call(route, cookie, method = 'GET', body, origin) {
    return fetch(base + route, { method, headers: { ...(cookie ? { cookie } : {}),
      ...(origin ? { origin } : {}), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function login(credential) {
    const response = await call('/api/auth/login', null, 'POST', { accessCode: credential });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  }
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await call('/api/auth/status')).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'auth server starts');
    assert.equal((await call('/api/saved-props')).status, 401);
    const owner = await login(password);
    const generated = await (await call('/api/access-codes/generate', owner, 'POST', { label: 'Save isolation', maxUses: 5 })).json();
    const member = await login(generated.code);
    const prop = { key: 'test-prop', sport: 'NFL', playerName: 'Fixture player', market: 'Pass Yards',
      rows: [{ side: 'OVER', line: 0, price: null, isAlternate: false }] };
    assert.equal((await call('/api/saved-props', member, 'POST', prop, 'https://unrelated.example')).status, 403);
    assert.equal((await call('/api/saved-props', member, 'POST', prop, base)).status, 200);
    assert.equal((await (await call('/api/saved-props', owner)).json()).saved.length, 0);
    const secondSession = await login(generated.code);
    const saved = await (await call('/api/saved-props', secondSession)).json();
    assert.equal(saved.saved.length, 1);
    assert.equal(saved.saved[0].rows[0].line, 0);
    assert.equal(saved.saved[0].rows[0].price, null);
    assert.equal(saved.persistence, 'access-profile');
    assert.equal((await call('/api/saved-props', member, 'POST', { ...prop, rows: [{ side: 'OVER', line: 2, isAlternate: true }] })).status, 400);
    assert.equal((await call('/api/access-codes/revoke', owner, 'POST', { id: generated.id })).status, 200);
    assert.equal((await call('/api/saved-props', member)).status, 401);
    assert.equal((await call('/api/saved-props', secondSession, 'DELETE', { key: prop.key })).status, 401);
  } finally {
    const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
