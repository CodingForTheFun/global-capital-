// PropLine integration.
//
// The odds response shape is from PropLine's published contract rather than a
// captured live response - the shared demo key was at its daily cap when this
// was built - so these tests pin the two things that matter regardless of shape
// drift: the request budget is respected, and an unreadable payload is counted
// rather than thrown.
import test from 'node:test';
import assert from 'node:assert/strict';
import { __resetProplineClient, proplineGet, proplineHealth, proplineConfigured } from '../lib/data-sources/propline/client.mjs';
import { normalizeEventOdds, mergeNormalized, impliedProbability } from '../lib/data-sources/propline/normalize.mjs';
import { bookKey, isAlternateOutcome, proplineSportKey, sideFromOutcome, sportFromProplineKey, specialFromOddsType } from '../lib/data-sources/propline/markets.mjs';
import { proplineProvider } from '../lib/autoscout/providers/propline.mjs';

const headers = (extra = {}) => ({ get: (name) => (name in extra ? String(extra[name]) : null) });
const ok = (body, extra = {}) => ({ ok: true, status: 200, headers: headers(extra), json: async () => body });

function eventOdds() {
  return {
    id: '210404', sport_key: 'baseball_mlb', commence_time: '2026-09-15T01:40:00+00:00',
    home_team: 'Arizona Diamondbacks', away_team: 'Miami Marlins',
    home_team_key: 'arizona_diamondbacks', away_team_key: 'miami_marlins',
    home_team_id: 'mlb:109', away_team_id: 'mlb:146',
    home_team_logo_url: 'https://cdn.example.test/ari.png', away_team_logo_url: 'https://cdn.example.test/mia.png',
    espn_event_id: '401999999', merged_from_event_ids: ['210399'],
    bookmakers: [
      { key: 'draftkings', title: 'DraftKings', book_event_id: 'dk-event-210404', app_link: 'draftkings://event/210404', markets: [ { key: 'pitcher_strikeouts', title: 'Strikeouts', outcomes: [
        { name: 'Over', description: 'Corbin Burnes', player_id: 'mlb:592450', point: 5.5, price: -115, outcome_id: 'a1', book_outcome_id: 'dk-outcome-a1', last_change_at: '2026-09-15T01:00:00Z', last_seen_at: '2026-09-15T01:01:00Z', book_updated_at: '2026-09-15T00:59:59Z', liquidity: 1250, liquidity_updated_at: '2026-09-15T01:00:02Z', dfs_odds_type: 'standard' },
        { name: 'Under', description: 'Corbin Burnes', player_id: 'mlb:592450', point: 5.5, price: -105, outcome_id: 'a2' },
      ] } ] },
      { key: 'prizepicks', title: 'PrizePicks', markets: [ { key: 'pitcher_strikeouts', title: 'Strikeouts', outcomes: [
        { name: 'Over', description: 'Corbin Burnes', player_id: 'mlb:592450', point: 4.5, price: -119, dfs_odds_type: 'goblin', outcome_id: 'b1' },
      ] } ] },
      { key: 'onexbet', title: '1xBet', markets: [ { key: 'pitcher_strikeouts', outcomes: [
        { name: '5+ Strikeouts', description: 'Corbin Burnes', point: null, price: 186 },
      ] } ] },
    ],
  };
}

test('sport keys map both directions and unknown sports stay unmapped', () => {
  assert.equal(proplineSportKey('MLB'), 'baseball_mlb');
  assert.equal(sportFromProplineKey('baseball_mlb'), 'MLB');
  assert.equal(proplineSportKey('CRICKET'), null);
});

test('book keys are aliased onto the ones this product already stores', () => {
  assert.equal(bookKey('onexbet'), '1xbet');
  assert.equal(bookKey('hardrock'), 'hardrockbet');
  assert.equal(bookKey('draftkings'), 'draftkings', 'an unaliased book must pass through unchanged');
});

test('only Over/Under outcomes become comparable sides', () => {
  assert.equal(sideFromOutcome({ name: 'Over' }), 'OVER');
  assert.equal(sideFromOutcome({ name: 'Under 5.5' }), 'UNDER');
  assert.equal(sideFromOutcome({ name: '5+ Strikeouts' }), null, 'a threshold market has no side to compare');
  assert.equal(sideFromOutcome({ name: 'Yes' }), null);
});

test('Goblin and Demon are read from the field, never inferred', () => {
  assert.equal(specialFromOddsType('goblin'), 'goblin');
  assert.equal(specialFromOddsType('demon'), 'demon');
  assert.equal(specialFromOddsType('standard'), null);
  assert.equal(specialFromOddsType(undefined), null);
});

test('specials and boosted payouts are marked alternate so they stay out of best line', () => {
  assert.equal(isAlternateOutcome({ dfs_odds_type: 'demon' }), true);
  assert.equal(isAlternateOutcome({ payout_multiplier: 1.25 }), true);
  assert.equal(isAlternateOutcome({ payout_multiplier: 1.0 }), false);
  assert.equal(isAlternateOutcome({}), false);
});

