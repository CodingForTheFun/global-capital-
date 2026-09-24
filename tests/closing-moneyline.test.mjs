import test from 'node:test';
import assert from 'node:assert/strict';
import { closingWinProbability, fetchClosingWinProbabilities, MAX_MONEYLINE_EVENTS, __resetClosingMoneyline } from '../lib/data-sources/propline/closing-moneyline.mjs';

const flat = [
  { market: 'h2h', bookmaker: 'draftkings', name: 'Daniil Medvedev', closing_price: -220 },
  { market: 'h2h', bookmaker: 'draftkings', name: 'Valentin Royer', closing_price: 180 },
  { market: 'h2h', bookmaker: 'fanduel', name: 'Daniil Medvedev', closing_price: -250 },
  { market: 'h2h', bookmaker: 'fanduel', name: 'Valentin Royer', closing_price: 200 },
  { market: 'player_aces', bookmaker: 'fanduel', name: 'Over', description: 'Daniil Medvedev', closing_price: -115 },
];

test('no-vig probability averages books that closed both sides', () => {
  const reading = closingWinProbability(flat, 'Daniil Medvedev', 'Valentin Royer');
  // DK: .6875/(.6875+.3571)=.6582; FD: .7143/(.7143+.3333)=.6818 -> mean .67
  assert.equal(reading.winProbability, 67);
  assert.equal(reading.books, 2);
  assert.equal(closingWinProbability(flat, 'Valentin Royer', 'Daniil Medvedev').winProbability, 33);
});

test('grouped bookmaker payloads are read the same way', () => {
  const grouped = { bookmakers: [{ key: 'pinnacle', markets: [{ key: 'h2h', outcomes: [{ name: 'A Player', price: -150 }, { name: 'B Player', price: 130 }] }] }] };
  assert.equal(closingWinProbability(grouped, 'A Player').books, 1);
});

test('one-sided, third-name, conflicting and wrong-opponent books contribute nothing', () => {
  assert.equal(closingWinProbability([{ market: 'h2h', bookmaker: 'x', name: 'A', closing_price: -150 }], 'A'), null);
  assert.equal(closingWinProbability([
    { market: 'h2h', bookmaker: 'x', name: 'A', closing_price: -150 },
    { market: 'h2h', bookmaker: 'x', name: 'B', closing_price: 130 },
    { market: 'h2h', bookmaker: 'x', name: 'C', closing_price: 400 },
  ], 'A'), null);
  assert.equal(closingWinProbability([
    { market: 'h2h', bookmaker: 'x', name: 'A', closing_price: -150 },
    { market: 'h2h', bookmaker: 'x', name: 'A', closing_price: -170 },
    { market: 'h2h', bookmaker: 'x', name: 'B', closing_price: 130 },
  ], 'A'), null);
  assert.equal(closingWinProbability(flat, 'Daniil Medvedev', 'Somebody Else'), null);
  assert.equal(closingWinProbability(flat, 'Not In Match'), null);
});

test('fetch is tennis-only, bounded, cached, and tolerant of a failed event', async () => {
  __resetClosingMoneyline();
  const calls = [];
  const get = async (path, params, options) => {
    calls.push([path, options.ttlSeconds]);
    if (path.includes('/events/bad/')) throw Object.assign(new Error('reserve'), { code: 'PROPLINE_QUOTA_RESERVE' });
    return flat;
  };
  const events = Array.from({ length: 20 }, (_, i) => ({ id: i === 1 ? 'bad' : `e${i}`, opponent: 'Valentin Royer' }));
  const first = await fetchClosingWinProbabilities({ sport: 'TENNIS', player: 'Daniil Medvedev', events }, { get });
  assert.equal(calls.length, MAX_MONEYLINE_EVENTS);
  assert.ok(calls.every(([path, ttl]) => /^\/v1\/sports\/tennis\/events\/[^/]+\/odds\/closing$/.test(path) && ttl >= 7 * 86400));
  assert.equal(first.events.e0.winProbability, 67);
  assert.deepEqual(first.events.bad, { available: false, retryable: true });
  await fetchClosingWinProbabilities({ sport: 'TENNIS', player: 'Daniil Medvedev', events: [{ id: 'e0', opponent: 'Valentin Royer' }] }, { get });
  assert.equal(calls.length, MAX_MONEYLINE_EVENTS, 'a read close is not re-requested');
  const nba = await fetchClosingWinProbabilities({ sport: 'NBA', player: 'X', events: [{ id: 'e1' }] }, { get });
  assert.equal(nba.available, false);
  assert.equal(calls.length, MAX_MONEYLINE_EVENTS);
  const unsafe = await fetchClosingWinProbabilities({ sport: 'TENNIS', player: 'X', events: [{ id: '../../x' }] }, { get });
  assert.deepEqual(unsafe.events, {});
});
