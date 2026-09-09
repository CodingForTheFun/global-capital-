import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// server.mjs is what railway.json currently starts. It has a single owner
// identity and no member concept, so it must still tell the shared dashboard
// that an authenticated session may manage the connection and the rules —
// otherwise the frontend hides those controls and the dashboard regresses.

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OWNER_PASSWORD = 'server-mjs-test-password';
const PORT = 8000 + Math.floor(Math.random() * 4000);
const BASE = `http://127.0.0.1:${PORT}`;

let child;
let dataDir;
const stderr = [];

test.before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoprop-owner-'));
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, DASHBOARD_PASSWORD: OWNER_PASSWORD, AUTO_SCAN_MINUTES: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/auth/status`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`server.mjs did not start:\n${stderr.join('')}`);
});

test.after(async () => {
  child?.kill('SIGKILL');
  if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });
});

async function login() {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: OWNER_PASSWORD }),
  });
  const header = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie') || '';
  return { status: response.status, cookie: header.split(';')[0] };
}

test('an authenticated session on the single-owner server keeps every owner control', async () => {
  const { status, cookie } = await login();
  assert.equal(status, 200);

  const response = await fetch(`${BASE}/api/auth/status`, { headers: { cookie } });
  const data = await response.json();
  assert.equal(data.authenticated, true);
  assert.equal(data.role, 'owner');
  // These three drive the dashboard's Manage PickFinder and Rule Filters buttons.
  assert.equal(data.canManageConnection, true);
  assert.equal(data.canChangeRules, true);
  assert.equal(data.canGenerateAccessCodes, true);
});

test('a signed-out visitor is reported as holding no permissions', async () => {
  const data = await (await fetch(`${BASE}/api/auth/status`)).json();
  assert.equal(data.authenticated, false);
  assert.equal(data.canManageConnection, false);
  assert.equal(data.role, null);
  assert.equal(data.required, true);
});

test('the API stays closed and leaks nothing before login', async () => {
  const response = await fetch(`${BASE}/api/status`);
  assert.equal(response.status, 401);
  const body = JSON.stringify(await response.json());
  for (const marker of ['locator', 'Call log', 'playwright', 'node_modules', '.mjs:', '/app/']) {
    assert.ok(!body.includes(marker), `leaked: ${marker}`);
  }
});

test('malformed JSON is rejected without echoing the parser error', async () => {
  const { cookie } = await login();
  const response = await fetch(`${BASE}/api/rules`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: '{ this is not json',
  });
  const data = await response.json();
  assert.equal(response.status, 400);
  assert.equal(data.message, 'That request could not be processed.');
  assert.ok(!/JSON|token|position/i.test(data.message));
});

test('unlock attempts are rate limited on the deployed entry point too', async () => {
  let sawLimit = false;
  for (let attempt = 0; attempt < 15; attempt++) {
    const response = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-password' }),
    });
    if (response.status === 429) { sawLimit = true; break; }
  }
  assert.ok(sawLimit, 'brute-force attempts must be throttled');
});
