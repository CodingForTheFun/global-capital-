import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findAnchor, recoveryComment, verifiedDeployment, REQUIRED_PARENT_WORKFLOWS, RAILWAY_CONTEXT } from '../scripts/release-anchor.mjs';

const RAILWAY_URL = 'https://railway.com/project/p/service/f6d34023-04e3-4799-a3c4-defab50a7a1e?id=d';
const run = (sha, name, conclusion, at) => ({ head_sha: sha, name, status: 'completed', conclusion, updated_at: at });

// Today's chain: #625 merge -> #624 merge (gate failed) -> #574 merge (release
// check never passed) -> e4a1d46 (both workflows green, then deployed).
function fakeApi() {
  const chain = { m625: 'm624', m624: 'm574', m574: 'e4a1d46', e4a1d46: 'older' };
  const runs = {
    m624: [run('m624', REQUIRED_PARENT_WORKFLOWS[0], 'failure', '2026-09-22T22:00:00Z')],
    m574: [run('m574', REQUIRED_PARENT_WORKFLOWS[0], 'failure', '2026-09-22T19:25:00Z'), run('m574', REQUIRED_PARENT_WORKFLOWS[1], 'success', '2026-09-22T19:26:00Z')],
    e4a1d46: REQUIRED_PARENT_WORKFLOWS.map((name) => run('e4a1d46', name, 'success', '2026-09-22T10:00:00Z')),
  };
  const statuses = {
    m574: [{ context: RAILWAY_CONTEXT, state: 'success', target_url: RAILWAY_URL, created_at: '2026-09-22T19:30:00Z' }],
    e4a1d46: [{ context: RAILWAY_CONTEXT, state: 'success', target_url: RAILWAY_URL, created_at: '2026-09-22T10:05:00Z' }],
  };
  return {
    pushRuns: async (sha) => runs[sha] || [],
    statuses: async (sha) => statuses[sha] || [],
    parent: async (sha) => chain[sha] || null,
  };
}

test('the anchor is the nearest ancestor with both workflows green and a later deploy, not the live revision', async () => {
  const api = fakeApi();
  assert.equal(await verifiedDeployment(api, 'm574'), null, 'deployed but its release check failed');
  const anchor = await findAnchor(api, 'm625');
  assert.equal(anchor.sha, 'e4a1d46');
  assert.equal(anchor.depth, 3);
  assert.equal(recoveryComment('e4a1d461a7f07d311da3b26cfcb403fd5cc46fae'), 'SAFE TO MERGE — RELEASE RECOVERY VERIFIED, deployed anchor e4a1d461a7f0');
});

test('a deploy status older than the workflows does not verify a commit', async () => {
  const api = fakeApi();
  const stale = { ...api, statuses: async () => [{ context: RAILWAY_CONTEXT, state: 'success', target_url: RAILWAY_URL, created_at: '2026-09-22T09:00:00Z' }] };
  assert.equal(await verifiedDeployment(stale, 'e4a1d46'), null);
});

test('the script mirrors the gate it predicts', () => {
  const gate = readFileSync(new URL('../.github/workflows/release-candidate-check.yml', import.meta.url), 'utf8');
  for (const name of REQUIRED_PARENT_WORKFLOWS) assert.ok(gate.includes(`'${name}'`), name);
  assert.ok(gate.includes(`const railwayContext = '${RAILWAY_CONTEXT}'`));
  assert.ok(gate.includes('f6d34023-04e3-4799-a3c4-defab50a7a1e'));
});
