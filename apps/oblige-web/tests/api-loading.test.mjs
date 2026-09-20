import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compile = name => ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const apiUrl = `data:text/javascript;base64,${Buffer.from(compile('api')).toString('base64')}`;
const { getJson, fetchResearch } = await import(apiUrl);
const workspaceJs = compile('workspace').replace("'./api'", JSON.stringify(apiUrl));
const { workspaceGet, WorkspaceError } = await import(`data:text/javascript;base64,${Buffer.from(workspaceJs).toString('base64')}`);

test('successful GET retains same-origin credentials and disables transport caching', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async (path, init) => {
    assert.equal(path, '/api/test');
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.cache, 'no-store');
    return Response.json({ available: true, gameLog: [] });
  });
  assert.equal((await getJson('/api/test')).available, true);
  assert.equal(fetch.mock.callCount(), 1);
});

test('a deadline covers a body stalled after successful headers and retries only once', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async (_, { signal }) => new Response(new ReadableStream({
    start(controller) {
      signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
    },
  })));
  await assert.rejects(getJson('/api/test', undefined, 10), { code: 'TIMEOUT' });
  assert.equal(fetch.mock.callCount(), 2);
});

test('a transient network error is retried once', async t => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    if (++count === 1) throw new TypeError('Network unavailable');
    return Response.json({ ok: true });
  });
  assert.deepEqual(await getJson('/api/test'), { ok: true });
  assert.equal(count, 2);
});

test('non-JSON gateway errors preserve retryable HTTP status', async t => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => ++count === 1
    ? new Response('<html>gateway timeout</html>', { status: 504, headers: { 'retry-after': '0' } })
    : Response.json({ ok: true }));
  assert.deepEqual(await getJson('/api/test'), { ok: true });
  assert.equal(count, 2);
});

test('malformed successful JSON never becomes successful empty research', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('<html>not JSON</html>'));
  await assert.rejects(getJson('/api/test'), { code: 'INVALID_RESPONSE' });
  assert.equal(fetch.mock.callCount(), 2);
});

test('auth and client errors are not retried', async t => {
  for (const status of [400, 401, 403, 404]) {
    const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ message: 'Denied', code: 'DENIED' }, { status }));
    await assert.rejects(getJson('/api/test'), { status, code: 'DENIED' });
    assert.equal(fetch.mock.callCount(), 1);
    fetch.mock.restore();
  }
});

test('caller cancellation interrupts body loading without retrying', async t => {
  const parent = new AbortController();
  const fetch = t.mock.method(globalThis, 'fetch', async (_, { signal }) => new Response(new ReadableStream({
    start(controller) {
      signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
      setTimeout(() => parent.abort(), 5);
    },
  })));
  await assert.rejects(getJson('/api/test', parent.signal), { code: 'ABORTED' });
  assert.equal(fetch.mock.callCount(), 1);
});

test('cancellation during Retry-After prevents a second request', async t => {
  const parent = new AbortController();
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    setTimeout(() => parent.abort(), 5);
    return Response.json({}, { status: 429, headers: { 'retry-after': '5' } });
  });
  await assert.rejects(getJson('/api/test', parent.signal), { code: 'ABORTED' });
  assert.equal(fetch.mock.callCount(), 1);
});

test('unavailable history is not cached and successful verified results are reused', async t => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => Response.json(++count === 1
    ? { available: false, message: 'Provider unavailable' }
    : { available: true, gameLog: [] }));
  const group = { sport: 'NFL', player: 'Test player', market: 'Passing yards', line: 200.5 };
  assert.equal((await fetchResearch(group, 'OVER')).available, false);
  assert.equal((await fetchResearch(group, 'OVER')).available, true);
  await fetchResearch(group, 'OVER');
  assert.equal(count, 2);
});

test('workspace retains auth errors and distinguishes cancelled requests', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ message: 'Sign in' }, { status: 401 }));
  await assert.rejects(workspaceGet('history'), e => e instanceof WorkspaceError && e.status === 401);
  assert.equal(fetch.mock.callCount(), 1);
  await assert.rejects(workspaceGet('history', {}, AbortSignal.abort()), { name: 'AbortError' });
  assert.equal(fetch.mock.callCount(), 1);
});

test('workspace unavailable results remain unavailable; semantic failures are not retried', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: false, message: 'No exact identity' }));
  await assert.rejects(workspaceGet('history'), { message: 'No exact identity' });
  assert.equal(fetch.mock.callCount(), 1);
});
