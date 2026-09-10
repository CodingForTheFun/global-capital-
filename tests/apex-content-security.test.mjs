import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('research HTML permits its own modules and stylesheet without enabling external sources', async () => {
  const port = 16000 + Math.floor(Math.random() * 10000);
  const child = spawn(process.execPath, ['apex-v2/server-core.mjs'], {
    cwd: new URL('../', import.meta.url),
    // No inherited provider credentials or production ingestion settings.
    env: { PATH: process.env.PATH, PORT: String(port), AUTOSCOUT_INGEST_ENABLED: 'false' },
    stdio: 'ignore',
  });
  const exited = once(child, 'exit');
  try {
    let response;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { response = await fetch(`http://127.0.0.1:${port}/apex-v2`); break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(response?.status, 200);
    const policy = new Map(response.headers.get('content-security-policy').split(';').map(part => {
      const [directive, ...sources] = part.trim().split(/\s+/);
      return [directive, sources];
    }));
    for (const directive of ['script-src', 'style-src']) {
      assert.ok(policy.get(directive).includes("'self'"), `${directive} must allow the research assets`);
      assert.ok(policy.get(directive).includes("'unsafe-inline'"), `${directive} must preserve the existing inline shell`);
      assert.ok(policy.get(directive).every(source => ["'self'", "'unsafe-inline'"].includes(source)));
    }
    assert.deepEqual(policy.get('frame-ancestors'), ["'none'"]);
    assert.deepEqual(policy.get('connect-src'), ["'self'"]);
    assert.deepEqual(policy.get('form-action'), ["'self'"]);
    assert.match(await response.text(), /<title>Auto Scout<\/title>/);
  } finally {
    child.kill('SIGKILL');
    await exited;
  }
});
