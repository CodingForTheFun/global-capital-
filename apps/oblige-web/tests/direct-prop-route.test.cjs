const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../lib/prop-route.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
const subject = new Module(path.join(__dirname, 'prop-route-compiled.cjs'), module);
subject._compile(compiled.outputText, subject.filename);
const { researchHref, playerMarkets, selectedProp, optionalNumber, historyMessage } = subject.exports;

function fixture(sport = 'TENNIS', extra = {}) {
  return { key: `${sport}|event-1|player-1|total_games|22.5`, propId: 'prop-1', player: 'Test Player', providerPlayerId: 'player-1', market: 'Total Games', marketId: 'total_games', line: 22.5, sport, team: null, opponent: null, homeTeam: null, awayTeam: null, matchup: 'Test match', startsAt: '2026-09-19T12:30:00Z', live: false, quotes: [{ eventId: 'event-1', sportsbook: 'PrizePicks', sportsbookKey: 'prizepicks', side: 'OVER', line: 22.5 }], bestOver: null, bestUnder: null, ...extra };
}
for (const sport of ['NFL', 'NBA', 'WNBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'TENNIS', 'MLS', 'EPL', 'UCL', 'SOCCER', 'PGA', 'MMA', 'ESPORTS']) {
  test(`${sport}: direct route preserves exact event/player/market/line/side/book`, () => {
    const group = fixture(sport);
    const url = new URL(researchHref(group, 'UNDER', 'prizepicks'), 'https://example.invalid');
    assert.equal(url.pathname, '/research');
    assert.equal(url.searchParams.get('side'), 'UNDER');
    assert.equal(url.searchParams.get('book'), 'prizepicks');
    assert.equal(url.searchParams.get('eventId'), 'event-1');
    assert.equal(url.searchParams.get('providerPlayerId'), 'player-1');
    assert.equal(selectedProp(playerMarkets([group], url.searchParams), url.searchParams), group);
  });
}
test('same name in another event or with another stable identity cannot match', () => {
  const selected = fixture();
  const query = new URL(researchHref(selected), 'https://example.invalid').searchParams;
  const wrongPlayer = fixture('TENNIS', { providerPlayerId: 'different-id' });
  const wrongEvent = fixture('TENNIS', { quotes: [{ eventId: 'different-event' }] });
  assert.deepEqual(playerMarkets([wrongPlayer, wrongEvent, selected], query), [selected]);
});
test('a moved line does not silently substitute another posted line', () => {
  const group = fixture();
  const query = new URL(researchHref(group), 'https://example.invalid').searchParams;
  assert.equal(selectedProp([fixture('TENNIS', { line: 23.5, key: 'moved' })], query), null);
});
test('unidentified namesakes and ambiguous legacy links fail closed', () => {
  const query = new URLSearchParams({ sport: 'TENNIS', player: 'Test Player', market: 'Total Games', line: '22.5' });
  assert.equal(selectedProp(playerMarkets([fixture(), fixture('TENNIS', { key: 'event-2' })], query), query), null);
  assert.equal(playerMarkets([fixture('TENNIS', { player: 'Test Player Jr.' })], query).length, 0);
});
test('null and missing lines do not become zero; real zero survives', () => {
  for (const value of [null, undefined, '', ' ', true, false, 'bad', Infinity]) assert.equal(optionalNumber(value), null);
  assert.equal(optionalNumber(0), 0);
  const group = fixture('MLB', { line: 0 });
  const query = new URL(researchHref(group), 'https://example.invalid').searchParams;
  assert.equal(selectedProp([group], query), group);
});
test('all sport messages use current branding without disguising unavailable data', () => {
  assert.equal(historyMessage('Auto Scout has not verified history.'), 'Oblige Props has not verified history.');
  assert.equal(historyMessage(null), '');
});
test('the board no longer contains an inspector or redundant full-research link', () => {
  const board = fs.readFileSync(path.join(__dirname, '../components/terminal-board.tsx'), 'utf8');
  assert.doesNotMatch(board, /setInspector|function Inspector|Open full player research/);
  assert.match(board, /router\.push\(researchHref/);
  assert.match(board, /onResearch=\{openResearch\}/);
});
