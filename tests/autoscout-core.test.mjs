import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizedEvent,
  normalizedPlayer,
  normalizedProp,
  normalizedBookmakerLine,
  validateNormalizedBoard,
} from '../lib/autoscout/models.mjs';
import { ProviderRegistry, PROVIDER_KINDS, validateProvider } from '../lib/autoscout/providers/contracts.mjs';
import { normalizeOddsFixture } from '../lib/autoscout/providers/the-odds-api.mjs';

function fixture() {
  return {
    id: 'event-real-shape',
    commence_time: '2099-01-01T00:00:00Z',
    home_team: 'Home Team',
    away_team: 'Away Team',
    bookmakers: [
      {
        key: 'draftkings',
        title: 'DraftKings',
        last_update: '2098-12-31T23:59:00Z',
        markets: [
          {
            key: 'player_pass_yds',
            last_update: '2098-12-31T23:59:30Z',
            outcomes: [
              { name: 'Over', description: 'Quarterback One', point: 249.5, price: -105 },
              { name: 'Under', description: 'Quarterback One', point: 249.5, price: -115 },
            ],
          },
        ],
      },
      {
        key: 'fanduel',
        title: 'FanDuel',
        markets: [
          {
            key: 'player_pass_yds',
            outcomes: [
              { name: 'Over', description: 'Quarterback One', point: 251.5, price: 100 },
              { name: 'Under', description: 'Quarterback One', point: 251.5, price: -120 },
            ],
          },
        ],
      },
    ],
  };
}

test('normalized model constructors preserve real fields and null missing data', () => {
  const event = normalizedEvent({ provider: 'fixture', providerEventId: 'e1', sport: 'NFL', homeTeam: 'A', awayTeam: 'B' });
  const player = normalizedPlayer({ provider: 'fixture', sport: 'NFL', name: 'Player One' });
  const prop = normalizedProp({ provider: 'fixture', sport: 'NFL', eventId: event.id, playerId: player.id, playerName: player.name, marketKey: 'player_receptions', marketName: 'Receptions' });
  const line = normalizedBookmakerLine({ provider: 'fixture', propId: prop.id, bookmakerKey: 'book', bookmakerName: 'Book', side: 'OVER', line: 4.5 });
  assert.equal(event.homeScore, null);
  assert.equal(player.position, '');
  assert.equal(line.price, null);
  assert.deepEqual(validateNormalizedBoard({ events: [event], players: [player], props: [prop], lines: [line] }), []);
});

test('The Odds API fixture becomes normalized event, player, prop and bookmaker-line collections', () => {
  const normalized = normalizeOddsFixture(fixture(), 'NFL');
  assert.equal(normalized.players.length, 1);
  assert.equal(normalized.props.length, 1);
  assert.equal(normalized.lines.length, 4);
  assert.equal(normalized.compatibility.length, 4);
  assert.deepEqual(new Set(normalized.lines.map((row) => row.side)), new Set(['OVER', 'UNDER']));
  assert.deepEqual(new Set(normalized.lines.map((row) => row.bookmakerKey)), new Set(['draftkings', 'fanduel']));
  assert.ok(normalized.lines.every((row) => Number.isFinite(row.line)));
  assert.ok(normalized.lines.every((row) => row.ingestedAt));
  assert.ok(normalized.lines.some((row) => row.providerUpdatedAt === '2098-12-31T23:59:30Z'));
});

test('compatibility rows expose sportsbook, market, line, side, price and both timestamps without fabricated research stats', () => {
  const normalized = normalizeOddsFixture(fixture(), 'NFL');
  const row = normalized.compatibility.find((item) => item.sportsbookKey === 'draftkings' && item.side === 'OVER');
  assert.equal(row.playerName, 'Quarterback One');
  assert.equal(row.marketId, 'player_pass_yds');
  assert.equal(row.market, 'Pass Yards');
  assert.equal(row.line, 249.5);
  assert.equal(row.price, -105);
  assert.equal(row.sportsbook, 'DraftKings');
  assert.equal(row.providerUpdatedAt, '2098-12-31T23:59:30Z');
  assert.ok(row.ingestedAt);
  for (const forbidden of ['l5','l10','l15','h2h','seasonAverage','projection','expectedValue','autoScoutProbability']) {
    assert.equal(Object.hasOwn(row, forbidden), false, `${forbidden} must not be invented by the odds adapter`);
  }
});

test('consensus line is explicitly a median of returned book lines, not a predicted probability', () => {
  const normalized = normalizeOddsFixture(fixture(), 'NFL');
  assert.ok(normalized.compatibility.every((row) => row.consensusLine === 250.5));
  assert.ok(normalized.compatibility.every((row) => row.fairLine === 250.5));
});

test('provider registry enforces the OddsProvider interface', () => {
  assert.ok(validateProvider({ id: 'bad', name: 'Bad', isConfigured() {}, health() {} }, PROVIDER_KINDS.ODDS).includes('OddsProvider requires fetchBoard()'));
  const registry = new ProviderRegistry();
  const provider = {
    id: 'fixture-odds',
    name: 'Fixture Odds',
    isConfigured: () => true,
    health: () => ({ ok: true }),
    fetchBoard: async () => ({ props: [] }),
  };
  registry.register(PROVIDER_KINDS.ODDS, provider);
  assert.equal(registry.configured(PROVIDER_KINDS.ODDS)[0], provider);
});
