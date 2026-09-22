import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const cardPath = new URL('../apps/oblige-web/components/player-prop-research-card.tsx', import.meta.url);
const viewPath = new URL('../apps/oblige-web/components/player-view.tsx', import.meta.url);
const adaptivePath = new URL('../lib/ml/adaptive.mjs', import.meta.url);

test('production research page uses the live PlayerPropResearchCard', async () => {
  const view = await readFile(viewPath, 'utf8');
  assert.match(view, /PlayerPropResearchCard/);
  assert.doesNotMatch(view, /<PlayerPropDeepDive/);
});

test('research card does not ship screenshot sample data', async () => {
  const card = await readFile(cardPath, 'utf8');
  for (const forbidden of [
    'Adam Mohammed',
    "const targetLine = 14.5",
    "value: '75%'",
    'value="65.9%"',
    'value="34.1%"',
    'value="+7.1%"',
    '11 BOOKS',
  ]) {
    assert.equal(card.includes(forbidden), false, 'forbidden sample leaked: ' + forbidden);
  }
  assert.match(card, /research\?\.gameLog/);
  assert.match(card, /catalogBookRows\(group\.quotes\)/);
  assert.match(card, /expectedValueFor\(modelGroup, prediction/);
  assert.match(card, /\/api\/props\/ml/);
  assert.match(card, /Unavailable/);
});

test('verified history model covers supported soccer and tennis research', async () => {
  const adaptive = await readFile(adaptivePath, 'utf8');
  assert.match(adaptive, /'SOCCER'/);
  assert.match(adaptive, /'TENNIS'/);
  assert.match(adaptive, /values\.length<9/);
  assert.match(adaptive, /Verified game history is unavailable/);
});

test('supporting stats leave out metrics with no verified games', async () => {
  const card = await readFile(cardPath, 'utf8');
  assert.match(card, /output\.filter\(\(metric\) => metric\.sample > 0\)/, 'a tile with no data must not render as "Unavailable"');
  assert.match(card, /No verified stats for this player yet\./, 'an empty set says so instead of showing an empty grid');
});

test('chart labels use a numeric date and a team abbreviation so every game fits', async () => {
  const card = await readFile(cardPath, 'utf8');
  assert.match(card, /\{numericDate\(game\.date\)\}/);
  assert.match(card, /teamShort\(game\.opponent, leagueTeams\)/);
  assert.match(card, /leagueTeams=\{research\?\.leagueTeams \|\| \[\]\}/, 'the chart receives the verified directory');
  assert.doesNotMatch(card, /\? '@' : 'vs'\}\{game\.opponent/, 'the old truncating label is gone');
});

test("a pick'em line never prints 0 as a price", async () => {
  const card = await readFile(cardPath, 'utf8');
  assert.match(card, /price !== 0\) return odds\(price\)/, 'only a real, nonzero price is formatted as odds');
  assert.match(card, /type === 'dfs' \? "Pick'em" : '—'/, "DFS books say Pick'em; any other missing price is a dash");
  assert.doesNotMatch(card, /odds\(heroQuote\.price\)|odds\(over\.price\)|odds\(under\.price\)/, 'no raw price reaches the header or best-price row');
  assert.match(card, /'0 SPORTSBOOKS · ' \+ dfsSource\.toUpperCase\(\) \+ ' LINE'/);
});

test('a chart label is only abbreviated when exactly one directory team matches', async () => {
  const card = await readFile(cardPath, 'utf8');
  assert.match(card, /matches\.length === 1 \? text\(matches\[0\]\?\.abbreviation\) \|\| value : value/);
  assert.doesNotMatch(card, /leagueTeams\.find\(\(team\) => sameTeamLabel/, 'first-match lookup could name the wrong team');
});
