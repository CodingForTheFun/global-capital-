import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveService } from '../lib/live/service.mjs';

function espnEvent({ id, home, away, homeScore, awayScore, state, start, period = null, clock = null, detail = null }) {
  const status = { period, displayClock: clock, type: { state, completed: state === 'post', shortDetail: detail } };
  return {
    id,
    date: start,
    status,
    competitions: [{
      id,
      date: start,
      status,
      competitors: [
        { id: `away-${id}`, homeAway: 'away', score: awayScore, team: { id: `away-${id}`, abbreviation: away, displayName: `Away ${away}`, logo: `https://example.com/${away}.png` } },
        { id: `home-${id}`, homeAway: 'home', score: homeScore, team: { id: `home-${id}`, abbreviation: home, displayName: `Home ${home}`, logo: `https://example.com/${home}.png` } },
      ],
      broadcasts: [{ names: ['TEST'] }],
    }],
  };
}

function scoreboardFetcher() {
  const calls = [];
  const payload = {
    events: [
      espnEvent({ id: '1', home: 'BOS', away: 'NYK', homeScore: '88', awayScore: '84', state: 'in', period: 3, clock: '04:21', detail: '3rd · 04:21', start: '2026-09-09T19:00:00Z' }),
      espnEvent({ id: '2', home: 'LAL', away: 'PHX', homeScore: undefined, awayScore: undefined, state: 'pre', detail: '10:00 PM', start: '2026-09-09T22:00:00Z' }),
      espnEvent({ id: '3', home: 'MIA', away: 'ORL', homeScore: '110', awayScore: '99', state: 'post', detail: 'Final', start: '2026-09-09T17:00:00Z' }),
    ],
  };
  return {
    calls,
    async fetcher(url) {
      calls.push(String(url));
      return { ok: true, status: 200, async json() { return payload; } };
    },
  };
}

test('live games normalize free ESPN scoreboard data without inventing missing scores', async () => {
  const fake = scoreboardFetcher();
  const service = createLiveService({ fetcher: fake.fetcher, now: () => new Date('2026-09-09T12:00:00Z') });
  const result = await service.snapshot({ sports: ['NBA'] });
  assert.equal(result.provider, 'espn-public');
  assert.equal(result.games.length, 3);
  assert.equal(result.live.length, 1);
  assert.equal(result.upcoming.length, 1);
  assert.equal(result.final.length, 1);
  assert.equal(result.live[0].homeScore, 88);
  assert.equal(result.live[0].awayScore, 84);
  assert.equal(result.live[0].period, 3);
  assert.equal(result.live[0].clock, '04:21');
  assert.equal(result.live[0].homeName, 'Home BOS');
  assert.equal(result.live[0].homeLogo, 'https://example.com/BOS.png');
  assert.equal(result.upcoming[0].homeScore, null, 'missing scheduled score stays null');
  assert.match(fake.calls[0], /site\.api\.espn\.com\/apis\/site\/v2\/sports\/basketball\/nba\/scoreboard/);
  // ESPN rejects date ranges: yesterday through three days ahead, one day each.
  assert.deepEqual(fake.calls.map((url) => url.match(/dates=([^&]+)/)[1]), ['20260908', '20260909', '20260910', '20260911', '20260912']);
  assert.equal(result.window, '20260908-20260912');
});

test('live service caches repeated score snapshots and does not hammer the public feed', async () => {
  const fake = scoreboardFetcher();
  const service = createLiveService({ fetcher: fake.fetcher, now: () => new Date('2026-09-09T12:00:00Z') });
  await service.snapshot({ sports: ['NBA'] });
  const first = fake.calls.length;
  await service.snapshot({ sports: ['NBA'] });
  assert.equal(fake.calls.length, first);
});

test('live service needs no paid sportsbook or stats API key', async () => {
  const fake = scoreboardFetcher();
  const service = createLiveService({ fetcher: fake.fetcher, now: () => new Date('2026-09-09T12:00:00Z') });
  const result = await service.snapshot({ sports: ['NBA'] });
  assert.equal(result.clientStats.provider, 'espn-public');
  assert.equal(result.coverage[0].status, 200);
  assert.equal(result.coverage[0].recordCount, 3);
});

test('days after today are held for five minutes; yesterday and today refresh', async () => {
  const fake = scoreboardFetcher();
  let clock = new Date('2026-09-09T12:00:00Z');
  const service = createLiveService({ fetcher: fake.fetcher, now: () => clock });
  await service.snapshot({ sports: ['NBA'] });
  service.clear();
  clock = new Date('2026-09-09T12:01:00Z');
  const before = fake.calls.length;
  await service.snapshot({ sports: ['NBA'] });
  assert.deepEqual(fake.calls.slice(before).map((url) => url.match(/dates=([^&]+)/)[1]), ['20260908', '20260909']);
});
