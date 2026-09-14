import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { installProcessGuards, describeFailure } from '../lib/web/process-guards.mjs';

function harness() {
  const proc = new EventEmitter();
  proc.exit = code => { proc.exited = code; };
  const logged = [];
  const logger = { error: (...args) => logged.push(args.join(' ')) };
  return { proc, logged, logger };
}

test('an unhandled rejection is logged and survived', () => {
  const { proc, logged, logger } = harness();
  installProcessGuards({ label: 'test', logger, proc });
  proc.emit('unhandledRejection', new Error('upstream timed out'));
  assert.equal(proc.exited, undefined, 'a background failure must not stop the process');
  assert.match(logged[0], /unhandled rejection \(continuing\)/);
  assert.match(logged[0], /upstream timed out/);
});

test('an uncaught exception stops the process', () => {
  const { proc, logged, logger } = harness();
  installProcessGuards({ label: 'test', logger, proc });
  proc.emit('uncaughtException', new Error('bad state'));
  assert.equal(proc.exited, 1, 'unknown state must not keep serving');
  assert.match(logged[0], /uncaught exception \(stopping\)/);
});

test('a supplied fatal handler replaces the bare exit', () => {
  const { proc, logger } = harness();
  let stopped = 0;
  installProcessGuards({ label: 'test', logger, proc, onFatal: () => { stopped++; } });
  proc.emit('uncaughtException', new Error('bad state'));
  assert.equal(stopped, 1, 'the graceful path must be used when given');
  assert.equal(proc.exited, undefined, 'and the abrupt exit skipped');
});

// Upstream errors quote the URL that failed, and those URLs carry API keys.
test('credentials are scrubbed out of logged failures', () => {
  const cases = [
    'fetch failed https://api.example.com/odds?apiKey=abcd1234efgh5678&sport=NFL',
    'request denied: authorization: Bearer abcd1234efgh5678ijkl',
    'bad key sk-liveABCDEFGH12345678',
    'Error: token="ghp_abcdefghijklmnop1234"',
    'https://x.test/v1?api_key=SECRETVALUE123&x=1',
  ];
  for (const raw of cases) {
    const safe = describeFailure(raw);
    assert.ok(safe.includes('[redacted]'), `nothing redacted in: ${safe}`);
    for (const secret of ['abcd1234efgh5678', 'SECRETVALUE123', 'ghp_abcdefghijklmnop1234', 'liveABCDEFGH12345678']) {
      assert.ok(!safe.includes(secret), `secret leaked: ${safe}`);
    }
  }
});

test('non-secret detail survives so the log is still diagnosable', () => {
  const safe = describeFailure(Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }));
  assert.match(safe, /connect ETIMEDOUT/);
  assert.match(safe, /ETIMEDOUT/);
});

test('any thrown value is described without throwing again', () => {
  for (const value of [null, undefined, 0, 'plain string', { a: 1 }, [1, 2], Symbol('x'), new Error('x')]) {
    const safe = describeFailure(value);
    assert.equal(typeof safe, 'string');
    assert.ok(safe.length > 0);
  }
  const circular = {}; circular.self = circular;
  assert.equal(typeof describeFailure(circular), 'string');
});

test('log lines stay bounded so one error cannot flood the logs', () => {
  assert.ok(describeFailure('x'.repeat(10_000)).length <= 401);
});

test('the guards can be removed again', () => {
  const { proc, logged, logger } = harness();
  const remove = installProcessGuards({ label: 'test', logger, proc });
  remove();
  assert.equal(proc.listenerCount('unhandledRejection'), 0);
  assert.equal(proc.listenerCount('uncaughtException'), 0);
  assert.equal(logged.length, 0);
});

// The point of the change: both long-running processes must install them.
test('both servers install the guards', () => {
  for (const file of ['../frontdoor-prod.mjs', '../apex-v2/server-core.mjs']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /installProcessGuards\(/, `${file} must install process guards`);
    assert.match(source, /onFatal:/, `${file} must stop through its own shutdown path`);
  }
});
