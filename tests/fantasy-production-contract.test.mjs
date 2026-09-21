import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { BOARD_SPORTS } from '../lib/autoscout/models.mjs';
import { SCOPED_PUBLIC_SPORTS } from '../lib/autoscout/board-coverage-catalog.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const entry = read('frontdoor-clearsports.mjs'), modules = {};
for (const match of entry.matchAll(/^import \{([^}]+)\} from '([^']+)';$/gm)) {
  const names = match[1].split(',').map(name => name.trim()).filter(name => /^patch[A-Z]/.test(name));
  if (!names.length) continue;
  const imported = await import(new URL(match[2], root).href);
  for (const name of names) modules[name] = imported[name];
}
let generated;
vm.runInNewContext(entry.slice(entry.indexOf('function makeClientSafeVisualUi(source) {'), entry.indexOf('\nconst source =')) + '\n' + entry.slice(entry.indexOf('const patchedResearchUi ='), entry.indexOf('// Compose the core patches inline.')), {
  ...modules, uiSourcePath: './apex-v2/scout-ui-v5.js', uiRuntimePath: 'output',
  readFileSync: path => read(path), writeFileSync: (_path, content) => { generated = content; },
});
const fn = (source, name) => {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  const rest = source.slice(start), end = rest.search(/\n(?:async )?function /);
  return end < 0 ? rest : rest.slice(0, end);
};
function harness() {
  const context = vm.createContext({ URLSearchParams, Date, num: value => value == null ? null : Number(value),
    sideRows: (g, side) => g.rows.filter(row => row.side === side), boardLine: () => 20,
    defaultSide: () => 'OVER', bookId: value => value, researchCache: new Map() });
  const helpers = ['propBookFor', 'researchMarketKey', 'researchParams', 'researchKey', 'lineOnlyPolicy', 'researchFor'].map(name => fn(generated, name)).join('\n');
  const arrays = ['boardCoverageResearchSports', 'boardCoverageFantasySports'].map(name => generated.match(new RegExp('var '+name+'=([^;]+);'))[0]).join('\n');
  vm.runInContext('var propBookChoices=new Map();\n'+arrays+'\n'+helpers, context);
  return context;
}
const group = { key: 'player-event-fantasy', sport: 'WNBA', playerName: 'Fixture Player', providerPlayerId: '42', market: 'Fantasy Score', marketId: 'player_fantasy_score', eventId: 'event-123', gameStartTime: '2026-09-10T12:00:00Z', period: 'full_game', rows: ['prizepicks', 'underdog'].map(sportsbookKey => ({ sportsbookKey, side: 'OVER', line: 20 })) };

test('production book changes cannot reuse another platform fantasy cache or queued request', () => {
  const c = harness(), pp = c.researchKey(group, 20, 'OVER');
  c.researchCache.set(pp, { value: { available: true, platform: 'prizepicks' }, expires: Date.now()+10000 });
  c.researchCache.set('base|'+group.key, { value: { available: true, platform: 'prizepicks' }, expires: Date.now()+10000 });
  assert.equal(c.researchFor(group,20,'OVER').platform, 'prizepicks');
  c.propBookChoices.set(group.key,'underdog');
  assert.notEqual(c.researchKey(group,20,'OVER'), pp);
  assert.equal(c.researchFor(group,20,'OVER'), null);
  const q = new URLSearchParams(c.researchParams(group,20,'OVER'));
  assert.equal(q.get('marketId'),'underdog:player_fantasy_score');
  assert.equal(q.get('eventId'),group.eventId);
  assert.equal(q.get('gameStartTime'),group.gameStartTime);
  assert.equal(q.get('period'),'full_game');
  assert.equal(q.get('detail'),null);
  assert.equal(q.get('games'),'40');
  assert.equal(q.get('historyYears'),'1');
  assert.match(fn(generated,'getResearch'), /query:researchParams\(g,valueLine,valueSide,isDetail\)/);
  assert.match(fn(generated,'runResearch'), /research\?'\+job.query/);
  assert.equal(c.researchMarketKey({...group,marketId:'prizepicks:player_fantasy_score'},20,'OVER'),'underdog:player_fantasy_score');
});

test('actual client and server gates admit full-game fantasy across all board sports and preserve scoped restrictions', () => {
  const c = harness(), source = read('frontdoor-prod.mjs');
  const allowLine = source.match(/^const researchSportAllowed = .*;$/m)[0];
  const server = vm.createContext({ BOARD_SPORTS, SCOPED_PUBLIC_SPORTS, RESEARCH_SPORTS: new Set(['NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','TENNIS','SOCCER','MLS','EPL','UCL']) });
  vm.runInContext(allowLine+'\nthis.allowed=researchSportAllowed;',server);
  for (const sport of BOARD_SPORTS) {
    const scoped = !!SCOPED_PUBLIC_SPORTS[sport] || sport.endsWith('SZN');
    assert.equal(c.lineOnlyPolicy({...group,sport}) === null,!scoped,sport);
    assert.equal(server.allowed(sport,'Fantasy Score'),!scoped,sport);
  }
  assert.equal(server.allowed('NOT_A_SPORT','Fantasy Score'),false);
  assert.equal(server.allowed('PGA','Strokes'),false);
});

test('batch request and server parser preserve selected event cutoff and period', () => {
  const body = fn(generated,'hydrateBoard');
  assert.match(body, /eventId:g.eventId\|\|'',gameStartTime:g.gameStartTime\|\|'',period:g.period\|\|''/);
  const source = read('frontdoor-prod.mjs');
  const c = vm.createContext({ researchSportAllowed: () => true });
  // The next declaration is a documentation block; remove it for this pure parser harness.
  vm.runInContext(fn(source,'batchEntry').split('/**')[0], c);
  const result = c.batchEntry({key:'0',...group,line:20,side:'OVER'});
  assert.equal(result.params.eventId,group.eventId);
  assert.equal(result.params.gameStartTime,group.gameStartTime);
  assert.equal(result.params.period,'full_game');
});
