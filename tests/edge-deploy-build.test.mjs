// The Docker image runs `node scripts/prepare-edge-deploy.mjs` as a build step,
// and that script rewrites source by matching exact anchor strings. Nothing in
// the suite exercised it, so an edit to any file it patches could pass every
// test, merge, and then fail the image build - which is exactly what happened:
// an anchor in research-ui-runtime-patch.mjs moved, the build died at
// `anchor count=0`, and the first sign of it was a failed deploy.
//
// These run the real script against a throwaway copy of the repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

function stagedCopy() {
  const dir = mkdtempSync(path.join(tmpdir(), 'edge-build-'));
  for (const entry of ['lib', 'apex-v2', 'scripts', 'public', 'package.json']) {
    cpSync(path.join(repo, entry), path.join(dir, entry), { recursive: true });
  }
  return dir;
}

test('the image build step still finds every anchor it rewrites', () => {
  const dir = stagedCopy();
  try {
    execFileSync(process.execPath, [path.join(dir, 'scripts/prepare-edge-deploy.mjs')],
      { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    assert.fail(`the Docker build step would fail:\n${error.stderr || error.message}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the built image serves soccer as a researched sport, not a line-only one', () => {
  const dir = stagedCopy();
  try {
    execFileSync(process.execPath, [path.join(dir, 'scripts/prepare-edge-deploy.mjs')], { cwd: dir, stdio: 'pipe' });
    const adapter = readFileSync(path.join(dir, 'lib/autoscout/research-ui-runtime-patch.mjs'), 'utf8');
    // The build used to introduce this, which switched soccer research off
    // after the fact. Soccer resolves against a real game log now.
    assert.ok(!adapter.includes("selectedSport==='SOCCER'"),
      'the build must not re-pin soccer to line-only');
    assert.match(adapter, /var SPORTS=\[[^\]]*'SOCCER'[^\]]*\]/, 'soccer must still reach the selector');
    const models = readFileSync(path.join(dir, 'lib/autoscout/models.mjs'), 'utf8');
    assert.match(models, /SUPPORTED_SPORTS[^;]*'SOCCER'/, 'the board route must accept soccer');
    assert.doesNotMatch(models, /AUTOMATIC_SPORTS = Object\.freeze\(\[[^\]]*'SOCCER'/,
      'and soccer must stay out of paid automatic polling');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// applySoccerPublicFeedPatches is idempotent by construction -
// replaceOnceOrPresent returns early when the result is already there - so a
// rerun over partly-patched source must be a no-op rather than a double edit.
// (The donut-overlay patch alongside it is deliberately single-shot and throws
// on a second run; the image always builds from a fresh checkout, so that is
// left as it is rather than changed here.)
test('the soccer patches are a no-op once they have been applied', async () => {
  const { applySoccerPublicFeedPatches } = await import('../scripts/patch-soccer-public-feeds.mjs');
  const dir = stagedCopy();
  const watched = ['lib/autoscout/models.mjs', 'lib/autoscout/research-ui-runtime-patch.mjs',
    'lib/ingestion/pinnacle-public.mjs', 'lib/ingestion/betmgm-public.mjs'];
  try {
    applySoccerPublicFeedPatches(dir);
    const after = watched.map(f => readFileSync(path.join(dir, f), 'utf8'));
    applySoccerPublicFeedPatches(dir);
    watched.forEach((f, i) => assert.equal(readFileSync(path.join(dir, f), 'utf8'), after[i], `${f} drifted on a second run`));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
