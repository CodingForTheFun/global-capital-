import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDraftKingsControlData } from '../lib/ingestion/draftkings-controldata-public.mjs';

function fixture({ alternate = false, twoLines = false } = {}) {
  const event = {
    id: 'evt-1',
    name: 'BUF Bills @ NY Jets',
    startEventDate: '2099-09-13T23:00:00.000Z',
    status: 'NOT_STARTED',
    participants: [
      { type: 'Team', venueRole: 'Away', name: 'BUF Bills' },
      { type: 'Team', venueRole: 'Home', name: 'NY Jets' },
    ],
  };
  const market = { id: 'm-1', eventId: 'evt-1', name: 'Josh Allen Passing Yards', isAlternate: alternate };
  const selections = [
    { marketId: 'm-1', outcomeType: 'Over', label: 'Over 267.5', points: 267.5, main: !twoLines, displayOdds: { american: '-115' } },
    { marketId: 'm-1', outcomeType: 'Under', label: 'Under 267.5', points: 267.5, main: !twoLines, displayOdds: { american: '-105' } },
  ];
  if (twoLines) selections.push(
    { marketId: 'm-1', outcomeType: 'Over', label: 'Over 275.5', points: 275.5, displayOdds: { american: '+100' } },
    { marketId: 'm-1', outcomeType: 'Under', label: 'Under 275.5', points: 275.5, displayOdds: { american: '-120' } },
  );
  return { events: [event], markets: [market], selections };
}

test('controldata parser keeps one verified main over/under player line', () => {
  const parsed = parseDraftKingsControlData('NFL', 'Passing Yards', fixture());
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].playerName, 'Josh Allen');
  assert.equal(parsed.records[0].line, 267.5);
  assert.equal(parsed.records[0].overOdds, -115);
  assert.equal(parsed.records[0].underOdds, -105);
  assert.equal(parsed.records[0].book, 'draftkings');
  assert.equal(parsed.records[0].market, 'Passing Yards');
});

test('controldata parser fails closed on alternate markets', () => {
  const parsed = parseDraftKingsControlData('NFL', 'Passing Yards', fixture({ alternate: true }));
  assert.equal(parsed.records.length, 0);
});

test('controldata parser fails closed when multiple complete ladders have no explicit main pair', () => {
  const parsed = parseDraftKingsControlData('NFL', 'Passing Yards', fixture({ twoLines: true }));
  assert.equal(parsed.records.length, 0);
});
