// A player prop only exists in a window around its game: books post props a day
// or two out and pull them once play starts. Asking outside that window spends a
// request to be told nothing.
//
// The selection was worse than idle polling, because sorting by start time
// ascending put FINISHED games at the front of the event budget while the games
// people are actually betting fell off the end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectEventWindow } from '../lib/autoscout/providers/propline.mjs';

const NOW = Date.parse('2026-09-16T18:00:00Z');
const at = (hours) => new Date(NOW + hours * 3_600_000).toISOString();
const ev = (id, hours) => ({ id, commence_time: at(hours) });

test('a finished game never consumes a request', () => {
  const out = selectEventWindow([ev('finished', -6), ev('tonight', 3)], { now: NOW });
  assert.deepEqual(out.events.map((e) => e.id), ['tonight']);
  assert.equal(out.started, 1);
});

test('finished games no longer crowd out tonight by sorting first', () => {
  const events = [ev('a', -8), ev('b', -7), ev('c', -6), ev('tonight', 2)];
  const out = selectEventWindow(events, { now: NOW, limit: 3 });
  assert.ok(out.events.some((e) => e.id === 'tonight'), 'tonight must survive a budget of three');
  assert.equal(out.events.length, 1);
});

test('a game beyond the horizon is left for later', () => {
  const out = selectEventWindow([ev('soon', 6), ev('next week', 200)], { now: NOW, horizon: 48 });
  assert.deepEqual(out.events.map((e) => e.id), ['soon']);
  assert.equal(out.nextEventAt, at(200));
});

test('a just-started game is still allowed through the grace period', () => {
  const out = selectEventWindow([ev('kickoff', -0.1)], { now: NOW, grace: 15 });
  assert.equal(out.events.length, 1);
  const past = selectEventWindow([ev('kickoff', -0.1)], { now: NOW, grace: 0 });
  assert.equal(past.events.length, 0);
});

test('soonest first inside the window, so a truncated budget keeps the nearest games', () => {
  const out = selectEventWindow([ev('late', 40), ev('early', 1), ev('mid', 20)], { now: NOW, limit: 2 });
  assert.deepEqual(out.events.map((e) => e.id), ['early', 'mid']);
});

test('an unparseable start time is kept rather than silently dropped', () => {
  // Losing a game to a date-format change upstream would be invisible.
  const out = selectEventWindow([{ id: 'nodate' }, ev('tonight', 2)], { now: NOW });
  assert.equal(out.events.length, 2);
});

test('an off-season reports nothing ahead at all', () => {
  const out = selectEventWindow([ev('over', -240)], { now: NOW });
  assert.equal(out.events.length, 0);
  assert.equal(out.nextEventAt, null, 'null is what lets the scheduler back off hard');
});

test('an event with no id is discarded', () => {
  const out = selectEventWindow([{ commence_time: at(2) }, ev('real', 2)], { now: NOW });
  assert.deepEqual(out.events.map((e) => e.id), ['real']);
});

test('a malformed list degrades to nothing rather than throwing', () => {
  for (const input of [null, undefined, 'nonsense', [null, 7]]) {
    assert.equal(selectEventWindow(input, { now: NOW }).events.length, 0);
  }
});

test('no odds requests are made when nothing is in the window', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../lib/autoscout/providers/propline.mjs', import.meta.url), 'utf8');
  assert.match(source, /if \(!ordered\.length\) \{\s*\n\s*return emptyBoard/,
    'an empty window must return before spending a request per event');
});
