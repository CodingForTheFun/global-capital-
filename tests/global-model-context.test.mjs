import test from 'node:test';
import assert from 'node:assert/strict';
import { createContextIndex, buildRows, featureVector, predictWith, trainAndEvaluate, FEATURES } from '../lib/ml/global/model.mjs';
import { predictionTarget } from '../lib/ml/contract.mjs';

const DAY = 86_400_000;
const T0 = Date.parse('2026-01-01T00:00:00Z');
const obs = (e, t, p, h, v, a, extra = {}) => ({ e, t, p, m: 'player_points', a, cp: 20.5, cq: null, dl: null, h, v, hs: 100, vs: 95, ...extra });

test('team is the one team in this game and the previous one; unknown with no history or after a trade', () => {
  const ctx = createContextIndex();
  ctx.release(obs('g1', T0, 'Star', 'Hawks', 'Bulls', 22));
  const same = ctx.describe({ playerName: 'Star', homeTeam: 'Knicks', awayTeam: 'Hawks', market: 'player_points', t: T0 + 2 * DAY, e: 'g2' });
  assert.equal(same.team, 'hawks');
  assert.equal(same.home, false);
  assert.equal(Math.round(same.restDays), 2);
  // Neither of the previous game's teams: a trade, so nothing is assumed.
  assert.equal(ctx.describe({ playerName: 'Star', homeTeam: 'Knicks', awayTeam: 'Nets', market: 'player_points', t: T0 + 2 * DAY, e: 'g3' }).team, null);
  assert.equal(ctx.describe({ playerName: 'Nobody', homeTeam: 'Knicks', awayTeam: 'Hawks', market: 'player_points', t: T0 + 2 * DAY, e: 'g4' }).team, null);
  // Same two teams again (a rematch) is ambiguous only if both matched; one side must be unique.
  ctx.release(obs('g5', T0 + DAY, 'Star', 'Hawks', 'Bulls', 18));
  assert.equal(ctx.describe({ playerName: 'Star', homeTeam: 'Hawks', awayTeam: 'Bulls', market: 'player_points', t: T0 + 3 * DAY, e: 'g6' }).team, null, 'both teams were in the last game');
});

test('the target game itself and later games never feed its context', () => {
  const ctx = createContextIndex();
  for (let i = 0; i < 8; i++) {
    ctx.release(obs('a' + i, T0 + i * DAY, 'P' + i, 'Hawks', 'Bulls', 10));
    ctx.release(obs('b' + i, T0 + i * DAY + 1, 'P' + i, 'Hawks', 'Knicks', 30));
  }
  const before = ctx.describe({ playerName: 'P7', homeTeam: 'Hawks', awayTeam: 'Knicks', market: 'player_points', t: T0 + 20 * DAY, e: 'target' });
  // Releasing the target game's own result must not be visible to a describe for that same event.
  ctx.release(obs('target', T0 + 20 * DAY, 'P7', 'Hawks', 'Knicks', 99));
  const after = ctx.describe({ playerName: 'P7', homeTeam: 'Hawks', awayTeam: 'Knicks', market: 'player_points', t: T0 + 20 * DAY, e: 'target' });
  assert.equal(after.restDays, before.restDays, 'rest ignores the target event');
  assert.equal(after.team, before.team);
});

test('opponent allowance needs five recent props and is centred on one half', () => {
  const ctx = createContextIndex();
  // Seven props against the Bulls, all over the line, by players whose team is known.
  for (let i = 0; i < 7; i++) {
    ctx.release(obs('x' + i, T0 + i * DAY, 'Q' + i, 'Hawks', 'Knicks', 18));
    ctx.release(obs('y' + i, T0 + i * DAY + 3600_000, 'Q' + i, 'Hawks', 'Bulls', 30));
  }
  ctx.release(obs('r', T0 + 8 * DAY, 'R', 'Hawks', 'Knicks', 20));
  const c = ctx.describe({ playerName: 'R', homeTeam: 'Hawks', awayTeam: 'Bulls', market: 'player_points', t: T0 + 10 * DAY, e: 'z' });
  assert.ok(c.oppAllow > 0.3, 'a defense everyone beats reads strongly positive');
  const far = ctx.describe({ playerName: 'R', homeTeam: 'Hawks', awayTeam: 'Bulls', market: 'player_points', t: T0 + 200 * DAY, e: 'z2' });
  assert.equal(far.oppAllow, null, 'older than 60 days is not used');
});

test('older artifacts and champions are scored on their own leading columns', () => {
  const x = featureVector({ history: [20, 22, 25, 19, 30], line: 21.5, marketP: 0.55, context: { team: 'a', home: true, restDays: 1, oppAllow: 0.2, oppPointsAllowed: 1, teamPoints: -1 } });
  assert.equal(x.length, FEATURES.length);
  const v1 = [0.1, 1, 0, 0.2, 0.1, 0.1, 0.5, 0.1];
  const p = predictWith(v1, x);
  assert.ok(Number.isFinite(p) && p > 0 && p < 1);
  assert.equal(p, predictWith(v1, x.slice(0, 8)));
});

test('the prediction target carries the game teams only as a pair', () => {
  const base = { sport: 'NBA', eventId: 'e', playerId: 'p', playerName: 'P', marketId: 'player_points', sportsbookKey: 'dk', gameStartTime: '2026-10-01T00:00:00Z', line: 20.5 };
  assert.deepEqual([predictionTarget({ ...base, homeTeam: 'Hawks', awayTeam: 'Bulls' }).homeTeam, predictionTarget({ ...base, homeTeam: 'Hawks', awayTeam: 'Bulls' }).awayTeam], ['Hawks', 'Bulls']);
  assert.equal(predictionTarget({ ...base, homeTeam: 'Hawks' }).homeTeam, undefined);
  assert.equal(predictionTarget({ ...base, homeTeam: 7, awayTeam: 'Bulls' }).homeTeam, undefined);
});

test('on data where the opponent matters, the context features beat the same model without them', () => {
  // Synthetic league: 12 teams, each with a fixed defensive effect; players'
  // results are their own level plus the opponent effect plus noise. No market.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const teams = Array.from({ length: 12 }, (_, i) => 'Team' + i);
  const effect = teams.map((_, i) => (i - 5.5) * 1.6);
  const players = Array.from({ length: 48 }, (_, i) => ({ name: 'P' + i, team: i % 12, level: 18 + (i % 5) }));
  const all = [];
  for (let day = 0; day < 160; day++) {
    for (let g = 0; g < 6; g++) {
      const home = (day + g * 2) % 12, away = (home + 1 + (day % 11)) % 12;
      if (home === away) continue;
      const e = `d${day}g${g}`, t = T0 + day * DAY + g * 60_000;
      for (const pl of players.filter((q) => q.team === home || q.team === away)) {
        const opp = pl.team === home ? away : home;
        const a = Math.round(pl.level + effect[opp] + (rand() - 0.5) * 8);
        all.push({ e, t, p: pl.name, m: 'player_points', a, cp: null, cq: null, dl: pl.level + 0.5, h: teams[home], v: teams[away], hs: 100, vs: 100 });
      }
    }
  }
  const rows = buildRows(all);
  const withContext = trainAndEvaluate(rows);
  const without = trainAndEvaluate(rows.map((r) => ({ ...r, x: r.x.map((v, i) => (i >= 8 ? 0 : v)) })));
  const a = withContext.metrics.withoutMarket.model.brier, b = without.metrics.withoutMarket.model.brier;
  assert.ok(a < b - 0.005, `context Brier ${a.toFixed(4)} should clearly beat ${b.toFixed(4)}`);
});
