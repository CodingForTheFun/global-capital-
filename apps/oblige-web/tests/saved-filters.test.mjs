import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../lib/api.ts', import.meta.url), 'utf8');
const board = readFileSync(new URL('../components/board-view.tsx', import.meta.url), 'utf8');

test('account preference client uses the authenticated CSRF-protected route', () => {
  assert.match(api, /\/api\/account\/preferences/);
  assert.match(api, /'x-csrf-token': csrfToken/);
  assert.match(api, /csrfToken: body\.csrfToken/);
});

test('board hydrates account-saved views and restores them when switching sports', () => {
  assert.match(board, /fetchAccountPreferences\(controller\.signal\)/);
  assert.match(board, /setSavedBySport\(bySport\)/);
  assert.match(board, /applySavedFilterState\(bySport\[preferredSport\]\)/);
  assert.match(board, /applySavedFilterState\(savedBySport\[nextSport\]\)/);
  assert.match(board, /setSport\(nextSport\)/);
});

test('saving is explicit account sync rather than a write on every filter change', () => {
  assert.match(board, /async function saveCurrentView\(\)/);
  assert.match(board, /saveBoardPreferences\(sport, currentSavedView, account\.csrfToken\)/);
  assert.match(board, /'Save view'/);
  assert.match(board, /Save filters to your account/);
  assert.doesNotMatch(board, /React\.useEffect\([\s\S]{0,500}saveBoardPreferences\(/);
});

test('initial board refresh no longer wipes a restored saved view', () => {
  const start = board.indexOf('const loadBoard = async');
  const end = board.indexOf('void loadBoard(true)', start);
  assert.ok(start >= 0 && end > start);
  const loadBoard = board.slice(start, end);
  assert.doesNotMatch(loadBoard, /setMarketFilter\(ALL\)/);
  assert.doesNotMatch(loadBoard, /setTeamFilter\(ALL\)/);
  assert.doesNotMatch(loadBoard, /setOpponentFilter\(ALL\)/);
  assert.doesNotMatch(loadBoard, /setBookFilter\(ALL\)/);
});
