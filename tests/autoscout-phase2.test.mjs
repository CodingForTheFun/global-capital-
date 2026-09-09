import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateAutoScoutRow, decorateBoardWithScoutAudit } from '../lib/autoscout/scout-rules.mjs';
import { persistenceConfigured, persistenceHealth } from '../lib/autoscout/supabase-persistence.mjs';

test('Auto Scout rule audit exposes PASS/FAIL/UNAVAILABLE instead of inventing research values', () => {
  const row = {
    sport: 'NFL', eventId: 'e1', playerId: 'p1', playerName: 'Test Player', marketId: 'player_pass_yds',
    market: 'Pass Yards', sportsbookKey: 'draftkings', sportsbook: 'DraftKings', side: 'OVER', line: 245.5, price: -110,
    isAlternate: false,
  };
  const audit = evaluateAutoScoutRow(row, [row]);
  assert.equal(audit.classification, 'UNAVAILABLE');
  assert.equal(audit.checks.find((c) => c.id === 'regularLine').status, 'PASS');
  assert.equal(audit.checks.find((c) => c.id === 'l5').status, 'UNAVAILABLE');
  assert.equal(audit.checks.find((c) => c.id === 'h2h').actual, null);
});

test('alternate lines fail the main-line rule when strict rules are enabled', () => {
  const row = { sport: 'NBA', eventId: 'e1', playerId: 'p1', playerName: 'Player', marketId: 'player_points_alternate', market: 'Points', sportsbookKey: 'book', side: 'OVER', line: 21.5, price: -105, isAlternate: true, hitRates: { l5: 90, l10: 90, l15: 90, h2h: 90 }, expectedOutcomeRate: 90 };
  const audit = evaluateAutoScoutRow(row, [row]);
  assert.equal(audit.classification, 'REJECTED');
  assert.equal(audit.checks.find((c) => c.id === 'regularLine').status, 'FAIL');
});

test('complete real research inputs can qualify without a vague hidden score', () => {
  const row = { sport: 'NBA', eventId: 'e1', playerId: 'p1', playerName: 'Player', marketId: 'player_points', market: 'Points', sportsbookKey: 'book', side: 'OVER', line: 21.5, price: -105, isAlternate: false, hitRates: { l5: 85, l10: 80, l15: 80, h2h: 80 }, expectedOutcomeRate: 80 };
  const audit = evaluateAutoScoutRow(row, [row]);
  assert.equal(audit.classification, 'QUALIFIED');
  assert.ok(audit.checks.every((c) => ['PASS','FAIL','UNAVAILABLE'].includes(c.status)));
  assert.equal('score' in audit, false);
});

test('board decoration preserves the underlying feed and only attaches audit metadata', () => {
  const row = { id: 'l1', sport: 'NFL', eventId: 'e1', playerId: 'p1', playerName: 'Player', marketId: 'player_receptions', market: 'Receptions', sportsbookKey: 'draftkings', sportsbook: 'DraftKings', side: 'OVER', line: 4.5, price: -115, isAlternate: false };
  const board = decorateBoardWithScoutAudit({ props: [row], data: { events: [], players: [], props: [], lines: [] }, meta: { provider: 'The Odds API' } });
  assert.equal(board.props.length, 1);
  assert.equal(board.props[0].line, 4.5);
  assert.equal(board.props[0].sportsbook, 'DraftKings');
  assert.equal(board.meta.autoScoutCounts.UNAVAILABLE, 1);
});

test('Supabase persistence is off unless both server-side values are configured', () => {
  const priorUrl = process.env.AUTOSCOUT_SUPABASE_URL;
  const priorKey = process.env.AUTOSCOUT_SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.AUTOSCOUT_SUPABASE_URL;
  delete process.env.AUTOSCOUT_SUPABASE_SERVICE_ROLE_KEY;
  assert.equal(persistenceConfigured(), false);
  assert.equal(persistenceHealth().backend, 'Supabase/PostgreSQL');
  if (priorUrl) process.env.AUTOSCOUT_SUPABASE_URL = priorUrl;
  if (priorKey) process.env.AUTOSCOUT_SUPABASE_SERVICE_ROLE_KEY = priorKey;
});

test('Phase 2 shell contains working explorer controls and no hard-coded provider credential', () => {
  const source = fs.readFileSync(new URL('../apex-v2/scout-ui-v3.js', import.meta.url), 'utf8');
  for (const required of ['AUTO SCOUT RULES','ALT LINES','MAIN ONLY','All games','All prop markets','All sportsbooks','Over + Under','LINE SHOP','FAVORITES','Research Card']) {
    assert.ok(source.includes(required), `missing Phase 2 UI control: ${required}`);
  }
  assert.ok(source.includes('/api/apex/props?sport='));
  assert.ok(source.includes('/api/apex/line-history?propId='));
  assert.equal(/apiKey=|THE_ODDS_API_KEY\s*=/.test(source), false);
});
