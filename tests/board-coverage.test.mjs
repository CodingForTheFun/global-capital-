import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { BOARD_SPORTS, PUBLIC_FEED_SPORTS, SUPPORTED_SPORTS, AUTOMATIC_SPORTS } from '../lib/autoscout/models.mjs';
import { ADDITIONAL_PUBLIC_SPORTS, SCOPED_PUBLIC_SPORTS, auditBoardCoverage } from '../lib/autoscout/board-coverage-catalog.mjs';
import { patchBoardCoverageUi } from '../lib/autoscout/board-coverage-runtime-patch.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const observedSportCodes = [
  'NFL','NCAAF','CS2','CS','WNBA','MLB','VAL','CFB1H','LOL','NHLSZN','TENNIS',
  'NFL1H','SOCCER','NFL1Q','PGA','EPL','KBO','NBASZN','WNBA1H','FIFA','AFL',
  'EUROGOLF','MMA','NBA','BAD','UFC','DARTS','TT','BANANA BALL','NASCAR','DOTA',
  'LAX','CFL','NPB','WNBA1Q','F1SZN','MOTORCYCLE',
];

test('every observed source sport can be served without enlarging paid or automatic sports', () => {
  for (const sport of [...observedSportCodes, 'RL', 'MLBLIVE']) {
    assert.ok(BOARD_SPORTS.includes(sport), `${sport} must not be stranded by the route allowlist`);
  }
  assert.equal(new Set(BOARD_SPORTS).size, BOARD_SPORTS.length);
  assert.deepEqual(AUTOMATIC_SPORTS, ['NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB']);
  assert.deepEqual(SUPPORTED_SPORTS, ['NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','SOCCER','MLS','EPL','UCL','TENNIS']);
  for (const sport of [...ADDITIONAL_PUBLIC_SPORTS, ...Object.keys(SCOPED_PUBLIC_SPORTS)]) {
    assert.ok(PUBLIC_FEED_SPORTS.includes(sport));
    assert.ok(!SUPPORTED_SPORTS.includes(sport), `${sport} must not enable paid provider polling`);
  }
});

test('scope metadata is explicit and MLBLIVE does not invent an inning', () => {
  assert.equal(SCOPED_PUBLIC_SPORTS.NFL1H.period, 'h1');
  assert.equal(SCOPED_PUBLIC_SPORTS.NFL1Q.period, 'q1');
  assert.equal(SCOPED_PUBLIC_SPORTS.WNBA1H.period, 'h1');
  assert.equal(SCOPED_PUBLIC_SPORTS.WNBA1Q.period, 'q1');
  assert.equal(SCOPED_PUBLIC_SPORTS.CFB1H.period, 'h1');
  assert.equal(SCOPED_PUBLIC_SPORTS.NBASZN.period, 'season');
  assert.equal(SCOPED_PUBLIC_SPORTS.NHLSZN.period, 'season');
  assert.equal(SCOPED_PUBLIC_SPORTS.MLBLIVE.period, undefined);
  assert.ok(Object.isFrozen(SCOPED_PUBLIC_SPORTS));
});

test('coverage diagnostic reports future unknown tags without promoting or exposing rows', () => {
  const now = Date.parse('2026-09-18T01:27:26Z');
  const future = '2026-09-18T01:45:00Z';
  const rows = [
    { sport: 'NFL', expires_at: future, player_id: 'private-unneeded-identifier' },
    { sport: 'RL', expires_at: future },
    { sport: 'CFB1H', expires_at: future },
    { sport: 'NEW_SOURCE_TAG', expires_at: future },
    { sport: 'NEW_SOURCE_TAG', expires_at: future },
    { sport: 'UNKNOWN_EXPIRED', expires_at: '2026-09-18T01:00:00Z' },
    { sport: 'UNKNOWN_EXACT_EXPIRY', expires_at: new Date(now).toISOString() },
    { sport: 'MISSING_EXPIRY' }, null,
  ];
  const before = JSON.stringify(rows);
  const audit = auditBoardCoverage(rows, BOARD_SPORTS, now);
  assert.equal(audit.active, 5);
  assert.equal(audit.reachable, 3);
  assert.equal(audit.unreachable, 2);
  assert.deepEqual(audit.missingBySport, [{ sport: 'NEW_SOURCE_TAG', count: 2 }]);
  assert.ok(!JSON.stringify(audit).includes('private-unneeded-identifier'));
  assert.equal(JSON.stringify(rows), before);
  assert.ok(!BOARD_SPORTS.includes('NEW_SOURCE_TAG'));
  assert.throws(() => auditBoardCoverage([], BOARD_SPORTS, 'invalid'), /valid audit time/);
});

