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

test('the Docker image validates pristine source before build-time patching', () => {
  const dockerfile = readText('../Dockerfile');
  const checkIndex = dockerfile.indexOf('RUN npm run check');
  const prepareIndex = dockerfile.indexOf('RUN node scripts/prepare-edge-deploy.mjs');
  assert.ok(checkIndex >= 0, 'Dockerfile must execute the release check');
  assert.ok(prepareIndex > checkIndex, 'release check must run before prepare-edge-deploy mutates source anchors');
});

test('npm run check executes the hermetic test suite', () => {
  const pkg = JSON.parse(readText('../package.json'));
  assert.match(pkg.scripts?.check || '', /npm run test:clean/);
  assert.equal(pkg.scripts?.['test:clean'], 'node scripts/run-tests-clean-env.mjs');
});

test('the hermetic runner refuses zero tests and does not inherit app configuration', () => {
  const runner = readText('../scripts/run-tests-clean-env.mjs');
  assert.match(runner, /refusing to pass with zero test files/);
  assert.match(runner, /NODE_ENV: 'test'/);
  assert.doesNotMatch(runner, /\.\.\.process\.env/);
});
