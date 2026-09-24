import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const account = readFileSync(new URL('../components/account-view.tsx', import.meta.url), 'utf8');

test('account navigation exposes Saved props as a real section', () => {
  assert.match(account, /id: 'saved', label: 'Saved props'/);
  assert.match(account, /useState<SectionId>\('saved'\)/);
  assert.match(account, /data-qa="saved-props-account"/);
});

test('saved props reopen the exact research selection', () => {
  assert.match(account, /sport: item\.sport/);
  assert.match(account, /player: item\.player/);
  assert.match(account, /market: item\.market/);
  assert.match(account, /line: String\(item\.line\)/);
  assert.match(account, /period: item\.period \|\| 'game'/);
  assert.match(account, /<Link href=\{watchlistHref\(item\)\}/);
});

test('saved props can be removed through the CSRF-backed watchlist client', () => {
  assert.match(account, /fetchWatchlist\(controller\.signal\)/);
  assert.match(account, /setCsrfToken\(nextCsrf\)/);
  assert.match(account, /updateWatchlist\('remove', \{ key: item\.key \}, csrfToken\)/);
  assert.match(account, /setItems\(next\)/);
});
