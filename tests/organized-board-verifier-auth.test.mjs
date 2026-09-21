import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const scriptPath = new URL('../scripts/verify-organized-production.mjs', import.meta.url);
const workflowPath = new URL('../.github/workflows/organized-board-production.yml', import.meta.url);

test('organized production verifier uses the current safe account flow', () => {
  const syntax = spawnSync(process.execPath, ['--check', scriptPath.pathname], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);

  const source = readFileSync(scriptPath, 'utf8');
  assert.doesNotMatch(source, /\/api\/account\/register/);
  assert.match(source, /\/api\/account\/login/);
  assert.match(source, /AUTOSCOUT_SMOKE_EMAIL/);
  assert.match(source, /AUTOSCOUT_SMOKE_PASSWORD/);
  assert.match(source, /skipped-no-preprovisioned-credentials/);
});

test('organized board workflow passes exact revision and optional smoke identity', (t) => {
  // Railway production images intentionally exclude .github. Keep this CI-only
  // assertion active when the workflow file exists instead of breaking the app build.
  if (!existsSync(workflowPath)) {
    t.skip('workflow source is not included in the production image');
    return;
  }
  const workflow = readFileSync(workflowPath, 'utf8');
  assert.doesNotMatch(workflow, /AUTOSCOUT_EXPECTED_SHA:\s*\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /AUTOSCOUT_SMOKE_EMAIL:\s*\$\{\{ secrets\.AUTOSCOUT_SMOKE_EMAIL \}\}/);
  assert.match(workflow, /AUTOSCOUT_SMOKE_PASSWORD:\s*\$\{\{ secrets\.AUTOSCOUT_SMOKE_PASSWORD \}\}/);
  assert.match(workflow, /AUTOSCOUT_PUBLIC_URL:\s*https:\/\/www\.obligeprops\.com/);
});
