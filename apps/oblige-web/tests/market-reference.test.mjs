import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLib } from './load-lib.mjs';
const { groupProps } = await loadLib('api');
const { referenceTarget, referenceKey, referenceQuote, marketReferenceFrom, fetchMarketReferences, historyTarget, exactHistory, fetchQuoteHistory } = await loadLib('market-reference');
const { quoteSeenLabel } = await loadLib('prop-signals');

const row = extra => ({ eventId: 'internal-game', provider: 'public', providerEventId: 'other-provider-game', proplineEventId: 'native-game', proplinePlayerId: 'native-player', proplineOutcomeId: 'native-outcome', playerName: 'Test Player', marketId: 'player_points', market: 'Points', line: 20.5, side: 'OVER', price: -110, sportsbookKey: 'draftkings', sportsbook: 'DraftKings', gameStartTime: '2050-10-01T20:00:00Z', ...extra });
const group = extra => groupProps([row(extra)], 'NBA')[0];
const projection = extra => ({ playerName: 'Test Player', playerId: 'native-player', marketKey: 'player_points', projection: 21.2, booksContributing: 4, ...extra });
const play = extra => ({ playerName: 'Test Player', playerId: 'native-player', marketKey: 'player_points', line: 20.5, bookmakerKey: 'draftkings', side: 'OVER', price: -110, evPercent: 3.4, ...extra });

test('references require explicit PropLine provenance, never internal or other-provider IDs', () => {
  assert.equal(referenceTarget(group()).event, 'native-game');
  assert.equal(referenceTarget(group({ proplineEventId: undefined })), null);
  const native = group({ provider: 'propline', proplineEventId: undefined, providerEventId: 'native-fallback' });
  assert.equal(referenceTarget(native).event, 'native-fallback');
  assert.notEqual(referenceKey(native), referenceKey(group({ provider: 'propline', proplineEventId: undefined, providerEventId: 'different-native' })));
});

test('references reject periods, specials, conflict and started games', () => {
  for (const fields of [{ period: 'h1' }, { market: 'Points · First half' }, { marketId: 'player_points_h1' }, { dfsOddsType: 'goblin' }, { dfsOddsType: 'demon' }, { isAlternate: true }, { conflict: true }, { live: true }, { gameStartTime: '2000-01-01' }]) assert.equal(referenceTarget(group(fields)), null, JSON.stringify(fields));
});

test('market reference matches the exact player, market, line, book, side and price', () => {
  const otherProjections = [projection({ playerId: 'different' }), projection({ marketKey: 'player_rebounds' })];
  const otherPlays = [{ playerId: 'different' }, { marketKey: 'player_rebounds' }, { line: 21.5 }, { bookmakerKey: 'fanduel' }, { side: 'UNDER' }, { price: -105 }].map(extra => play({ ...extra, evPercent: 99 }));
  const result = marketReferenceFrom(group(), { projections: [...otherProjections, projection()] }, { plays: [...otherPlays, play()] }, 1000);
  assert.equal(result.projection, 21.2); assert.equal(result.ev, 3.4); assert.equal(result.expiresAt, 61000);
  assert.equal(result.book, 'draftkings'); assert.equal(result.side, 'OVER');
  assert.equal(marketReferenceFrom(group(), { projections: otherProjections }, { plays: otherPlays }).projection, null);
  assert.equal(marketReferenceFrom(group(), { projections: otherProjections }, { plays: otherPlays }).ev, null);
});

test('nulls, redaction and conflicting records stay absent while real zero remains zero', () => {
  const zeros = marketReferenceFrom(group(), { projections: [projection({ projection: 0 })] }, { plays: [play({ evPercent: 0 })] });
  assert.equal(zeros.projection, 0); assert.equal(zeros.ev, 0);
  for (const value of [null, '', false]) {
    const result = marketReferenceFrom(group(), { projections: [projection({ projection: value })] }, { plays: [play({ evPercent: value })] });
    assert.equal(result.projection, null); assert.equal(result.ev, null);
  }
  const conflict = marketReferenceFrom(group(), { projections: [projection(), projection({ projection: 22 })] }, { plays: [play(), play({ evPercent: 10 })] });
  assert.equal(conflict.projection, null); assert.equal(conflict.ev, null);
  const redacted = marketReferenceFrom(group(), { redacted: true, projections: [projection()] }, { plays: [play({ redacted: true })] });
  assert.equal(redacted.projection, null); assert.equal(redacted.ev, null);
});

