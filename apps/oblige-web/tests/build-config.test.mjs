import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// apps/oblige-web/Dockerfile builds with only this app's lockfile, so Turbopack
// inferred this folder as its root and could not resolve the shared
// ../../../lib/constants/books.mjs import. Every oblige-web deploy failed.
test('Turbopack resolves from the repository root in every build context', () => {
  const config = readFileSync(new URL('../next.config.ts', import.meta.url), 'utf8');
  assert.match(config, /turbopack: \{ root: path\.join\(__dirname, '\.\.', '\.\.'\) \}/);
  const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /COPY lib\/ \/app\/lib\//, 'the shared lib/ is where the root points');
});
