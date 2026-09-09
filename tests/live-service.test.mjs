import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveService } from '../lib/live/service.mjs';

function client() {
  const calls = [];
  return {
    calls,
    stats: () => ({ requests: calls.length, hits: 0, misses: calls.length, errors: 0 }),
    async get(_url, path) {
      calls.push(path);
      if (path.includes('GamesByDate')) {
        return { ok: true, data: [
          { GameID: 1, HomeTeam: 'BOS', AwayTeam: 'NYK', HomeTeamScore: 88, AwayTeamScore: 84, Status: 'InProgress', Quarter: 3, TimeRemaining: '04:21', DateTime: '2026-09-09T19:00:00Z' },
          { GameID: 2, HomeTeam: 'LAL', AwayTeam: 'PHX', Status: 'Scheduled', DateTime: '2026-09-09T22:00:00Z' },
          { GameID: 3, HomeTeam: 'MIA', AwayTeam: 'ORL', HomeTeamScore: 110, AwayTeamScore: 99, Status: 'Final', DateTime: '2026-09-09T17:00:00Z' },
        ] };
      }
      return { ok: false, status: 404, reason: 'not found', data: null };
    },
  };
}

test('live games normalize scores, state, period and clock without inventing missing scores', async () => {
  process.env.SPORTSDATAIO_API_KEY = 'unit-test-key-not-real';
  const fake = client();
  const service = createLiveService({ client: fake, now: () => new Date('2026-09-09T12:00:00Z') });
  const result = await service.snapshot({ sports: ['NBA'] });
  assert.equal(result.games.length, 3);
  assert.equal(result.live.length, 1);
  assert.equal(result.upcoming.length, 1);
  assert.equal(result.final.length, 1);
  assert.equal(result.live[0].homeScore, 88);
  assert.equal(result.live[0].awayScore, 84);
  assert.equal(result.live[0].period, 3);
  assert.equal(result.live[0].clock, '04:21');
  assert.equal(result.upcoming[0].homeScore, null, 'missing scheduled score stays null');
  delete process.env.SPORTSDATAIO_API_KEY;
});

test('live service caches repeated snapshots and does not hammer the provider', async () => {
  process.env.SPORTSDATAIO_API_KEY = 'unit-test-key-not-real';
  const fake = client();
  const service = createLiveService({ client: fake, now: () => new Date('2026-09-09T12:00:00Z') });
  await service.snapshot({ sports: ['NBA'] });
  const first = fake.calls.length;
  await service.snapshot({ sports: ['NBA'] });
  assert.equal(fake.calls.length, first);
  delete process.env.SPORTSDATAIO_API_KEY;
});
