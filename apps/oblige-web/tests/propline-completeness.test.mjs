import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLib } from './load-lib.mjs';
const { groupProps, fetchBoard } = await loadLib('api');
const { collapsePlayerCards, playerCategories } = await loadLib('player-cards');
const { legacyPresentation } = await loadLib('legacy-research-presentation');
const { quoteVariant, quotePriceLabel, finiteNumber } = await loadLib('prop-signals');
const { fetchPredictions, predictionKey, predictionTarget, quoteEv, usablePrediction } = await loadLib('model-data');

const row = extra => ({ eventId: 'fixture-event', providerPlayerId: 'fixture-player', playerName: 'Fixture Player', market: 'Points', marketId: 'player_points', line: 20.5, side: 'OVER', price: -110, sportsbookKey: 'draftkings', sportsbook: 'DraftKings', gameStartTime: '2050-10-01T20:00:00Z', ...extra });
const ready = { available: true, code: 'READY', projection: 21, modelVersion: 'fixture-model', validation: { method: 'rolling-player-history' }, expiresAt: '2050-10-01T20:00:00Z', probabilityOver: .5, probabilityUnder: .4, probabilityPush: .1 };
const groups = count => Array.from({ length: count }, (_, i) => groupProps([row({ playerName: `Fixture ${i}`, providerPlayerId: `p${i}` })], 'NBA')[0]);

