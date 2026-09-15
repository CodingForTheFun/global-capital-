import test from 'node:test';
import assert from 'node:assert/strict';
import { createEspnLiveProvider, normalizeScoreboard, normalizeSummary } from '../lib/live/espn-provider.mjs';

const feed = { family: 'basketball', league: 'nba', label: 'NBA' };
const scoreboard = {
  events: [{
    id: 'evt1',
    date: '2026-09-15T23:00:00Z',
    competitions: [{
      id: 'cmp1',
      date: '2026-09-15T23:00:00Z',
      playByPlayAvailable: true,
      status: { period: 3, displayClock: '04:21', type: { state: 'in', completed: false, description: 'In Progress', shortDetail: '4:21 - 3rd' } },
      competitors: [
        { homeAway: 'home', score: '88', possession: true, team: { id: '1', abbreviation: 'BOS', displayName: 'Boston Celtics' } },
        { homeAway: 'away', score: '84', team: { id: '2', abbreviation: 'NYK', displayName: 'New York Knicks' } },
      ],
    }],
  }],
};

test('ESPN live scoreboard normalizes state, score, clock and possession', () => {
  const rows = normalizeScoreboard('NBA', feed, scoreboard);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'LIVE');
  assert.equal(rows[0].homeScore, 88);
  assert.equal(rows[0].awayScore, 84);
  assert.equal(rows[0].clock, '04:21');
  assert.equal(rows[0].possession, 'BOS');
  assert.equal(rows[0].eventId, 'evt1');
  assert.equal(rows[0].competitionId, 'cmp1');
});

test('game summary keeps scoring plays, team stats and player box scores', () => {
  const payload = {
    header: { id: 'evt1', competitions: scoreboard.events[0].competitions },
    plays: [{ id: 'p1', text: 'Player makes 3-pt shot', scoringPlay: true, scoreValue: 3, homeScore: '91', awayScore: '84', period: { number: 3 }, clock: { displayValue: '03:55' }, team: { id: '1' } }],
    boxscore: {
      teams: [{ team: { id: '1', abbreviation: 'BOS', displayName: 'Boston Celtics' }, statistics: [{ name: 'fieldGoalPct', label: 'FG%', displayValue: '51.2' }] }],
      players: [{ team: { id: '1', abbreviation: 'BOS', displayName: 'Boston Celtics' }, statistics: [{ name: 'starters', labels: ['MIN', 'PTS'], athletes: [{ athlete: { id: 'a1', displayName: 'Test Player', position: { abbreviation: 'G' } }, starter: true, stats: ['28', '22'] }] }] }],
    },
    leaders: [{ team: { id: '1', abbreviation: 'BOS', displayName: 'Boston Celtics' }, leaders: [{ name: 'points', displayName: 'Points', leaders: [{ athlete: { id: 'a1', displayName: 'Test Player' }, displayValue: '22' }] }] }],
  };
  const detail = normalizeSummary('NBA', feed, payload, { eventId: 'evt1', competitionId: 'cmp1' });
  assert.equal(detail.available, true);
  assert.equal(detail.plays[0].scoringPlay, true);
  assert.equal(detail.teamStats[0].stats[0].value, '51.2');
  assert.equal(detail.playerGroups[0].athletes[0].stats[1], '22');
  assert.equal(detail.leaders[0].athlete.name, 'Test Player');
});

test('public live provider caches repeated scoreboard calls', async () => {
  let calls = 0;
  const provider = createEspnLiveProvider({
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => scoreboard };
    },
    now: () => 1_000,
  });
  await provider.scoreboard('NBA');
  await provider.scoreboard('NBA');
  assert.equal(calls, 1);
});