test('DFS synthetic odds cannot become EV and mixed groups prefer actual sportsbook odds', () => {
  const dfs = group({ sportsbookKey: 'prizepicks', price: 100 });
  assert.equal(marketReferenceFrom(dfs, null, { plays: [play({ bookmakerKey: 'prizepicks', price: 100 })] }).ev, null);
  const under = row({ side: 'UNDER' });
  assert.equal(referenceQuote({ ...dfs, bestUnder: under, quotes: [...dfs.quotes, under] }), under);
});

test('same-event selections share two bounded reads, retain partial data and do not extend cached expiry', async t => {
  let calls = 0;
  const selections = [group({ proplineEventId: 'batch-event' }), group({ proplineEventId: 'batch-event', marketId: 'player_rebounds', market: 'Rebounds' })];
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    calls++;
    const url = new URL(path, 'https://fixture.test');
    assert.equal(url.searchParams.get('eventId'), 'batch-event');
    assert.equal(url.searchParams.get('markets'), 'player_points,player_rebounds');
    assert.equal(options.credentials, 'same-origin');
    return Response.json({ available: true, data: url.searchParams.get('kind') === 'projections' ? { projections: [projection()] } : { plays: [play()] } });
  });
  const first = await fetchMarketReferences(selections);
  const second = await fetchMarketReferences(selections);
  assert.equal(calls, 2);
  assert.equal(first[referenceKey(selections[0])].projection, 21.2);
  assert.equal(first[referenceKey(selections[1])].projection, null);
  assert.equal(first[referenceKey(selections[0])].expiresAt, second[referenceKey(selections[0])].expiresAt);
});

test('one unavailable endpoint does not discard the other endpoint and cancellation publishes nothing', async t => {
  const selection = group({ proplineEventId: 'partial-event' });
  t.mock.method(globalThis, 'fetch', async path => path.includes('kind=ev') ? new Response('not available', { status: 400 }) : Response.json({ available: true, data: { projections: [projection()] } }));
  const result = (await fetchMarketReferences([selection]))[referenceKey(selection)];
  assert.equal(result.projection, 21.2); assert.equal(result.ev, null);
  const controller = new AbortController(); controller.abort(); let published = 0;
  assert.deepEqual(await fetchMarketReferences([selection], controller.signal, () => published++), {});
  assert.equal(published, 0);
});

test('exact outcome history excludes other books, sides, outcomes and missing values', () => {
  const selection = group({ dfsOddsType: 'demon', sportsbookKey: 'prizepicks' });
  const target = historyTarget(selection, selection.quotes[0]);
  assert.ok(target, 'an explicit special outcome can have its own history');
  const point = { outcomeId: 'native-outcome', marketKey: 'player_points', bookmakerKey: 'prizepicks', side: 'OVER', at: '2026-09-20T10:00:00Z', line: 20.5, price: 100, liquidity: 0 };
  const wrong = [{ outcomeId: 'different' }, { side: 'UNDER' }, { bookmakerKey: 'draftkings' }, { marketKey: 'player_rebounds' }, { at: null }, { line: null }, { redacted: true }].map(extra => ({ ...point, ...extra }));
  const result = exactHistory({ points: [...wrong, point, { ...point, at: '2026-09-20T11:00:00Z', line: 21.5 }] }, target);
  assert.deepEqual(result.map(p => p.line), [21.5, 20.5]); assert.equal(result[0].liquidity, 0);
  assert.deepEqual(exactHistory({ redacted: true, points: [point] }, target), []);
  assert.equal(historyTarget(selection, row({ proplineOutcomeId: undefined })), null);
});

test('history service failure is distinguishable from an empty history', async t => {
  const selection = group({ proplineEventId: 'history-unavailable' });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ available: false, data: null }));
  await assert.rejects(fetchQuoteHistory(selection, selection.quotes[0]), /history is unavailable/);
});

test('quote timestamps report observation age without inventing freshness', () => {
  const now = Date.parse('2026-09-20T12:00:00Z');
  assert.equal(quoteSeenLabel({ lastSeenAt: '2026-09-20T11:58:00Z' }, now), 'Seen 2m ago');
  assert.equal(quoteSeenLabel({ providerUpdatedAt: '2026-09-20T10:00:00Z' }, now), 'Updated 2h ago');
  assert.equal(quoteSeenLabel({}, now), null);
  assert.equal(quoteSeenLabel({ lastSeenAt: '2050-01-01' }, now), null);
});
