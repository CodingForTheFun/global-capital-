import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chrome = readFileSync(new URL('../apps/oblige-web/components/site-chrome.tsx', import.meta.url), 'utf8');
const screen = readFileSync(new URL('../apps/oblige-web/components/news-screen.tsx', import.meta.url), 'utf8');
const route = readFileSync(new URL('../apps/oblige-web/app/api/news/route.ts', import.meta.url), 'utf8');

test('News is a first-class Oblige Props navigation destination', () => {
  assert.match(chrome, /href: '\/news', label: 'News'/);
  assert.match(chrome, /grid-cols-6/);
  assert.match(chrome, /Newspaper/);
});

test('News screen uses Oblige tokens instead of carrying a separate microsite brand', () => {
  assert.match(screen, /var\(--surface\)/);
  assert.match(screen, /var\(--accent\)/);
  assert.doesNotMatch(screen, /SPORTSWIRE\.LIVE|Institutional-grade|High Bandwidth Feed|REST Endpoints|Latency Check/i);
});

test('News never fabricates backup stories or images when an upstream feed is unavailable', () => {
  assert.doesNotMatch(screen, /BACKUP_FEEDS|unsplash\.com|Full context confirmed/i);
  assert.doesNotMatch(route, /BACKUP_FEEDS|unsplash\.com/);
  assert.match(route, /NEWS_SOURCE_UNAVAILABLE/);
  assert.match(route, /unavailableSports/);
});

test('ESPN requests are server-side and source URLs remain fixed allowlisted endpoints', () => {
  assert.match(route, /site\.api\.espn\.com/);
  assert.match(route, /Promise\.allSettled/);
  assert.match(route, /AbortSignal\.timeout/);
  assert.match(screen, /\/api\/news\?sport=/);
});
