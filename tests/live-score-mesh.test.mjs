import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createLiveService } from '../lib/live/service.mjs';
import { patchLiveMainViewUi } from '../lib/autoscout/live-main-view-runtime-patch.mjs';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

test('scores use ESPN without spending a Sportradar fallback request when ESPN works', async () => {
  let radarCalls = 0;
  const service = createLiveService({
    now: () => new Date('2026-09-21T22:00:00Z'),
    fetcher: async () => jsonResponse({
      events: [{
        id: 'espn-1',
        date: '2026-09-21T23:00:00Z',
        competitions: [{
          competitors: [
            { homeAway: 'away', score: '17', team: { abbreviation: 'DAL', displayName: 'Dallas Cowboys' } },
            { homeAway: 'home', score: '20', team: { abbreviation: 'NYG', displayName: 'New York Giants' } },
          ],
          status: { type: { state: 'in', shortDetail: 'Q3 04:12' }, period: 3, displayClock: '4:12' },
          broadcasts: [{ names: ['ESPN'] }],
          venue: { fullName: 'Test Stadium' },
        }],
      }],
    }),
    radarAvailable: () => true,
    radarGet: async () => { radarCalls += 1; return { ok: true, payload: {} }; },
  });

  const snapshot = await service.snapshot({ sports: ['NFL'], force: true });
  assert.equal(radarCalls, 0);
  assert.equal(snapshot.live.length, 1);
  assert.equal(snapshot.coverage[0].source, 'espn-public');
  assert.equal(snapshot.live[0].providerStatus, 'Q3 04:12');
});

test('scores fall back to verified Sportradar when ESPN is unavailable', async () => {
  let radarCalls = 0;
  const service = createLiveService({
    now: () => new Date('2026-09-21T22:00:00Z'),
    fetcher: async () => jsonResponse({}, 503),
    radarAvailable: (product) => product === 'nba',
    radarGet: async (product, path) => {
      radarCalls += 1;
      assert.equal(product, 'nba');
      assert.equal(path, '/games/2026/09/21/schedule.json');
      return {
        ok: true,
        status: 200,
        payload: {
          games: [{
            id: 'sr-game',
            status: 'closed',
            scheduled: '2026-09-21T19:00:00Z',
            home_points: 110,
            away_points: 105,
            home: { id: 'h', name: 'Home Team', alias: 'HOM' },
            away: { id: 'a', name: 'Away Team', alias: 'AWY' },
            venue: { name: 'Arena' },
          }],
        },
      };
    },
  });

  const snapshot = await service.snapshot({ sports: ['NBA'], force: true });
  assert.equal(radarCalls, 1);
  assert.equal(snapshot.final.length, 1);
  assert.equal(snapshot.final[0].homeScore, 110);
  assert.equal(snapshot.final[0].awayScore, 105);
  assert.equal(snapshot.coverage[0].source, 'sportradar');
});

test('scores UI exposes the strict five sports and All Live Finished filters', () => {
  const source = fs.readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  const patched = patchLiveMainViewUi(source);
  assert.match(patched, /var sportOrder=\['NFL','NBA','SOCCER','NHL','MLB'\]/);
  assert.match(patched, /SOCCER:'EPL'/);
  assert.match(patched, /data-inline-live-filter="all"/);
  assert.match(patched, /data-inline-live-filter="live"/);
  assert.match(patched, /data-inline-live-filter="finished"/);
  assert.match(patched, /sports=NFL,NBA,SOCCER,NHL,MLB/);
  new Function(patched);
});