// This small browser harness is intentionally synthetic, not production data.
// The separate composition test below applies the actual checked-in entrypoint.
function fixture() {
  return `var SPORTS=['NFL'];
function groups(allBooks=false){return baseGroups;}
function renderSports(){return SPORTS.map(v=>'<option value="'+v+'">'+v+'</option>').join('')+SPORTS.map(s=>'<button data-sport="'+s+'">'+s+'</button>').join('');}
function viewGroups(){return groups();}
function lineOnlyPolicy(g){return null;}
function propRoute(){try{var match=location.hash.match(/^#prop\\/([^/]+)\\/(.+)$/);return match&&SPORTS.includes(match[1])?{sport:match[1],key:decodeURIComponent(match[2])}:null;}catch{return null;}}
`;
}
function browserHarness(baseGroups = []) {
  const context = vm.createContext({ baseGroups, location: { hash: '' }, esc: (value) => String(value) });
  vm.runInContext(patchBoardCoverageUi(fixture()), context);
  return context;
}

test('scoped card labels do not change the original sport, saved key or source offers', () => {
  const rows = Object.freeze([Object.freeze({ id: 'source-line', period: 'game', line: 10.5 })]);
  const base = Object.freeze({ key: 'NFL1H|event|player|market', sport: 'NFL1H', eventId: 'event', playerId: 'player', marketId: 'player_pass_yds', market: 'Pass Yards', rows });
  const fullGame = Object.freeze({ ...base, key: 'NFL|event|player|market', sport: 'NFL' });
  const context = browserHarness([base, fullGame]);
  const result = context.groups();
  assert.equal(result[0].market, '1st half · Pass Yards');
  assert.equal(result[0].period, 'h1');
  assert.equal(result[0].sport, 'NFL1H');
  assert.equal(result[0].key, base.key);
  assert.equal(result[0].eventId, base.eventId);
  assert.equal(result[0].playerId, base.playerId);
  assert.equal(result[0].marketId, base.marketId);
  assert.equal(result[0].rows, rows);
  assert.equal(base.market, 'Pass Yards');
  assert.equal(base.period, undefined);
  assert.equal(result[1], fullGame);
  assert.equal(context.groups()[0].market, '1st half · Pass Yards');
});

test('new source sports and periods stay line-only; ordinary supported research remains delegated', () => {
  const context = browserHarness();
  for (const sport of [...ADDITIONAL_PUBLIC_SPORTS, ...Object.keys(SCOPED_PUBLIC_SPORTS), 'F1SZN']) {
    const result = context.lineOnlyPolicy({ sport });
    assert.equal(result.available, false, sport);
    assert.equal(result.lineOnly, true, sport);
    assert.equal(result.retryable, false, sport);
    assert.equal(result.code, 'HISTORICAL_SOURCE_UNVERIFIED', sport);
  }
  assert.equal(context.lineOnlyPolicy({ sport: 'NFL' }), null);
  assert.equal(context.lineOnlyPolicy({ sport: 'WNBA' }), null);
});

test('scope labels appear in both sports controls and multiword native tags keep deep links', () => {
  const context = browserHarness();
  const html = context.renderSports();
  assert.match(html, /value="NFL1H">NFL · 1st half<\/option>/);
  assert.match(html, /data-sport="WNBA1Q">WNBA · 1st quarter<\/button>/);
  assert.match(html, /value="RL">Rocket League<\/option>/);
  context.location.hash = '#prop/BANANA%20BALL/player%7Cevent%7Cmarket';
  assert.equal(context.propRoute().sport, 'BANANA BALL');
  assert.equal(context.propRoute().key, 'player|event|market');
  context.location.hash = '#prop/%ZZ/invalid';
  assert.equal(context.propRoute(), null);
  context.location.hash = '#prop/UNSUPPORTED/invalid';
  assert.equal(context.propRoute(), null);
});

