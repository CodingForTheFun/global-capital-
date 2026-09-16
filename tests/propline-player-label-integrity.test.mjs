import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEventOdds } from '../lib/data-sources/propline/normalize.mjs';

function eventWithOutcome(description) {
  return {
    id: 'mlb-event-1',
    sport_key: 'baseball_mlb',
    home_team: 'Seattle Mariners',
    away_team: 'Los Angeles Angels',
    bookmakers: [
      {
        key: 'betmgm',
        title: 'BetMGM',
        markets: [
          {
            key: 'batter_runs',
            outcomes: [
              { name: 'Over', description, point: 4.5, price: -110 },
              { name: 'Under', description, point: 4.5, price: -110 },
            ],
          },
        ],
      },
    ],
  };
}

test('PropLine inning-segment labels never become synthetic player props', () => {
  for (const label of ['First 5 innings', 'Top innings', '1st innings']) {
    const out = normalizeEventOdds(eventWithOutcome(label), { sport: 'MLB' });
    assert.equal(out.players.length, 0, `${label} must not become a player`);
    assert.equal(out.props.length, 0, `${label} must not become a prop`);
    assert.equal(out.lines.length, 0, `${label} must not become a bookmaker line`);
    assert.equal(out.skipped.noPlayer, 2, `${label} outcomes should be counted as invalid player labels`);
  }
});

test('a real player name still normalizes when the provider omits player_id', () => {
  const out = normalizeEventOdds(eventWithOutcome('Mike Trout'), { sport: 'MLB' });
  assert.equal(out.players.length, 1);
  assert.equal(out.props.length, 1);
  assert.equal(out.lines.length, 2);
  assert.equal(out.players[0].name, 'Mike Trout');
});
