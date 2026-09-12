import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeResearch, researchTeamMatches } from '../lib/analytics/research.mjs';

test('partial current-season logs populate rolling and season-to-date splits', () => {
  const result = analyzeResearch({
    available: true, line: 20.5, side: 'OVER', season: '2026',
    coverage: { seasonComplete: false }, matchup: { opponent: 'MIN' },
    gameLog: [
      { gameId:'1', date:'2026-09-10T00:00:00Z', season:'2026', opponent:'MIN', value:25 },
      { gameId:'2', date:'2026-09-03T00:00:00Z', season:'2026', opponent:'CHI', value:22 },
      { gameId:'3', date:'2025-12-28T00:00:00Z', season:'2025', opponent:'MIN', value:19 },
      { gameId:'4', date:'2025-12-21T00:00:00Z', season:'2025', opponent:'DET', value:24 },
      { gameId:'5', date:'2025-12-14T00:00:00Z', season:'2025', opponent:'SEA', value:21 },
    ],
  });
  assert.equal(result.windows.l5.games, 5);
  assert.equal(result.windows.l5.hitRate, 80);
  assert.equal(result.windows.season.games, 2);
  assert.equal(result.windows.season.hitRate, 100);
  assert.equal(result.windows.season.average, 23.5);
  assert.equal(result.coverage.seasonPartial, true);
  assert.equal(result.coverage.seasonGames, 2);
  assert.equal(result.h2h.games, 2);
  assert.equal(result.streak.count, 2);
  assert.equal(result.diff.value, 3);
});

test('common cross-provider team abbreviations match', () => {
  assert.equal(researchTeamMatches('GNB', 'GB'), true);
  assert.equal(researchTeamMatches('PHO', 'PHX'), true);
  assert.equal(researchTeamMatches('JAC', 'JAX'), true);
  assert.equal(researchTeamMatches('KC', 'GNB'), false);
});
