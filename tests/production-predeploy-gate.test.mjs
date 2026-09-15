import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readText = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('production image keeps tests available for the Railway pre-deploy gate', () => {
  const dockerignore = readText('../.dockerignore');
  const activePatterns = dockerignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  assert.ok(!activePatterns.includes('tests'));
  assert.ok(!activePatterns.includes('tests/'));
});

test('npm run check still executes the test suite', () => {
  const pkg = JSON.parse(readText('../package.json'));
  assert.match(pkg.scripts?.check || '', /npm test/);
});
