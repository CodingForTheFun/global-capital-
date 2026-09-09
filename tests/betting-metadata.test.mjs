import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMetadata, toMap, isEmptyMetadata, createMetadataLoader } from '../lib/data-sources/sportsdataio/betting-metadata.mjs';
import { normalizePlayerPropOffers } from '../lib/data-sources/sportsdataio/odds.mjs';

// A payload carrying only numeric type IDs — the shape that silently produced
// an empty board, because side and market both resolved to null.
const idOnlyPayload = {
  GameID: 1, HomeTeam: 'LAL', AwayTeam: 'PHX', GameStartTime: '2026-09-09T19:30:00',
  BettingMarkets: [{
    BettingMarketID: 10, BettingBetTypeID: 7, BettingMarketTypeID: 2,
    PlayerID: 101, PlayerName: 'Alpha Beta', TeamKey: 'LAL',
    BettingOutcomes: [
      { BettingOutcomeTypeID: 1, Value: 25.5, SportsBook: { Name: 'DraftKings' }, IsAvailable: true },
      { BettingOutcomeTypeID: 2, Value: 25.5, SportsBook: { Name: 'DraftKings' }, IsAvailable: true },
    ],
  }],
};

const METADATA_PAYLOAD = {
  BettingBetTypes: [{ BettingBetTypeID: 7, Name: 'Points' }],
  BettingOutcomeTypes: [{ BettingOutcomeTypeID: 1, Name: 'Over' }, { BettingOutcomeTypeID: 2, Name: 'Under' }],
  BettingMarketTypes: [{ BettingMarketTypeID: 2, Name: 'Player Prop' }],
  BettingPeriodTypes: [{ BettingPeriodTypeID: 1, Name: 'Full Game' }],
};

test('an ID-only payload yields ZERO offers without metadata — the live bug', () => {
  const offers = normalizePlayerPropOffers(idOnlyPayload, { sport: 'NBA' });
  assert.equal(offers.length, 0, 'this is why the board was empty despite a 200 response');
});

test('the same payload yields real offers once metadata is supplied', () => {
  const metadata = buildMetadata(METADATA_PAYLOAD);
  const offers = normalizePlayerPropOffers(idOnlyPayload, { sport: 'NBA', metadata });

  assert.equal(offers.length, 2, 'over and under both normalise');
  const over = offers.find((o) => o.side === 'OVER');
  assert.ok(over, 'side resolved from the outcome-type table');
  assert.equal(over.line, 25.5);
  assert.equal(over.playerName, 'Alpha Beta');
  assert.match(String(over.market), /Points/i, 'market resolved from the bet-type table');
});

test('metadata parses whether the payload is keyed objects or a flat array', () => {
  const keyed = buildMetadata(METADATA_PAYLOAD);
  assert.equal(keyed.outcomeTypeById.get('1'), 'Over');
  assert.equal(keyed.betTypeById.get('7'), 'Points');

  const flat = buildMetadata([
    { BettingOutcomeTypeID: 1, Name: 'Over' },
    { BettingBetTypeID: 7, Name: 'Points' },
    { BettingMarketTypeID: 2, Name: 'Player Prop' },
  ]);
  assert.equal(flat.outcomeTypeById.get('1'), 'Over');
  assert.equal(flat.betTypeById.get('7'), 'Points');
});

test('unfamiliar or broken metadata degrades to today\'s behaviour, never worse', () => {
  for (const junk of [null, undefined, 'nonsense', 42, {}, [], { Unknown: [{ foo: 1 }] }]) {
    const metadata = buildMetadata(junk);
    assert.ok(isEmptyMetadata(metadata), `should be empty for ${JSON.stringify(junk)}`);
    // Normalisation must still run and still fall back to payload name fields.
    assert.doesNotThrow(() => normalizePlayerPropOffers(idOnlyPayload, { sport: 'NBA', metadata }));
  }
});

test('a payload that already carries names still works with no metadata', () => {
  const named = {
    ...idOnlyPayload,
    BettingMarkets: [{
      ...idOnlyPayload.BettingMarkets[0],
      BettingBetType: 'Points',
      BettingOutcomes: [
        { BettingOutcomeTypeID: 1, BettingOutcomeType: 'Over', Value: 25.5, SportsBook: { Name: 'DraftKings' }, IsAvailable: true },
      ],
    }],
  };
  const offers = normalizePlayerPropOffers(named, { sport: 'NBA' });
  assert.equal(offers.length, 1, 'the name-field fallback is preserved');
  assert.equal(offers[0].side, 'OVER');
});

test('toMap ignores rows with no usable id or name', () => {
  const map = toMap([{ ID: 1, Name: 'Over' }, { ID: 2 }, { Name: 'Orphan' }, null, 'junk']);
  assert.equal(map.size, 1);
  assert.equal(map.get('1'), 'Over');
});

test('a failing metadata request returns empty maps instead of throwing', async () => {
  const loader = createMetadataLoader({
    client: { get: async () => { throw new Error('network down'); } },
    base: 'https://example.invalid',
  });
  const metadata = await loader('NBA', { path: 'nba' });
  assert.ok(isEmptyMetadata(metadata), 'a provider failure must not break the board');
});

test('metadata is fetched once per league and then cached', async () => {
  let calls = 0;
  const loader = createMetadataLoader({
    client: { get: async () => { calls++; return { ok: true, data: METADATA_PAYLOAD }; } },
    base: 'https://example.invalid',
  });
  await loader('NBA', { path: 'nba' });
  await loader('NBA', { path: 'nba' });
  assert.equal(calls, 1, 'reference tables must not be refetched per game');
});
