import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../apps/oblige-web/components/bethoops-board.tsx', import.meta.url), 'utf8');

test('ObligeProps board consumes the authenticated live market stream', () => {
  assert.match(source, /new EventSource\(`\/api\/apex\/stream\?sport=\$\{encodeURIComponent\(sport\)\}`\)/);
  assert.match(source, /addEventListener\('market', refreshQuietly\)/);
  assert.match(source, /addEventListener\('resync', refreshQuietly\)/);
  assert.match(source, /stream\.onopen = \(\) =>/);
  assert.match(source, /stream\.onerror = \(\) =>/);
});

test('stream events are coalesced and periodic polling is only a slower fallback', () => {
  assert.match(source, /STREAM_REFRESH_DEBOUNCE_MS = 500/);
  assert.match(source, /FALLBACK_REFRESH_MS = 60_000/);
  assert.doesNotMatch(source, /AUTO_REFRESH_MS = 15_000/);
  assert.match(source, /if \(streamRefreshTimer !== null\) return/);
});

test('live stream is closed on teardown and board refresh keeps the existing data contract', () => {
  assert.match(source, /stream\?\.close\(\)/);
  assert.match(source, /fetchBoard\(sport, controller\.signal\)/);
  assert.match(source, /setGroups\(board\.groups\)/);
  assert.match(source, /setMeta\(board\.meta\)/);
});
