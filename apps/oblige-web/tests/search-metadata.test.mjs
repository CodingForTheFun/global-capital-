import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('public homepage has canonical and social metadata without changing the board layout', () => {
  const page = read('../app/page.tsx');
  assert.match(page, /alternates: \{ canonical: '\/' \}/);
  assert.match(page, /Player Prop Research & Sportsbook Line Comparison/);
  assert.match(page, /openGraph:/);
  assert.match(page, /twitter:/);
  assert.match(read('../app/layout.tsx'), /metadataBase: new URL\('https:\/\/www\.obligeprops\.com'\)/);
});

test('authenticated utility routes are noindex without blocking Google from reading that directive', () => {
  for (const path of ['account', 'board', 'research']) {
    assert.match(read(`../app/${path}/page.tsx`), /robots:\s*\{\s*index:\s*false/);
  }
});

test('public QA uses a semantic board marker and exact revision, not obsolete marketing titles', () => {
  assert.match(read('../app/board/page.tsx'), /'oblige-surface': 'prop-board'/);
  assert.match(read('../app/api/frontend-health/route.ts'), /revision: process\.env\.RAILWAY_GIT_COMMIT_SHA \|\| null/);
  const workflow = read('../../../.github/workflows/restore-terminal-photos.yml');
  assert.doesNotMatch(workflow, /<title>Research Terminal/);
  assert.match(workflow, /revision===process\.env\.GITHUB_SHA/);
  assert.match(workflow, /response\.headers\.get\('x-oblige-revision'\)/);
  assert.doesNotMatch(workflow, /origin\+'\/api\/frontend-health'/);
  const cards = read('../../../scripts/verify-player-cards-live.mjs');
  assert.doesNotMatch(cards, /html\.includes\('Research Terminal'\)/);
  assert.match(cards, /data-player-card/);
  assert.match(cards, /report\.observedCommit!==report\.expectedCommit/);
});