test('american prices convert to implied probability on both signs', () => {
  assert.equal(Math.round(impliedProbability(-110) * 1000) / 1000, 0.524);
  assert.equal(Math.round(impliedProbability(+150) * 1000) / 1000, 0.4);
  assert.equal(impliedProbability(null), null);
});

test('an event payload normalizes into board rows', () => {
  const out = normalizeEventOdds(eventOdds(), { sport: 'MLB', ingestedAt: '2026-09-15T02:00:00Z' });
  assert.equal(out.events.length, 1);
  assert.equal(out.events[0].sport, 'MLB');
  assert.equal(out.events[0].homeTeam, 'Arizona Diamondbacks');
  assert.equal(out.events[0].homeTeamKey, 'arizona_diamondbacks');
  assert.equal(out.events[0].awayTeamKey, 'miami_marlins');
  assert.equal(out.events[0].homeTeamProviderId, 'mlb:109');
  assert.equal(out.events[0].homeTeamLogoUrl, 'https://cdn.example.test/ari.png');
  assert.equal(out.events[0].awayTeamLogoUrl, 'https://cdn.example.test/mia.png');
  assert.equal(out.events[0].espnEventId, '401999999');
  assert.deepEqual(out.events[0].mergedFromProviderEventIds, ['210399']);
  assert.equal(out.players.length, 1, 'the same player across books is one player row');
  assert.equal(out.players[0].providerPlayerId, 'mlb:592450', 'the stable league id must survive');
  assert.equal(out.lines.length, 3, 'two DraftKings sides plus the PrizePicks goblin');
  assert.equal(out.skipped.noSide, 1, 'the 5+ threshold outcome has no comparable side and is counted, not thrown');
});

test('current PropLine book ids, freshness and liquidity metadata survive normalization', () => {
  const out = normalizeEventOdds(eventOdds(), { sport: 'MLB' });
  const row = out.lines.find((line) => line.bookmakerKey === 'draftkings' && line.side === 'OVER');
  assert.equal(row.providerOutcomeId, 'a1');
  assert.equal(row.bookOutcomeId, 'dk-outcome-a1');
  assert.equal(row.bookEventId, 'dk-event-210404');
  assert.equal(row.dfsOddsType, 'standard');
  assert.equal(row.liquidity, 1250);
  assert.equal(row.liquidityUpdatedAt, '2026-09-15T01:00:02Z');
  assert.equal(row.bookUpdatedAt, '2026-09-15T00:59:59Z');
  assert.equal(row.lastChangeAt, '2026-09-15T01:00:00Z');
  assert.equal(row.lastSeenAt, '2026-09-15T01:01:00Z');
  assert.equal(row.appLink, 'draftkings://event/210404');
});

test('the goblin line is flagged and separated from the standard prop', () => {
  const out = normalizeEventOdds(eventOdds(), { sport: 'MLB' });
  const goblin = out.lines.find((row) => row.bookmakerKey === 'prizepicks');
  assert.equal(goblin.specialType, 'goblin');
  const goblinProp = out.props.find((prop) => prop.id === goblin.propId);
  assert.equal(goblinProp.isAlternate, true);
  const standard = out.lines.find((row) => row.bookmakerKey === 'draftkings');
  assert.notEqual(standard.propId, goblin.propId, 'an alternate must not merge into the standard prop');
});

test('a payload in an unexpected shape is counted rather than thrown', () => {
  const out = normalizeEventOdds({ id: 'e1', sport_key: 'baseball_mlb', bookmakers: [
    { key: 'draftkings', markets: [ { key: 'x', outcomes: [ { name: 'Over', point: 1.5 }, null, 'nonsense' ] } ] },
  ] }, { sport: 'MLB' });
  assert.equal(out.lines.length, 0);
  assert.ok(out.skipped.noPlayer >= 1, 'a nameless outcome is skipped, not fatal');
});

test('an event with no sport yields nothing instead of throwing', () => {
  const out = normalizeEventOdds({ bookmakers: [] }, {});
  assert.deepEqual(out.lines, []);
  assert.equal(out.skipped.noSport, 1);
});

test('merging events de-duplicates shared rows and sums the skip tally', () => {
  const a = normalizeEventOdds(eventOdds(), { sport: 'MLB' });
  const b = normalizeEventOdds(eventOdds(), { sport: 'MLB' });
  const merged = mergeNormalized([a, b]);
  assert.equal(merged.events.length, 1);
  assert.equal(merged.lines.length, 3);
  assert.equal(merged.skipped.noSide, 2);
});

test('the client sends the key as a header and never in the url', async () => {
  __resetProplineClient();
  process.env.PROPLINE_API_KEY = 'secret-key-value';
  let seenUrl = null; let seenHeaders = null;
  await proplineGet('/v1/sports', {}, { fetcher: async (url, init) => { seenUrl = String(url); seenHeaders = init.headers; return ok([]); } });
  assert.ok(!seenUrl.includes('secret-key-value'), 'the key must never reach a url, log or referrer');
  assert.equal(seenHeaders['x-api-key'], 'secret-key-value');
  delete process.env.PROPLINE_API_KEY;
});

