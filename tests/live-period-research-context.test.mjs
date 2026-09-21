import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');

test('live board keeps period props distinct and carries exact detail context', () => {
  assert.match(source, /function canonicalPeriod\(value,market\)/);
  assert.match(source, /groupKey\(r\)\{var base=\[r\.sport,r\.eventId,r\.playerId\|\|r\.playerName,r\.marketId\|\|r\.market\]\.join\('\|'\),period=canonicalPeriod\(r\.period,r\.market\);return period==='game'\?base:base\+'\|'\+period;\}/);
  assert.match(source, /period:canonicalPeriod\(r\.period,r\.market\)/);
  assert.match(source, /period==='game'\?base:base\+'\|'\+period/, 'full-game saved prop keys stay backward compatible');
  assert.match(source, /eventId:g\.eventId\|\|'',gameStartTime:g\.gameStartTime\|\|'',period:g\.period\|\|'game'/);
});

test('live player drawer uses detail-only period fallback without widening board hydration', () => {
  assert.match(source, /researchKey\(g,line,side,detail\).*detail\?'detail':'board'/s);
  assert.match(source, /if\(detail\)q\.set\('detail','1'\)/);
  assert.match(source, /getResearch\(g,drawerState\.line,drawerState\.side,false,true\)/);
  assert.match(source, /getResearch\(g,line,side,true,true\)/);
  assert.match(source, /period:g\.period\|\|'game',games:40/);
  assert.doesNotMatch(source, /research-batch[\s\S]{0,1200}detail\s*:\s*['"]?1/);
});
