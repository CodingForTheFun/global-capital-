import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizePrizePicksSpecials, attachPrizePicksSpecialRows } from '../lib/ingestion/prizepicks-specials.mjs';
import { prizePicksSpecialFaceHtml, verifiedPrizePicksSpecial } from '../lib/ui/offer-promotion.mjs';
import { patchRecentFiveUi } from '../lib/autoscout/recent-five-runtime-patch.mjs';

const start = '2026-09-16T20:00:00.000Z';
const raw = (attributes = {}, id = 'special-1') => ({
  data: [{
    id, type: 'projection',
    attributes: { line_score: 24.5, stat_type: 'Points', start_time: start, status: 'pre_game', ...attributes },
    relationships: {
      new_player: { data: { type: 'new_player', id: 'player-1' } },
      game: { data: { type: 'game', id: 'game-1' } },
      league: { data: { type: 'league', id: 'league-1' } },
    },
  }],
  included: [
    { id: 'player-1', type: 'new_player', attributes: { name: 'Test Player', display_name: 'Test Player', team: 'ABC', position: 'G', active: true } },
    { id: 'game-1', type: 'game', attributes: { start_time: start, home_team: 'ABC', away_team: 'XYZ', status: 'scheduled' } },
    { id: 'league-1', type: 'league', attributes: { name: 'NBA' } },
  ],
});

const regularBoard = {
  props: [
    { id: 'regular-over', provider: 'prizepicks', sportsbookKey: 'prizepicks', sportsbook: 'PrizePicks', sport: 'NBA', eventId: 'event-1', playerId: 'normalized-player', playerName: 'Test Player', marketId: 'player_points', market: 'Points', gameStartTime: start, team: 'ABC', homeTeam: 'ABC', awayTeam: 'XYZ', side: 'OVER', line: 27.5, price: null, isAlternate: false },
    { id: 'regular-under', provider: 'prizepicks', sportsbookKey: 'prizepicks', sportsbook: 'PrizePicks', sport: 'NBA', eventId: 'event-1', playerId: 'normalized-player', playerName: 'Test Player', marketId: 'player_points', market: 'Points', gameStartTime: start, team: 'ABC', homeTeam: 'ABC', awayTeam: 'XYZ', side: 'UNDER', line: 27.5, price: null, isAlternate: false },
  ],
  data: { events: [], players: [], props: [], lines: [] },
};

test('PrizePicks odds_type produces a source-labelled alternate, never a regular line', () => {
  const rows = normalizePrizePicksSpecials(raw({ odds_type: 'goblin' }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].specialType, 'goblin');
  assert.equal(rows[0].side, 'OVER');
  assert.equal(rows[0].isAlternate, true);
  assert.equal(rows[0].specialVerified, true);
  assert.equal(rows[0].specialTypeSource, 'projection_odds_type');
});

test('outcome-level metadata binds red/green variants to the exact More/Less side', () => {
  const rows = normalizePrizePicksSpecials(raw({ odds_type: 'demon', more_odds_type: 'demon', less_odds_type: 'goblin' }));
  assert.deepEqual(rows.map(row => [row.side,row.specialType]), [['OVER','demon'],['UNDER','goblin']]);
  assert.ok(rows.every(row => row.specialTypeSource === 'outcome_metadata'));
});

test('Taco/flash-sale and unknown promotions never masquerade as Goblin or Demon', () => {
  assert.equal(normalizePrizePicksSpecials(raw({ odds_type: 'goblin', flash_sale_line_score: 22.5 })).length, 0);
  assert.equal(normalizePrizePicksSpecials(raw({ odds_type: 'demon', label: 'Taco Tuesday' })).length, 0);
  assert.equal(normalizePrizePicksSpecials(raw({ odds_type: 'standard' })).length, 0);
});

test('special rows attach to a verified regular identity without entering normalized line data', () => {
  const special = normalizePrizePicksSpecials(raw({ odds_type: 'goblin', more_odds_type: 'goblin', less_odds_type: 'demon' }));
  const board = attachPrizePicksSpecialRows(regularBoard, special, '2026-09-15T12:00:00.000Z');
  const alternates = board.props.filter(row => row.isAlternate);
  assert.equal(alternates.length, 2);
  assert.deepEqual(alternates.map(row => [row.side,row.specialType]), [['OVER','goblin'],['UNDER','demon']]);
  assert.ok(alternates.every(row => row.eventId === 'event-1' && row.playerId === 'normalized-player' && row.marketId === 'player_points'));
  assert.equal(board.data.lines.length, 0, 'alternates must not become Best Line/consensus line records');
  assert.equal(regularBoard.props.filter(row => !row.isAlternate).length, 2);
});

test('face badges are original red/green SVG faces and expire with the source snapshot', () => {
  const now = Date.parse('2026-09-15T12:05:00.000Z');
  const base = { sportsbookKey: 'prizepicks', isAlternate: true, specialVerified: true, specialSourceId: 's1', side: 'OVER', line: 24.5, gameStartTime: start, ingestedAt: '2026-09-15T12:00:00.000Z' };
  const green = prizePicksSpecialFaceHtml({ ...base, specialType: 'goblin' }, now);
  const red = prizePicksSpecialFaceHtml({ ...base, specialType: 'demon' }, now);
  assert.match(green, /asPpFace goblin/);
  assert.match(green, /currentColor/);
  assert.match(red, /asPpFace demon/);
  assert.doesNotMatch(green + red, /😈|🟢|🔴/);
  assert.equal(verifiedPrizePicksSpecial({ ...base, specialType: 'goblin' }, Date.parse('2026-09-15T12:16:00.000Z')), null);
});

test('board patch keeps special variants outside regular rows and adds the selective hot flame', () => {
  const source = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  const patched = patchRecentFiveUi(source);
  assert.match(patched, /specialRows:specials\.get\(g\.key\)\|\|\[\]/);
  assert.match(patched, /comparisonOffers:g\.rows,rows:dedupeOffers\(g\.rows\)/);
  assert.match(patched, /r5<80\|\|r10<70/);
  assert.match(patched, /🔥/);
  assert.match(patched, /prizePicksSpecialStrip\(g\)/);
  assert.match(patched, /prizePicksSpecialFaceHtml/);
  assert.doesNotMatch(patched, /prizepicks-special-lines\.mjs/);
});
