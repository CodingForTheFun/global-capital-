import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDraftKings } from '../lib/ingestion/draftkings.mjs';
import { record } from '../lib/ingestion/normalize.mjs';
import { createPublicIngestionRunner } from '../lib/ingestion/public-worker.mjs';

const clock = Date.parse('2026-09-13T18:00:00Z');
const observedAt = new Date(clock).toISOString();
const gameStartTime = new Date(clock + 24 * 3600_000).toISOString();

function dfsRecord(book, sourceId) {
  return record({
    sourceId,
    book,
    nativePlayerId: `${book}-player-1`,
    playerName: 'Fixture Player',
    sport: 'NBA',
    market: 'Points',
    line: 24.5,
    team: 'BOS',
    opponent: 'NYK',
    nativeEventId: 'fixture-event',
    homeTeam: 'BOS',
    awayTeam: 'NYK',
    gameStartTime,
    updatedAt: observedAt,
    sides: ['OVER', 'UNDER'],
  });
}

function dkPayload(lines = [24.5]) {
  return {
    eventGroup: {
      events: [{ eventId: 'dk-event-1', startDate: gameStartTime, homeTeamName: 'Boston Celtics', awayTeamName: 'New York Knicks' }],
      offerCategories: [{
        name: 'Player Props',
        offerSubcategoryDescriptors: [{
          name: 'Points',
          offerSubcategory: {
            offers: lines.map((line, i) => ({
              id: `offer-${i}`,
              eventId: 'dk-event-1',
              outcomes: [
                { label: 'Over', participantName: 'Fixture Player', participantId: 'dk-player-1', line, oddsAmerican: -110 },
                { label: 'Under', participantName: 'Fixture Player', participantId: 'dk-player-1', line, oddsAmerican: -110 },
              ],
            })),
          },
        }],
      }],
    },
  };
}

test('DraftKings adapter accepts one full-game threshold and rejects alternate ladders', () => {
  const regular = normalizeDraftKings(dkPayload([24.5]), 'NBA');
  assert.equal(regular.length, 1);
  assert.equal(regular[0].line, 24.5);
  assert.deepEqual(regular[0].sides.sort(), ['OVER', 'UNDER']);
  assert.equal(regular[0].overOdds, -110);
  assert.equal(regular[0].underOdds, -110);

  const ladder = normalizeDraftKings(dkPayload([24.5, 25.5]), 'NBA');
  assert.deepEqual(ladder, []);
});

test('lease-owned worker persists complete PrizePicks and Underdog snapshots with matching book keys', async () => {
  const old = process.env.AUTOSCOUT_DRAFTKINGS_PUBLIC_ENABLED;
  process.env.AUTOSCOUT_DRAFTKINGS_PUBLIC_ENABLED = 'false';
  const persisted = [];
  const statuses = [];
  let released = null;
  const feeds = {
    async refreshFeed(source) {
      return { status: 'available', partial: false, fetchedAt: observedAt, records: [dfsRecord(source, `${source}-row`)] };
    },
  };
  const runner = createPublicIngestionRunner({
    now: () => clock,
    feeds,
    claim: async () => ({ claimed: true, owner: 'fixture-owner' }),
    release: async (owner) => { released = owner; },
    persistSnapshot: async (source, rows, at) => { persisted.push({ source, rows, at }); return { written: rows.length }; },
    recordStatus: async (source, state) => { statuses.push({ source, state }); },
  });
  try {
    const result = await runner.cycle();
    assert.equal(result.claimed, true);
    assert.equal(released, 'fixture-owner');
    assert.deepEqual(persisted.map((row) => row.source), ['prizepicks', 'underdog']);
    for (const snapshot of persisted) {
      assert.equal(snapshot.at, observedAt);
      assert.ok(snapshot.rows.length > 0);
      assert.ok(snapshot.rows.every((row) => row.sportsbookKey === snapshot.source));
      assert.ok(snapshot.rows.every((row) => row.isAlternate === false));
    }
    assert.equal(statuses.length, 2);
  } finally {
    if (old == null) delete process.env.AUTOSCOUT_DRAFTKINGS_PUBLIC_ENABLED;
    else process.env.AUTOSCOUT_DRAFTKINGS_PUBLIC_ENABLED = old;
  }
});

test('failed or partial public feeds retain the last database snapshot instead of replacing it', async () => {
  const old = process.env.AUTOSCOUT_DRAFTKINGS_PUBLIC_ENABLED;
  process.env.AUTOSCOUT_DRAFTKINGS_PUBLIC_ENABLED = 'false';
  const persisted = [];
  const statuses = [];
  const runner = createPublicIngestionRunner({
    now: () => clock,
    feeds: {
      async refreshFeed(source) {
        if (source === 'prizepicks') return { status: 'available', partial: true, fetchedAt: observedAt, records: [dfsRecord(source, 'partial')] };
        return { status: 'unavailable', partial: false, fetchedAt: observedAt, records: [dfsRecord(source, 'old')] };
      },
    },
    claim: async () => ({ claimed: true, owner: 'fixture-owner' }),
    release: async () => {},
    persistSnapshot: async (...args) => { persisted.push(args); return { written: 0 }; },
    recordStatus: async (source, state) => { statuses.push({ source, state }); },
  });
  try {
    await runner.cycle();
    assert.equal(persisted.length, 0);
    assert.equal(statuses.length, 2);
    assert.ok(statuses.every((row) => row.state.retained === true));
  } finally {
    if (old == null) delete process.env.AUTOSCOUT_DRAFTKINGS_PUBLIC_ENABLED;
    else process.env.AUTOSCOUT_DRAFTKINGS_PUBLIC_ENABLED = old;
  }
});

test('database lease denial prevents every upstream public request', async () => {
  let refreshes = 0;
  const runner = createPublicIngestionRunner({
    feeds: { refreshFeed: async () => { refreshes++; } },
    claim: async () => ({ claimed: false, owner: null }),
    release: async () => {},
    persistSnapshot: async () => { throw new Error('must not persist'); },
    recordStatus: async () => {},
  });
  const result = await runner.cycle();
  assert.equal(result.claimed, false);
  assert.equal(refreshes, 0);
});
