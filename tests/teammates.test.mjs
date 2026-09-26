import test from 'node:test';
import assert from 'node:assert/strict';
import { createTeammates, scheduleMatch, teamParticipation } from '../lib/data-sources/espn/teammates.mjs';
import { gatedApi } from '../lib/auth/gate.mjs';

const MIN = { id: '8', abbreviation: 'MIN', displayName: 'Minnesota Lynx', location: 'Minnesota', name: 'Lynx' };
const ATL = { id: '20', abbreviation: 'ATL', displayName: 'Atlanta Dream', location: 'Atlanta', name: 'Dream' };
const CHI = { id: '6', abbreviation: 'CHI', displayName: 'Chicago Sky', location: 'Chicago', name: 'Sky' };
const event = (id, date, away, completed = true) => ({ id, date, competitions: [{ date, status: { type: { completed } }, competitors: [{ homeAway: 'home', team: MIN }, { homeAway: 'away', team: away }] }] });
const box = (id, rows, completed = true) => ({
  header: { id, competitions: [{ date: '2026-06-01T23:00Z', status: { type: { completed } } }] },
  boxscore: { players: [{ team: MIN, statistics: [{ keys: ['minutes', 'points'], athletes: rows }] }, { team: ATL, statistics: [{ keys: ['minutes'], athletes: [] }] }] },
});
const played = (id, name, minutes) => ({ athlete: { id, displayName: name }, didNotPlay: false, stats: [String(minutes), '10'] });
const sat = (id, name) => ({ athlete: { id, displayName: name }, didNotPlay: true, reason: 'KNEE', stats: [] });

test('a row joins one completed schedule game: right opponent, start within three hours', () => {
  const events = [event('1', '2026-06-01T23:00Z', ATL), event('2', '2026-06-03T23:00Z', CHI), event('3', '2026-06-09T23:00Z', ATL, false)];
  assert.equal(scheduleMatch(events, { date: '2026-06-01T23:30:00Z', opponent: 'Atlanta Dream' }, 'MIN', 'WNBA'), '1');
  assert.equal(scheduleMatch(events, { date: '2026-06-01T23:00:00Z', opponent: 'CHI' }, 'MIN', 'WNBA'), null, 'wrong opponent');
  assert.equal(scheduleMatch(events, { date: '2026-06-02T05:00:00Z', opponent: 'ATL' }, 'MIN', 'WNBA'), null, 'six hours off');
  assert.equal(scheduleMatch(events, { date: '2026-06-09T23:00:00Z', opponent: 'ATL' }, 'MIN', 'WNBA'), null, 'not completed');
  // Two games that both fit (a data error) join neither.
  assert.equal(scheduleMatch([...events, event('9', '2026-06-01T22:00Z', ATL)], { date: '2026-06-01T23:00:00Z', opponent: 'ATL' }, 'MIN', 'WNBA'), null);
});

test('box-score participation needs a completed game for this event with the team listed once', () => {
  const summary = box('1', [played('100', 'Star', 30), sat('200', 'Teammate'), { athlete: { id: '300', displayName: 'Unknown' }, stats: [] }]);
  const game = teamParticipation(summary, '1', 'MIN', 'WNBA');
  assert.deepEqual(game.athletes.map((a) => [a.id, a.played, a.minutes, a.reason]), [['100', true, 30, null], ['200', false, 0, 'KNEE']], 'a row with neither flag nor stats is not counted');
  assert.equal(teamParticipation(summary, '2', 'MIN', 'WNBA'), null);
  assert.equal(teamParticipation(box('1', [played('100', 'Star', 30)], false), '1', 'MIN', 'WNBA'), null);
  assert.equal(teamParticipation(summary, '1', 'CHI', 'WNBA'), null);
});

function service(summaries) {
  const calls = [];
  const request = async (path) => {
    calls.push(path);
    if (path.includes('/schedule?')) return { data: { events: [event('1', '2026-06-01T23:00Z', ATL), event('2', '2026-06-03T23:00Z', CHI)] } };
    const id = path.match(/event=(\d+)/)?.[1];
    return { data: summaries[id] || null };
  };
  return { calls, teammates: createTeammates({ request, teamDirectory: async () => [MIN, ATL, CHI] }) };
}

test('a game joins only when the player is listed as having played in it', async () => {
  const { teammates } = service({
    1: box('1', [played('100', 'Star', 30), sat('200', 'Teammate')]),
    2: { ...box('2', [sat('100', 'Star'), played('200', 'Teammate', 25)]), header: { id: '2', competitions: [{ status: { type: { completed: true } } }] } },
  });
  const rows = [{ key: 'pl-a', date: '2026-06-01T23:00:00Z', opponent: 'ATL' }, { key: 'pl-b', date: '2026-06-03T23:00:00Z', opponent: 'CHI' }, { key: 'pl-c', date: '2026-07-01T23:00:00Z', opponent: 'ATL' }];
  const out = await teammates({ sport: 'WNBA', team: 'MIN', games: rows, player: { id: '100', name: 'Star' } });
  assert.equal(out.available, true);
  assert.deepEqual(out.games.map((g) => g.key), ['pl-a'], 'the player sat game 2, and game c has no schedule match');
  assert.equal(out.unmatched, 2);
});

test('football and hockey are not offered, and the route is behind the account gate', async () => {
  const { teammates, calls } = service({});
  const out = await teammates({ sport: 'NFL', team: 'BUF', games: [{ key: 'x', date: '2026-09-01T00:00:00Z', opponent: 'MIA' }], player: { name: 'X' } });
  assert.equal(out.available, false);
  assert.equal(calls.length, 0);
  assert.equal(gatedApi('/api/apex/research-teammates'), true);
});