test('60 selections use 24/24/12 batches and each result keeps its exact selection', async t => {
  const sizes = [];
  const selections = groups(60);
  t.mock.method(globalThis, 'fetch', async (_, init) => {
    const { props } = JSON.parse(init.body); sizes.push(props.length);
    assert.equal(init.credentials, 'same-origin');
    return Response.json({ results: Object.fromEntries(props.map(p => [p.key, { ...ready, projection: Number(p.playerId.slice(1)) }])) });
  });
  const results = await fetchPredictions(selections);
  assert.deepEqual(sizes, [24, 24, 12]);
  selections.forEach((selection, i) => assert.equal(results[predictionKey(selection)].projection, i));
});
test('one failed chunk does not discard successful chunks and can be retried', async t => {
  let call = 0; const selections = groups(60);
  t.mock.method(globalThis, 'fetch', async (_, init) => ++call === 2 ? new Response('busy', { status: 503 }) : Response.json({ results: Object.fromEntries(JSON.parse(init.body).props.map(p => [p.key, ready])) }));
  const results = await fetchPredictions(selections);
  assert.equal(results[predictionKey(selections[0])].available, true);
  assert.equal(results[predictionKey(selections[24])].code, 'MODEL_REQUEST_FAILED');
  assert.equal(results[predictionKey(selections[59])].available, true);
});
test('cancellation stops later batches and publishes no cancelled result', async t => {
  const controller = new AbortController(); let calls = 0, published = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; controller.abort(); throw new DOMException('Aborted', 'AbortError'); });
  assert.deepEqual(await fetchPredictions(groups(60), controller.signal, () => published++), {});
  assert.equal(calls, 1); assert.equal(published, 0);
});
test('deadline includes a stalled response body', async t => {
  t.mock.method(globalThis, 'fetch', async (_, { signal }) => new Response(new ReadableStream({ start(controller) { signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true }); } })));
  const [selection] = groups(1);
  const results = await fetchPredictions([selection], undefined, undefined, 10);
  assert.match(results[predictionKey(selection)].message, /timed out/);
});
test('provider player identity and specials survive board loading without name guessing', async t => {
  t.mock.method(globalThis, 'fetch', async path => {
    assert.match(path, /alternates=1/);
    return Response.json({ props: [row({ providerPlayerId: undefined, playerId: 'exact-internal', period: 'single_stat' })], data: { players: [{ id: 'exact-internal', providerPlayerId: 'native-42' }, { id: 'other', providerPlayerId: 'wrong' }] } });
  });
  const board = await fetchBoard('NBA');
  assert.equal(board.groups[0].providerPlayerId, 'native-42');
  assert.equal(board.groups[0].period, null);
});
test('normal, Goblin, Demon and period lines never collapse into the same quote group', () => {
  const rows = [row(), row({ dfsOddsType: 'goblin', sportsbookKey: 'prizepicks', price: 100 }), row({ dfsOddsType: 'demon', sportsbookKey: 'prizepicks', price: 100 }), row({ period: 'h1' })];
  const board = groupProps(rows, 'NBA');
  assert.equal(board.length, 4);
  const cards = collapsePlayerCards(board, board);
  assert.equal(cards.length, 1); assert.equal(cards[0].specialVariants.length, 2);
  assert.equal(quoteVariant(cards[0].quotes[0]), 'standard');
  assert.equal(playerCategories(board).length, 4);
});
test('a player with only a Demon line remains visible and research preserves its metadata', () => {
  const board = groupProps([row({ sportsbookKey: 'prizepicks', sportsbook: 'PrizePicks', dfsOddsType: 'demon', lineGap: 4, liquidity: 0, providerOutcomeId: 'source-outcome', price: 100, lastSeenAt: '2050-10-01T10:00:00Z' })], 'NBA');
  assert.equal(collapsePlayerCards(board, board).length, 1);
  const categories = playerCategories(board);
  const p = legacyPresentation(categories, board[0], categories[0].key, 'card', 'OVER');
  assert.equal(p.selected.dfsOddsType, 'demon'); assert.equal(p.selected.lineGap, 4); assert.equal(p.selected.liquidity, 0);
  assert.equal(p.selected.outcomeId, 'source-outcome'); assert.equal(p.selected.updatedAt, '2050-10-01T10:00:00Z');
});
test('Underdog multipliers stay separate and no promotion is inferred from a low line', () => {
  const variants = groupProps([row({ sportsbookKey: 'underdog', payoutMultiplier: .8 }), row({ sportsbookKey: 'underdog', payoutMultiplier: 1.2 })], 'NBA');
  assert.equal(variants.length, 2); assert.equal(playerCategories(variants).length, 2);
  assert.equal(quoteVariant(row({ line: .5 })), 'standard');
  assert.equal(quoteVariant(row({ specialType: 'demon', specialVerified: false })), 'standard');
});
test('targets use supplied internal identities when native IDs are absent and preserve alternate scope', () => {
  const g = groupProps([row({ providerPlayerId: undefined, playerId: 'real-internal-id', isAlternate: true, dfsOddsType: 'demon' })], 'NBA')[0];
  assert.equal(predictionTarget(g).payload.playerId, 'real-internal-id');
  assert.equal(predictionTarget(g).payload.isAlternate, true);
  assert.equal(predictionTarget({ ...g, period: 'h1' }).code, 'PERIOD_MODEL_UNAVAILABLE');
});
test('synthetic DFS odds, missing values, pushes and expiry retain their correct meaning', () => {
  const dfs = row({ sportsbookKey: 'prizepicks', price: 100, dfsOddsType: 'goblin' });
  assert.equal(quotePriceLabel(dfs), 'Goblin'); assert.equal(quoteEv(dfs, ready), null);
  assert.ok(Math.abs(quoteEv(row({ price: 100 }), ready) - 10) < 1e-8);
  assert.equal(usablePrediction({ ...ready, expiresAt: '2000-01-01' }), false);
  assert.equal(quoteEv(row(), { ...ready, probabilityPush: 0 }), null);
  assert.equal(finiteNumber(null), null); assert.equal(finiteNumber(''), null); assert.equal(finiteNumber(0), 0);
});
test('forecasts for different books have different cache identities', () => {
  const [selection] = groups(1);
  const other = { ...selection, quotes: [row({ sportsbookKey: 'fanduel' })], bestOver: row({ sportsbookKey: 'fanduel' }) };
  assert.notEqual(predictionKey(selection), predictionKey(other));
});

test('PrizePicks fantasy projection type never becomes a fake game period',async()=>{
 const {quotePeriod}=await loadLib('prop-signals');
 const quote=row({sportsbookKey:'prizepicks',market:'Fantasy Score',marketId:'prizepicks:player_fantasy_score',period:'fantasy_score'});
 assert.equal(quotePeriod(quote),null);
 const [group]=groupProps([quote],'NFL');assert.equal(group.period,null);assert.equal(group.marketId,'prizepicks:player_fantasy_score');
 assert.equal(quotePeriod({...quote,period:'h1'}),'h1');
 assert.equal(quotePeriod({...quote,sportsbookKey:'unknown'}),'fantasy_score');
});
