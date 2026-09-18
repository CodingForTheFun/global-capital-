import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPublicResearch } from '../lib/data-sources/espn/research.mjs';
import { createProofTransport, evaluateProof } from '../lib/diagnostics/wnba-on-demand-proof.mjs';

// Integration CONTRACT regression only. Reuse the existing captured August fixture
// unchanged. Never relabel its dates as September 17 or call it live evidence.
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/espn-${name}.json`, import.meta.url)));
const expected = { eventId: '401857181', athleteId: '4433403', playerName: 'Caitlin Clark',
  teamId: '5', team: 'IND', opponentId: '18', opponent: 'CON',
  date: '2026-08-28T23:30:00.000Z', season: '2026', seasonType: 2, points: 34 };
const params = { sport: 'WNBA', playerName: expected.playerName, team: expected.team,
  market: 'Points', providerMarketKey: 'player_points', games: 15 };

test('existing captured WNBA game survives the real supported factory and guarded GET transport', async () => {
  const transport = createProofTransport({ date: '2026-08-28', signal: new AbortController().signal,
    fetchImpl: async (url, init) => {
      assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
      assert.deepEqual(init.headers, { accept: 'application/json' });
      let payload;
      if (url.includes('/search/v2?')) payload = fixture('player-search');
      else if (url.endsWith('/wnba/scoreboard?limit=1')) payload = { leagues: [{ slug: 'wnba', season: { year: 2026, startDate: '2026-05-01' } }] };
      else if (url.endsWith('/wnba/athletes/4433403/gamelog')) payload = fixture('wnba-gamelog');
      else assert.fail('Unexpected provider read in contract fixture');
      return new Response(JSON.stringify(payload));
    } });
  transport.selectPlayer(expected);
  const research = createPublicResearch({ fetchImpl: transport.fetch, now: () => Date.parse('2026-09-18T12:00:00Z') });
  const result = await research(params);
  assert.equal(result.available, true);
  assert.equal(evaluateProof(result, expected).status, 'HEALTHY');
  assert.equal(transport.evidence().networkRequests, 3);
  assert.deepEqual(transport.evidence().trace.map(row => row.kind), ['identity', 'season', 'gamelog']);
  assert.ok(transport.evidence().trace.every(row => row.error === null));
  const again = await research(params);
  assert.equal(evaluateProof(again, expected).status, 'HEALTHY');
  assert.equal(transport.evidence().networkRequests, 3, 'only this isolated factory cache is reused');
});

test('actual provider fail-closed code survives a guarded upstream outage without retries', async () => {
  const transport = createProofTransport({ date: '2026-09-17', signal: new AbortController().signal,
    fetchImpl: async () => new Response('', { status: 429 }) });
  transport.selectPlayer(expected);
  const result = await createPublicResearch({ fetchImpl: transport.fetch })(params);
  assert.equal(result.available, false);
  const proof = evaluateProof(result, expected);
  assert.equal(proof.status, 'UNVERIFIABLE');
  assert.equal(proof.providerCode, 'RESEARCH_PROVIDER_ERROR');
  assert.equal(transport.evidence().networkRequests, 1);
});