test('patch is idempotent, validates anchors and introduces no new network or timer operations', () => {
  const result = patchBoardCoverageUi(fixture());
  assert.equal(patchBoardCoverageUi(result), result);
  assert.throws(() => patchBoardCoverageUi(''), /sport list/);
  assert.throws(() => patchBoardCoverageUi(fixture().replace('function groups(allBooks=false){', 'function changedGroups(){')), /base board grouping/);
  assert.doesNotMatch(result, /\b(?:fetch|setInterval|setTimeout|addEventListener)\s*\(/);
  assert.doesNotThrow(() => new Function(result));
});

test('actual production entrypoint composes and compile-checks the entire serving coverage UI', async () => {
  const entry = read('frontdoor-clearsports.mjs');
  const modules = {};
  // Import only pure patch exports. Never start servers, ingestion, monitors or
  // call any authenticated provider as part of a release test.
  for (const match of entry.matchAll(/^import \{([^}]+)\} from '([^']+)';$/gm)) {
    const names = match[1].split(',').map((name) => name.trim()).filter((name) => /^patch[A-Z]/.test(name));
    if (!names.length) continue;
    const imported = await import(new URL(match[2], root).href);
    for (const name of names) {
      assert.equal(typeof imported[name], 'function', name);
      modules[name] = imported[name];
    }
  }
  const safeStart = entry.indexOf('function makeClientSafeVisualUi(source) {');
  const safeEnd = entry.indexOf('\nconst source =', safeStart);
  const uiStart = entry.indexOf('const patchedResearchUi =');
  const uiEnd = entry.indexOf('// Compose the core patches inline.', uiStart);
  assert.ok(safeStart >= 0 && safeEnd > safeStart, 'actual client safety function must be found');
  assert.ok(uiStart >= 0 && uiEnd > uiStart, 'actual full UI composition must be found');
  const writes = [];
  const sandbox = {
    ...modules,
    uiSourcePath: './apex-v2/scout-ui-v5.js', uiRuntimePath: './.scout-ui-v5-runtime.js',
    readFileSync(path, encoding) {
      assert.equal(path, './apex-v2/scout-ui-v5.js');
      assert.equal(encoding, 'utf8');
      return read('apex-v2/scout-ui-v5.js');
    },
    writeFileSync(path, content, encoding) { writes.push({ path, content, encoding }); },
  };
  vm.runInNewContext(entry.slice(safeStart, safeEnd) + '\n' + entry.slice(uiStart, uiEnd), sandbox, { timeout: 15000 });
  assert.equal(writes.length, 1);
  const generated = writes[0].content;
  assert.equal(writes[0].path, './.scout-ui-v5-runtime.js');
  assert.equal(writes[0].encoding, 'utf8');
  assert.doesNotThrow(() => new Function(generated));
  const sports = generated.match(/var SPORTS=(\[[^\]\r\n]*\]);/);
  assert.ok(sports, 'served sports must be embedded');
  assert.deepEqual(JSON.parse(sports[1]), BOARD_SPORTS);
  assert.equal((generated.match(/var boardCoverageSportLabels=/g) || []).length, 1);
  assert.match(generated, /boardCoverageSportLabel\(v\)/);
  assert.match(generated, /boardCoverageSportLabel\(s\)/);
  assert.match(generated, /scope\.marketPrefix\+' · '\+g\.market/);
  assert.match(generated, /!boardCoverageResearchSports\.includes\(coverageSport\)/);
  assert.match(generated, /decodeURIComponent\(match\[1\]\)/);
  assert.match(generated, /research\?\.lineOnly/);
  assert.equal(patchBoardCoverageUi(generated), generated);
});
