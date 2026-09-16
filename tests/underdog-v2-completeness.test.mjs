import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchUnderdogV2Payload } from '../lib/ingestion/underdog-v2.mjs';

const sports = [
  { id: 'sport-nfl', name: 'NFL', abbreviation: 'NFL' },
  { id: 'sport-wnba', name: 'WNBA', abbreviation: 'WNBA' },
];

function line(id) {
  return {
    id,
    stat_value: 10.5,
    options: [{ choice: 'higher', payout_multiplier: 1 }, { choice: 'lower', payout_multiplier: 1 }],
    over_under: { appearance_stat: { display_stat: 'Points' } },
  };
}

function payload(lines = []) {
  return { players: [], appearances: [], games: [], solo_games: [], teams: [], over_under_lines: lines };
}

test('Underdog v2 fallback rejects a snapshot when any selected sport request fails', async () => {
  const fetchJson = async (url) => {
    if (url.includes('/v2/sports')) return { sports };
    const sportId = new URL(url).searchParams.get('sport_id');
    if (sportId === 'sport-nfl') return payload([line('nfl-1')]);
    throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
  };

  await assert.rejects(
    fetchUnderdogV2Payload({ maxSports: 2, fetchJson }),
    (error) => error?.code === 'UNDERDOG_V2_PARTIAL_SPORTS' && error?.expectedSports === 2 && error?.loadedSports === 1,
  );
});

test('Underdog v2 fallback rejects sport results that hit the unpaginated search cap', async () => {
  const fetchJson = async (url) => {
    if (url.includes('/v2/sports')) return { sports };
    const sportId = new URL(url).searchParams.get('sport_id');
    if (sportId === 'sport-nfl') return payload(Array.from({ length: 100 }, (_, i) => line(`nfl-${i}`)));
    return payload([]);
  };

  await assert.rejects(
    fetchUnderdogV2Payload({ maxSports: 2, fetchJson }),
    (error) => error?.code === 'UNDERDOG_V2_TRUNCATED_SPORTS' && error?.saturatedSports === 1 && error?.limitGuard === 100,
  );
});

test('Underdog v2 fallback allows valid empty sport responses when every selected request completes', async () => {
  const fetchJson = async (url) => {
    if (url.includes('/v2/sports')) return { sports };
    const sportId = new URL(url).searchParams.get('sport_id');
    return sportId === 'sport-nfl' ? payload([line('nfl-1')]) : payload([]);
  };

  const result = await fetchUnderdogV2Payload({ maxSports: 2, fetchJson });
  assert.equal(result._autoscout_v2, true);
  assert.equal(result.over_under_lines.length, 1);
  assert.equal(result.over_under_lines[0].id, 'nfl-1');
});
