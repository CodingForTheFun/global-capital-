import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeResearch } from '../lib/analytics/research.mjs';
import { patchResearchUi } from '../lib/autoscout/research-ui-runtime-patch.mjs';
import { patchFantasyH2HUi } from '../lib/autoscout/fantasy-h2h-runtime-patch.mjs';
import { patchRecentFiveUi } from '../lib/autoscout/recent-five-runtime-patch.mjs';
import { patchNflPercentAndOpponentUi } from '../lib/autoscout/nfl-percent-opponent-runtime-patch.mjs';
import { patchNavAndRingUi } from '../lib/autoscout/nav-ring-runtime-patch.mjs';

test('NFL card ring uses recent rolling history instead of a one-game season sample', () => {
  const rows = [
    { gameId:'2026-1', date:'2026-09-13', value:250, season:'2026', seasonType:2 },
    { gameId:'2025-4', date:'2026-01-03', value:180, season:'2025', seasonType:2 },
    { gameId:'2025-3', date:'2025-12-27', value:240, season:'2025', seasonType:2 },
    { gameId:'2025-2', date:'2025-12-20', value:190, season:'2025', seasonType:2 },
    { gameId:'2025-1', date:'2025-12-13', value:230, season:'2025', seasonType:2 },
  ];
  const research = analyzeResearch({ gameLog: rows, season:'2026', coverage:{ seasonComplete:false } }, 200, 'OVER');
  assert.equal(research.windows.season.games, 1);
  assert.equal(research.windows.season.hitRate, 100, 'week-one season rate can honestly be 100% from one game');
  assert.equal(research.windows.l5.games, 5);
  assert.equal(research.windows.l5.hitRate, 60, 'verified rolling history provides the useful five-game headline');

  const original = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  const output = patchNflPercentAndOpponentUi(patchRecentFiveUi(patchFantasyH2HUi(patchResearchUi(original))));
  assert.match(output, /var ids=\['season','l20','l15','l10','l5'\]/,
    'the general product headline policy must remain unchanged for non-NFL sports');
  assert.match(output, /function ringResearchForSport\(r,sport\)\{/);
  assert.match(output, /toUpperCase\(\)!=='NFL'/, 'the rolling-ring override must be NFL-only');
  assert.match(output, /windows:\{\.\.\.r\.windows,season:null,l20:null,l15:null,l10:null\}/,
    'NFL ring input must expose L5 as the first eligible headline window without mutating research');
  assert.match(output, /gaugeRates\(ringResearchForSport\(r,g\.sport\),side\)/,
    'the card ring must use the sport-scoped research view');
});

test('every prop card can infer and display the opponent from the event matchup', () => {
  const original = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  const output = patchNflPercentAndOpponentUi(patchRecentFiveUi(patchFantasyH2HUi(patchResearchUi(original))));

  assert.match(output, /function cardOpponent\(g,r\)\{/);
  assert.match(output, /researchTeamMatches\(team,home\).*displayTeam\(away\)/s,
    'a home player must automatically point at the away opponent');
  assert.match(output, /researchTeamMatches\(team,away\).*displayTeam\(home\)/s,
    'an away player must automatically point at the home opponent');
  assert.match(output, /class="asOpponentBadge"/,
    'the inferred opponent must be rendered on each prop card when available');
  assert.match(output, /opponent=cardOpponent\(g,r\)/,
    'opponent inference must run for each card, including before research hydration');
});

test('the full production patch chain remains valid client JavaScript', () => {
  const original = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  const research = patchResearchUi(original);
  const fantasy = patchFantasyH2HUi(research);
  const recent = patchRecentFiveUi(fantasy);
  const nflAndOpponent = patchNflPercentAndOpponentUi(recent);
  const finalClient = patchNavAndRingUi(nflAndOpponent);
  assert.match(finalClient, /hits\+misses\+pushes===games/,
    'the existing exact-count ring guard must still apply after the NFL wrapper');
  assert.doesNotThrow(() => new Function(finalClient));
});
