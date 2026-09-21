import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ownsPath } from '../lib/web/new-web.mjs';

test('canonical obligeprops.com frontend owns the Scores route', () => {
  assert.equal(ownsPath('/scores'), true);
});

test('production mobile nav includes Scores between Props and Research', () => {
  const source = readFileSync(new URL('../apps/oblige-web/components/site-chrome.tsx', import.meta.url), 'utf8');
  assert.match(source, /href: '\/board', label: 'Props'/);
  assert.match(source, /href: '\/scores', label: 'Scores'/);
  assert.match(source, /href: '\/research', label: 'Research'/);
  assert.match(source, /grid-cols-5/);
  const props = source.indexOf("{ href: '/board', label: 'Props', icon: LayoutGrid }");
  const scores = source.indexOf("{ href: '/scores', label: 'Scores', icon: Radio }");
  const research = source.indexOf("{ href: '/research', label: 'Research', icon: BarChart3 }");
  assert.ok(props >= 0 && scores > props && research > scores);
});

test('Scores page uses the canonical live score API and strict five-sport contract', () => {
  const source = readFileSync(new URL('../apps/oblige-web/components/scoreboard.tsx', import.meta.url), 'utf8');
  assert.match(source, /sports: 'NFL,NBA,SOCCER,NHL,MLB'/);
  assert.match(source, /fetch\('\/api\/live\?'/);
  assert.match(source, /\{ key: 'soccer', label: 'EPL' \}/);
  assert.match(source, /const FILTERS: ScoreboardFilter\[\] = \['all', 'live', 'finished'\]/);
  assert.doesNotMatch(source, /SportsDataIO/);
});
