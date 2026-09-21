import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchFullTeamFiltersUi } from '../lib/autoscout/full-team-filter-runtime-patch.mjs';

const source = () => readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');

test('production advanced filters use the verified full league directory', () => {
  const client = patchFullTeamFiltersUi(source());

  assert.match(client, /function fullTeamFilterOptions\(/);
  assert.match(client, /Array\.isArray\(r\?\.leagueTeams\)/);
  assert.match(client, /fullTeamFilterOptions\(gs,'team',advanced\.team\)/);
  assert.match(client, /fullTeamFilterOptions\(gs,'opponent',advanced\.opponent\)/);
  assert.doesNotMatch(client, /options\(gs\.map\(g=>g\.team\|\|researchFor\(g\)\?\.player\?\.team\),advanced\.team\)/);
  assert.doesNotMatch(client, /options\(gs\.map\(g=>researchFor\(g\)\?\.matchup\?\.opponent\),advanced\.opponent\)/);
});

test('production team filters compare aliases semantically instead of exact strings', () => {
  const client = patchFullTeamFiltersUi(source());

  assert.match(client, /la:\["los","angeles"\]/);
  assert.match(client, /if\(advanced\.team&&!fullTeamFilterSame\(team,advanced\.team\)\)return false/);
  assert.match(client, /if\(advanced\.opponent&&!fullTeamFilterSame\(opp,advanced\.opponent\)\)return false/);
  assert.match(client, /teams:\[\],opponents:\[\],games:/);
  assert.doesNotThrow(() => new Function(client));
});

test('production bootstrap applies the full-team filter patch to the served client', () => {
  const frontdoor = readFileSync(new URL('../frontdoor-clearsports.mjs', import.meta.url), 'utf8');

  assert.match(frontdoor, /patchFullTeamFiltersUi/);
  assert.ok(
    frontdoor.indexOf('patchProplinePushBoardUi(patchedProplineFullUi)') <
      frontdoor.indexOf('patchFullTeamFiltersUi(patchedProplinePushBoardUi)'),
  );
  assert.match(frontdoor, /makeClientSafeVisualUi\(patchedFullTeamFiltersUi\)/);
});
