import test from 'node:test';
import assert from 'node:assert/strict';
import { gameFacts } from '../lib/ml/global/mlb-enrich.mjs';
import { enrichGames } from '../lib/ml/global/scheduler.mjs';
import { buildRows, createContextIndex, trainAndEvaluate } from '../lib/ml/global/model.mjs';

const DAY = 86_400_000;
const T0 = Date.parse('2026-04-01T23:00:00Z');
const team = (name, abbreviation) => ({ id: abbreviation, abbreviation, displayName: name, location: name.split(' ').slice(0, -1).join(' '), name: name.split(' ').slice(-1)[0] });
const CHC = team('Chicago Cubs', 'CHC'), BOS = team('Boston Red Sox', 'BOS');

function summary({ completed = true, homeStarter = 'LHP', awayStarter = 'RHP' } = {}) {
  const box = (t, starterThrows, batters) => ({ team: t, statistics: [
    { type: 'batting', athletes: batters.map((name, i) => ({ athlete: { displayName: name }, starter: true, batOrder: i + 1 })).concat([{ athlete: { displayName: 'Bench Bat' }, starter: false, batOrder: 0 }]) },
    { type: 'pitching', athletes: [{ athlete: { displayName: t.abbreviation + ' Ace', throws: starterThrows }, starter: true }, { athlete: { displayName: 'Reliever', throws: 'LHP' }, starter: false }] },
  ] });
  return { header: { id: '1', competitions: [{ status: { type: { completed } } }] }, boxscore: { players: [box(BOS, homeStarter, ['Roman Anthony', 'Jarren Duran']), box(CHC, awayStarter, ['Pete Crow-Armstrong', 'Seiya Suzuki'])] } };
}

test('box-score facts: starting batters with lineup spots and each side\'s starter hand', () => {
  const f = gameFacts(summary(), 'Boston Red Sox', 'Chicago Cubs');
  assert.deepEqual(f.starters, { 'boston red sox': 'L', 'chicago cubs': 'R' });
  assert.deepEqual(f.lineup['roman anthony'], { team: 'boston red sox', spot: 1 });
  assert.deepEqual(f.lineup['seiya suzuki'], { team: 'chicago cubs', spot: 2 });
  assert.equal(f.lineup['bench bat'], undefined, 'bench players have no lineup spot');
  assert.equal(gameFacts(summary({ completed: false }), 'Boston Red Sox', 'Chicago Cubs'), null);
  assert.equal(gameFacts(summary(), 'Boston Red Sox', 'New York Yankees'), null, 'a team not in the box score fails closed');
});

test('enrichment looks up newest games first, within the cap, and retries unmatched games only later', async () => {
  const obs = Array.from({ length: 10 }, (_, i) => ({ e: 'g' + i, t: T0 + i * DAY, h: 'Boston Red Sox', v: 'Chicago Cubs' }));
  const asked = [];
  const getEnricher = async () => ({ enrich: async (g) => { asked.push(g.e); return g.e === 'g9' ? null : { starters: {}, lineup: { x: { team: 'a', spot: 1 } } }; } });
  const map = {};
  const first = await enrichGames(obs, map, { getEnricher, now: T0 + 20 * DAY, max: 3 });
  assert.deepEqual(first, { looked: 3, added: 2 });
  assert.deepEqual(asked.sort(), ['g7', 'g8', 'g9']);
  asked.length = 0;
  await enrichGames(obs, map, { getEnricher, now: T0 + 21 * DAY, max: 3 });
  assert.ok(!asked.includes('g9'), 'an unmatched game waits before it is tried again');
  let created = 0;
  await enrichGames([], {}, { getEnricher: async () => { created++; return null; }, now: T0, max: 3 });
  assert.equal(created, 0, 'no ESPN client is made when nothing is due');
});

test('hand and lineup features use only earlier games and need enough of them', () => {
  const enrich = {};
  const ctx = createContextIndex({ enrich });
  for (let i = 0; i < 12; i++) {
    const e = 'h' + i, left = i % 2 === 0;
    enrich[e] = { f: { starters: { 'chicago cubs': left ? 'L' : 'R', 'boston red sox': 'R' }, lineup: { 'roman anthony': { team: 'boston red sox', spot: 2 } } } };
    // He hits the over against lefties, never against righties.
    ctx.release({ e, t: T0 + i * DAY, p: 'Roman Anthony', m: 'batter_hits', a: left ? 2 : 0, cp: 0.5, dl: null, h: 'Boston Red Sox', v: 'Chicago Cubs', hs: 5, vs: 3 });
  }
  const vsLeft = ctx.describe({ playerName: 'Roman Anthony', homeTeam: 'Boston Red Sox', awayTeam: 'Chicago Cubs', market: 'batter_hits', t: T0 + 20 * DAY, e: 'next', opposingHand: 'L' });
  const vsRight = ctx.describe({ playerName: 'Roman Anthony', homeTeam: 'Boston Red Sox', awayTeam: 'Chicago Cubs', market: 'batter_hits', t: T0 + 20 * DAY, e: 'next', opposingHand: 'R' });
  assert.ok(vsLeft.vsHand > 0.3 && vsRight.vsHand < -0.3);
  assert.equal(vsLeft.battingSpot, 0.75, 'batting second reads (5 - 2) / 4');
  const noHand = ctx.describe({ playerName: 'Roman Anthony', homeTeam: 'Boston Red Sox', awayTeam: 'Chicago Cubs', market: 'batter_hits', t: T0 + 20 * DAY, e: 'next' });
  assert.equal(noHand.vsHand, null, 'no starter hand, no split');
});

test('on data with a platoon effect, the hand feature beats the same model without it', () => {
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const batters = Array.from({ length: 30 }, (_, i) => ({ name: 'B' + i, lefty: i % 2 === 0, home: i % 3 === 0 }));
  const all = [], enrich = {};
  for (let day = 0; day < 150; day++) {
    const e = 'd' + day, t = T0 + day * DAY, starter = rand() < 0.5 ? 'L' : 'R';
    enrich[e] = { f: { starters: { 'away club': starter, 'home club': 'R' }, lineup: {} } };
    for (const b of batters) {
      enrich[e].f.lineup[b.name.toLowerCase()] = { team: 'home club', spot: 1 + (Number(b.name.slice(1)) % 9) };
      // Same-side matchups are much harder: the classic platoon split.
      const edge = (b.lefty && starter === 'L') || (!b.lefty && starter === 'R') ? -0.25 : 0.25;
      all.push({ e, t, p: b.name, m: 'batter_hits', a: rand() < 0.5 + edge ? 1 : 0, cp: null, cq: null, dl: 0.5, h: 'Home Club', v: 'Away Club', hs: 4, vs: 3 });
    }
  }
  const rows = buildRows(all, { enrich });
  const withHand = trainAndEvaluate(rows).metrics.withoutMarket.model.brier;
  const without = trainAndEvaluate(rows.map((r) => ({ ...r, x: r.x.map((v, i) => (i >= 15 ? 0 : v)) }))).metrics.withoutMarket.model.brier;
  assert.ok(withHand < without - 0.01, `hand Brier ${withHand.toFixed(4)} should clearly beat ${without.toFixed(4)}`);
});
