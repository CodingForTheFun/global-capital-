import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { researchBatchSummary, researchBatchLogLine } from '../lib/autoscout/research-batch-log.mjs';

const entry = (key, sport) => ({ key, params: { sport, playerName: 'Secret Name', line: 4.5 } });

test('research-batch log counts outcome codes per sport', () => {
  const entries = [entry('a', 'NFL'), entry('b', 'NFL'), entry('c', 'NFL'), entry('d', 'mlb'), entry('e', 'MLB')];
  const results = {
    a: { ok: true, available: true, windows: {} },
    b: { ok: true, available: false, code: 'UNSUPPORTED_MARKET' },
    c: { ok: false, available: false, code: 'RESEARCH_PROVIDER_ERROR' },
    d: { ok: true, available: false, code: 'FANTASY_SCORING_UNVERIFIED' },
  };
  assert.deepEqual(researchBatchSummary(entries, results, 812.4), {
    props: 5,
    elapsedMs: 812,
    bySport: {
      NFL: { OK: 1, UNSUPPORTED_MARKET: 1, RESEARCH_PROVIDER_ERROR: 1 },
      MLB: { FANTASY_SCORING_UNVERIFIED: 1, NO_RESULT: 1 },
    },
  });
});

test('research-batch log never includes player names, lines or odd codes', () => {
  const line = researchBatchLogLine([entry('a', 'NFL')], { a: { ok: true, available: false, code: 'bad code <script>' } }, 5);
  assert.match(line, /^\[research-batch\] /);
  assert.doesNotMatch(line, /Secret Name|4\.5|script/);
  assert.match(line, /"OTHER":1/);
});

test('the live research-batch handler logs one summary line per request', () => {
  const frontdoor = readFileSync(new URL('../frontdoor-prod.mjs', import.meta.url), 'utf8');
  const start = frontdoor.indexOf('async function maybeServeResearchBatch(req, res) {');
  const end = frontdoor.indexOf('\n}\n', start);
  const handler = frontdoor.slice(start, end);
  assert.ok(start > 0, 'handler anchor unchanged (runtime patches match on it)');
  assert.match(handler, /console\.log\(researchBatchLogLine\(entries, results, Date\.now\(\) - startedAt\)\)/);
  assert.match(frontdoor, /import \{ researchBatchLogLine \} from '\.\/lib\/autoscout\/research-batch-log\.mjs';/);
});
