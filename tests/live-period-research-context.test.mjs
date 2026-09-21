import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { patchResearchUi } from '../lib/autoscout/research-ui-runtime-patch.mjs';
import { patchFantasyH2HUi } from '../lib/autoscout/fantasy-h2h-runtime-patch.mjs';
import { patchRecentFiveUi } from '../lib/autoscout/recent-five-runtime-patch.mjs';
import { patchLivePeriodResearchUi } from '../lib/autoscout/live-period-research-runtime-patch.mjs';

const base = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
const target = patchLivePeriodResearchUi(
  patchRecentFiveUi(
    patchFantasyH2HUi(
      patchResearchUi(base),
    ),
  ),
);

test('live exact-period overlay composes after existing research patches', () => {
  assert.doesNotThrow(() => new Function(target));
  assert.match(target, /function canonicalPeriod\(value,market\)/);
  assert.match(target, /period==='game'\?base:base\+'\|'\+period/, 'full-game saved prop keys stay backward compatible');
  assert.match(target, /period:canonicalPeriod\(r\.period,r\.market\)/);
  assert.match(target, /opponent:r\.opponent\|\|p\.opponent\|\|''/);
  assert.match(target, /eventId:g\.eventId\|\|'',gameStartTime:g\.gameStartTime\|\|'',period:g\.period\|\|'game'/);
});

test('opened drawer gets detail-only history while board hydration stays bounded', () => {
  assert.match(target, /researchKey\(g,line,side,detail\).*detail\?'detail':'board'/s);
  assert.match(target, /games:detail\?'100':'40',historyYears:detail\?'5':'1'/);
  assert.match(target, /if\(detail\)q\.set\('detail','1'\)/);
  assert.match(target, /getResearch\(g,drawerState\.line,drawerState\.side,false,true\)/);
  assert.match(target, /getResearch\(g,line,side,true,true\)/);
  assert.match(target, /period:g\.period\|\|'',position:g\.position\|\|'',games:40/);
  assert.doesNotMatch(target, /research-batch[\s\S]{0,1400}detail\s*:\s*['"]?1/);
});

test('production frontdoor applies period overlay after the existing visual chain', () => {
  const frontdoor = readFileSync(new URL('../frontdoor-clearsports.mjs', import.meta.url), 'utf8');
  const coverage = frontdoor.indexOf('const client = patchBoardCoverageUi(dockClient);');
  const period = frontdoor.indexOf('const periodClient = patchLivePeriodResearchUi(client);');
  const compile = frontdoor.indexOf('new Function(periodClient)');
  assert.ok(coverage >= 0 && period > coverage && compile > period);
});
