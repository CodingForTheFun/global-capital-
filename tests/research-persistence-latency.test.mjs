import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('production research runtime uses the verified v2 research service', () => {
  const bootstrap = read('../frontdoor-clearsports.mjs');
  assert.match(bootstrap, /const newImport = '\.\/lib\/autoscout\/research-service-v2\.mjs';/);
  assert.match(bootstrap, /source\.replace\(oldImport, newImport\)/);
});

test('verified public history persistence never blocks trend hydration', () => {
  const source = read('../lib/autoscout/research-service-v2.mjs');
  assert.doesNotMatch(source, /await\s+persistResearchGameLogs\s*\(/);
  assert.match(source, /queueResearchPersistence\(history, params\);/);
  assert.match(source, /persistenceTail\s*=\s*persistenceTail/);
  assert.match(source, /persistenceQueued\.has\(key\)/);
});
