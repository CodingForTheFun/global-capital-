import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Snipes build composes the strict detector with the PropLine live market pulse', () => {
  const work = mkdtempSync(path.join(tmpdir(), 'oblige-snipe-pulse-'));
  try {
    mkdirSync(path.join(work, 'apex-v2'), { recursive: true });
    copyFileSync(path.join(repoRoot, 'apex-v2', 'scout-ui-v5.js'), path.join(work, 'apex-v2', 'scout-ui-v5.js'));

    execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'patch-real-snipe-table.mjs')], { cwd: work });
    execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'patch-snipe-market-pulse.mjs')], { cwd: work });

    const built = readFileSync(path.join(work, 'apex-v2', 'scout-ui-v5.js'), 'utf8');
    assert.match(built, /Snipe readiness/);
    assert.match(built, /Market Watch/);
    assert.match(built, /Live Market Pulse/);
    assert.match(built, /\/api\/apex\/live-moves\?/);
    assert.match(built, /PropLine movement context/);
    assert.match(built, /Nothing is promoted to a snipe just to fill the screen/);
    assert.doesNotMatch(built, /No verified snipes right now/);
    assert.doesNotThrow(() => new Function(built));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('edge build runs market-pulse visuals after the strict Snipes patch', () => {
  const source = readFileSync(path.join(repoRoot, 'scripts', 'prepare-edge-deploy.mjs'), 'utf8');
  const strictAt = source.indexOf("import './patch-real-snipe-table.mjs';");
  const pulseAt = source.indexOf("import './patch-snipe-market-pulse.mjs';");
  assert.ok(strictAt >= 0);
  assert.ok(pulseAt > strictAt);
});
