import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const stub = `data:text/javascript;base64,${Buffer.from('export class NextResponse extends Response { static next(){ return new NextResponse(null); } }').toString('base64')}`;
const js = ts.transpileModule(readFileSync(new URL('../proxy.ts', import.meta.url), 'utf8'), {
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022},
}).outputText.replace("'next/server'", JSON.stringify(stub));
const {proxy, config} = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const request = (path, method='GET') => ({nextUrl: {pathname: path}, method});
const original = process.env.RAILWAY_GIT_COMMIT_SHA;
test.afterEach(() => {
  if (original === undefined) delete process.env.RAILWAY_GIT_COMMIT_SHA;
  else process.env.RAILWAY_GIT_COMMIT_SHA = original;
});

test('board response identifies the exact runtime release without adding an API route', () => {
  process.env.RAILWAY_GIT_COMMIT_SHA = 'a'.repeat(40);
  assert.equal(proxy(request('/board')).headers.get('x-oblige-revision'), 'a'.repeat(40));
  assert.equal(proxy(request('/board', 'HEAD')).headers.get('x-oblige-revision'), 'a'.repeat(40));
  assert.deepEqual(config.matcher, ['/board', '/_next/static/chunks/static/chunks/:path*']);
});

test('no invented release identity, secret-like values, or unrelated API changes', () => {
  delete process.env.RAILWAY_GIT_COMMIT_SHA;
  assert.equal(proxy(request('/board')).headers.get('x-oblige-revision'), null);
  process.env.RAILWAY_GIT_COMMIT_SHA = 'not-a-revision';
  assert.equal(proxy(request('/board')).headers.get('x-oblige-revision'), null);
  process.env.RAILWAY_GIT_COMMIT_SHA = 'a'.repeat(40);
  assert.equal(proxy(request('/api/account/me')).headers.get('x-oblige-revision'), null);
});

test('duplicate chunk containment remains unchanged for GET and HEAD', async () => {
  process.env.RAILWAY_GIT_COMMIT_SHA = 'a'.repeat(40);
  for (const method of ['GET', 'HEAD']) {
    const response = proxy(request('/_next/static/chunks/static/chunks/test.js', method));
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('x-oblige-asset-guard'), 'duplicate-chunk-path');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), method === 'HEAD' ? '' : 'Not found\n');
  }
});