test('repeat calls inside the ttl cost no requests', async () => {
  __resetProplineClient();
  process.env.PROPLINE_API_KEY = 'k';
  let calls = 0;
  const fetcher = async () => { calls += 1; return ok({ n: calls }); };
  await proplineGet('/v1/sports', {}, { fetcher, ttlSeconds: 60 });
  await proplineGet('/v1/sports', {}, { fetcher, ttlSeconds: 60 });
  await proplineGet('/v1/sports', {}, { fetcher, ttlSeconds: 60 });
  assert.equal(calls, 1, 'three asks inside the ttl must be one request');
  assert.equal(proplineHealth().servedFromCache, 2);
  delete process.env.PROPLINE_API_KEY;
});

test('simultaneous identical calls collapse into one request', async () => {
  __resetProplineClient();
  process.env.PROPLINE_API_KEY = 'k';
  let calls = 0;
  const fetcher = async () => { calls += 1; await new Promise((r) => setTimeout(r, 5)); return ok({ ok: true }); };
  await Promise.all([1, 2, 3, 4].map(() => proplineGet('/v1/sports', {}, { fetcher })));
  assert.equal(calls, 1, 'a burst for the same resource is a single request');
  delete process.env.PROPLINE_API_KEY;
});

test('the daily allowance is read from response headers', async () => {
  __resetProplineClient();
  process.env.PROPLINE_API_KEY = 'k';
  await proplineGet('/v1/sports', {}, { ttlSeconds: 0, fetcher: async () => ok([], {
    'x-daily-limit': '25000', 'x-daily-used': '120', 'x-daily-remaining': '24880', 'x-daily-reset': '1789516800',
  }) });
  const quota = proplineHealth().quota;
  assert.equal(quota.limit, 25000);
  assert.equal(quota.remaining, 24880);
  assert.equal(quota.tier, 'pro', 'the limit implies the tier without inspecting the key');
  assert.equal(quota.resetAt, new Date(1789516800 * 1000).toISOString());
  delete process.env.PROPLINE_API_KEY;
});

test('a spent allowance stops requests instead of hammering into 429s', async () => {
  __resetProplineClient();
  process.env.PROPLINE_API_KEY = 'k';
  let calls = 0;
  const fetcher = async () => { calls += 1; return ok([], { 'x-daily-limit': '1000', 'x-daily-used': '1000', 'x-daily-remaining': '0' }); };
  await proplineGet('/v1/first', {}, { fetcher, ttlSeconds: 0 });
  assert.equal(calls, 1);
  await assert.rejects(() => proplineGet('/v1/second', {}, { fetcher }), (error) => error.code === 'PROPLINE_DAILY_LIMIT');
  assert.equal(calls, 1, 'no further request may be sent once the allowance is spent');
  delete process.env.PROPLINE_API_KEY;
});

test('a spent allowance still serves a cached answer rather than failing', async () => {
  __resetProplineClient();
  process.env.PROPLINE_API_KEY = 'k';
  const fetcher = async () => ok({ cached: true }, { 'x-daily-limit': '1000', 'x-daily-remaining': '0' });
  await proplineGet('/v1/sports', {}, { fetcher, ttlSeconds: 600 });
  const again = await proplineGet('/v1/sports', {}, { fetcher, ttlSeconds: 600 });
  assert.deepEqual(again, { cached: true });
  delete process.env.PROPLINE_API_KEY;
});

test('the upgrade url in an error body is not carried into the thrown error', async () => {
  __resetProplineClient();
  process.env.PROPLINE_API_KEY = 'k';
  const body = { detail: { error: 'daily_limit_exceeded', upgrade_url: 'https://prop-line.com/upgrade?email=owner%40example.com' } };
  await assert.rejects(
    () => proplineGet('/v1/sports', {}, { fetcher: async () => ({ ok: false, status: 429, headers: headers(), json: async () => body }) }),
    (error) => error.code === 'PROPLINE_DAILY_LIMIT' && !JSON.stringify(error).includes('example.com'),
  );
  delete process.env.PROPLINE_API_KEY;
});

test('without a key the provider is inert and makes no requests', async () => {
  delete process.env.PROPLINE_API_KEY;
  __resetProplineClient();
  assert.equal(proplineConfigured(), false);
  assert.equal(proplineProvider.isConfigured(), false);
  await assert.rejects(() => proplineGet('/v1/sports'), (error) => error.code === 'PROPLINE_NOT_CONFIGURED');
});

test('the provider satisfies the odds-provider contract', async () => {
  const { validateProvider, PROVIDER_KINDS } = await import('../lib/autoscout/providers/contracts.mjs');
  assert.deepEqual(validateProvider(proplineProvider, PROVIDER_KINDS.ODDS), []);
  assert.ok(proplineProvider.supportedSports.includes('MLB'));
  assert.ok(!proplineProvider.supportedSports.includes('SOCCER'), 'generic SOCCER has no PropLine key and must not claim support');
});

test('an unsupported sport returns an empty board without a request', async () => {
  const board = await proplineProvider.fetchBoard('SOCCER');
  assert.equal(board.meta.supported, false);
  assert.deepEqual(board.data.lines, []);
});
