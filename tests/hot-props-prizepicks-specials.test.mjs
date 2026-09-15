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

test('projection-level odds_type is preserved as a line-level variant without guessing More or Less', () => {
  const rows = normalizePrizePicksSpecials(raw({ odds_type: 'goblin' }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].specialType, 'goblin');
  assert.equal(rows[0].side, null);
  assert.equal(rows[0].specialSideVerified, false);
  assert.equal(rows[0].specialTypeSource, 'projection_odds_type');
});

test('outcome-level metadata binds red/green variants to the exact More/Less side', () => {
  const rows = normalizePrizePicksSpecials(raw({ odds_type: 'demon', more_odds_type: 'demon', less_odds_type: 'goblin' }));
  assert.deepEqual(rows.map(row => [row.side,row.specialType]), [['OVER','demon'],['UNDER','goblin']]);
  assert.ok(rows.every(row => row.isAlternate === true && row.specialVerified === true && row.specialSideVerified === true && row.specialTypeSource === 'outcome_metadata'));
});

test('Taco/flash-sale and unknown promotions never masquerade as Goblin or Demon', () => {
  assert.equal(normalizePrizePicksSpecials(raw({ odds_type: 'goblin', flash_sale_line_score: 22.5 })).length, 0);
  assert.equal(normalizePrizePicksSpecials(raw({ odds_type: 'demon', label: 'Taco Tuesday' })).length, 0);
  assert.equal(normalizePrizePicksSpecials(raw({ odds_type: 'standard' })).length, 0);
});

test('line-level and exact-side specials attach without entering normalized line data', () => {
  const lineOnly = normalizePrizePicksSpecials(raw({ odds_type: 'goblin' }, 'line-only'));
  const exact = normalizePrizePicksSpecials(raw({ more_odds_type: 'demon' }, 'exact'));
  const board = attachPrizePicksSpecialRows(regularBoard, [...lineOnly,...exact], '2026-09-15T12:00:00.000Z');
  const alternates = board.props.filter(row => row.isAlternate);
  assert.equal(alternates.length, 2);
  assert.deepEqual(alternates.map(row => [row.side,row.specialType]), [[null,'goblin'],['OVER','demon']]);
  assert.ok(alternates.every(row => row.eventId === 'event-1' && row.playerId === 'normalized-player' && row.marketId === 'player_points'));
  assert.equal(board.data.lines.length, 0, 'alternates must not become Best Line/consensus line records');
  assert.equal(regularBoard.props.filter(row => !row.isAlternate).length, 2);
});

test('many projection-level alternates collapse to the closest line per special type', () => {
  const specials = [
    ...normalizePrizePicksSpecials(raw({ line_score: 19.5, odds_type: 'goblin' }, 'far')),
    ...normalizePrizePicksSpecials(raw({ line_score: 25.5, odds_type: 'goblin' }, 'near')),
  ];
  const board = attachPrizePicksSpecialRows(regularBoard, specials, '2026-09-15T12:00:00.000Z');
  const goblins = board.props.filter(row => row.isAlternate && row.specialType === 'goblin' && row.side == null);
  assert.equal(goblins.length, 1);
  assert.equal(goblins[0].line, 25.5);
  assert.equal(goblins[0].specialSourceId, 'near');
});

test('face badges are original red/green SVG faces and distinguish exact side from line-level metadata', () => {
  const now = Date.parse('2026-09-15T12:05:00.000Z');
  const common = { sportsbookKey: 'prizepicks', isAlternate: true, specialVerified: true, specialSourceId: 's1', line: 24.5, gameStartTime: start, ingestedAt: '2026-09-15T12:00:00.000Z' };
  const greenOffer = { ...common, side: null, specialType: 'goblin', specialSideVerified: false, specialTypeSource: 'projection_odds_type' };
  const redOffer = { ...common, side: 'OVER', specialType: 'demon', specialSideVerified: true, specialTypeSource: 'outcome_metadata' };
  const green = prizePicksSpecialFaceHtml(greenOffer, now);
  const red = prizePicksSpecialFaceHtml(redOffer, now);
  assert.match(green, /asPpFace goblin/);
  assert.match(green, /direction not claimed/);
  assert.match(red, /asPpFace demon/);
  assert.match(red, /More variant/);
  assert.doesNotMatch(green + red, /😈|🟢|🔴/);
  assert.equal(verifiedPrizePicksSpecial(greenOffer, Date.parse('2026-09-15T12:16:00.000Z')), null);
});

test('board patch never labels an unverified line-level variant More or Less', () => {
  const source = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  const patched = patchRecentFiveUi(source);
  assert.match(patched, /specialRows:specials\.get\(g\.key\)\|\|\[\]/);
  assert.match(patched, /comparisonOffers:g\.rows,rows:dedupeOffers\(g\.rows\)/);
  assert.match(patched, /r5<80\|\|r10<70/);
  assert.match(patched, /🔥/);
  assert.match(patched, /row\.side==='UNDER'\?'Less':row\.side==='OVER'\?'More':''/);
  assert.match(patched, /direction\|\|\(row\.specialType==='demon'\?'Demon':'Goblin'\)/);
  assert.match(patched, /prizePicksSpecialFaceHtml/);
});
