import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchResearchUi } from '../lib/autoscout/research-ui-runtime-patch.mjs';
import { patchFantasyH2HUi } from '../lib/autoscout/fantasy-h2h-runtime-patch.mjs';
import { patchRecentFiveUi } from '../lib/autoscout/recent-five-runtime-patch.mjs';

test('every researched prop card gets a PrizePicks-style recent-five chart from verified history', () => {
  const original = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  const output = patchRecentFiveUi(patchFantasyH2HUi(patchResearchUi(original)));

  assert.match(output, /function recentFiveStrip\(g,r,line,side\)\{/);
  assert.match(output, /Array\.isArray\(r\.gameLog\)\?r\.gameLog\.slice\(0,5\)/,
    'the chart must reuse the existing verified prop history rather than add a provider request');
  assert.match(output, /activeSide==='UNDER'\?value<target:value>target/,
    'hit colouring must follow the currently selected over/under side');
  assert.match(output, /push=target!=null&&value===target/,
    'an exact line result must stay neutral instead of being counted as a hit');
  assert.match(output, /displayTeam\(game\.opponent\)/, 'each recent result must label the opponent');
  assert.match(output, /shortDate\(game\.date\)/, 'each recent result must label the date');
  assert.match(output, /avg last '\+usable\.length/, 'the chart must expose the recent average');
  assert.match(output, /vs displayed '\+esc\(dec\(target,1\)\)\+' line/,
    'the chart must say which current book line is being used');
  assert.match(output, /\+badgeStrip\(g,r,side\)\n  \+recentFiveStrip\(g,r,line,side\)\n  \+staleBadge\(g\)/,
    'recent history belongs directly below the existing stat badges on every card');

  const start = output.indexOf('function recentFiveStrip');
  const end = output.indexOf('function rowHtml', start);
  const recent = output.slice(start, end);
  assert.doesNotMatch(recent, /nativeFetch|fetch\(/, 'rendering last five must not consume API credits');
  assert.match(recent, /if\(!r\|\|!r\.available\)return ''/,
    'unsupported or unverified stat categories must stay fail-closed instead of fabricating history');
  assert.doesNotThrow(() => new Function(output), 'the patched client bundle must remain valid JavaScript');
});

test('recent-five styling stays compact and mobile-first', () => {
  const original = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  const output = patchRecentFiveUi(patchFantasyH2HUi(patchResearchUi(original)));

  assert.match(output, /oblige-recent-five-style/);
  assert.match(output, /grid-template-columns:repeat\(var\(--recent-count,5\),minmax\(0,1fr\)\)/);
  assert.match(output, /@media\(max-width:540px\)/);
  assert.match(output, /\.asRecentFiveGame\.hit \.asRecentFiveBar i/);
  assert.match(output, /\.asRecentFiveGame\.miss \.asRecentFiveBar i/);
  assert.match(output, /\.asRecentFiveGame\.push \.asRecentFiveBar i/);
});
