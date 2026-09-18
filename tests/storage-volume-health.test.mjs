import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { classifyStorage, storageHealth, storageInventory } from '../lib/storage/volume-health.mjs';

test('classifies persistent-volume pressure before ENOSPC', () => {
  assert.equal(classifyStorage(0.79), 'healthy');
  assert.equal(classifyStorage(0.80), 'warning');
  assert.equal(classifyStorage(0.899), 'warning');
  assert.equal(classifyStorage(0.90), 'critical');
});

test('reports aggregate capacity and bounded size inventory without reading contents', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'oblige-storage-'));
  try {
    mkdirSync(path.join(root, 'cache'), { recursive: true });
    writeFileSync(path.join(root, 'users.json'), Buffer.alloc(1024));
    writeFileSync(path.join(root, 'cache', 'runtime.json'), Buffer.alloc(4096));

    const health = storageHealth(root);
    assert.equal(health.available, true);
    assert.ok(health.totalMB > 0);
    assert.ok(['healthy', 'warning', 'critical'].includes(health.status));

    const inventory = storageInventory(root, { limit: 5 });
    assert.equal(inventory.truncated, false);
    assert.ok(inventory.scanned >= 3);
    assert.deepEqual(inventory.topLevel.map((row) => row.name), ['cache', 'users.json']);
    assert.equal(inventory.largestFiles[0].path, 'cache/runtime.json');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
