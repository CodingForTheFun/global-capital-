// Browser fixtures are isolated to CI and never modify production account data.
export async function assertTacoPlacement(page, base, check) {
  const controls = page.locator('[aria-label="Market board type"]');
  check(await controls.getByRole('button', { name: /taco/i }).count() === 0, 'No Taco option on sportsbook');
  check(await controls.getByRole('button', { name: 'Game lines', exact: true }).count() === 1, 'Game lines remain on sportsbook');
  check(await controls.getByRole('button', { name: 'Player props', exact: true }).count() === 1, 'Player props remain on sportsbook');
  await page.locator('nav[aria-label="Primary workspace navigation"]:visible').getByRole('link', { name: 'Auto Scout', exact: true }).click();
  await page.waitForURL('**/apex');
  const toggle = page.locator('#asQuick [data-taco-filter]');
  await toggle.waitFor();
  check(await toggle.getAttribute('aria-pressed') === 'false', 'Tacos default off on Auto Scout');
  await toggle.click();
  await page.getByRole('heading', { name: '🌮 Taco-only props', exact: true }).waitFor();
  await page.getByText('Verified Taco promotion data is not supplied by the current feed.', { exact: true }).waitFor();
  check(await toggle.getAttribute('aria-pressed') === 'true', 'Taco-only filter is beside Auto Scout quick filters');
  check(!(await page.locator('.asTableViewport').isVisible()), 'Regular board hidden only while Taco view is active');
  check(await page.locator('#asRules').getAttribute('aria-checked') === 'true', 'Regular scanner rules remain enabled');
  const requestedSports = [];
  let fixtureMode = 'offers';
  await page.unroute('**/api/apex/taco-offers?*');
  await page.route('**/api/apex/taco-offers?*', route => {
    const sport = new URL(route.request().url()).searchParams.get('sport'); requestedSports.push(sport);
    if (fixtureMode === 'failure') return route.fulfill({ status: 503, json: { error: 'fixture' } });
    const future = new Date(Date.now() + 60000).toISOString();
    return route.fulfill({ json: { offers: [
      { id: sport + '-taco', sport, playerName: 'Taco QA ' + sport, market: 'Points', side: 'OVER', line: 15.5, originalLine: 22.5, expiresAt: future },
      { id: 'expired', sport, playerName: 'Expired QA', market: 'Points', side: 'OVER', line: 15.5, originalLine: 22.5, expiresAt: '2000-01-01T00:00:00Z' },
      { id: 'invalid', sport, playerName: 'Invalid QA', market: 'Points', side: 'OVER', line: 15.5, originalLine: 15.5, expiresAt: future },
    ], message: 'Verified fixture promotion data.' } });
  });
  await page.getByRole('button', { name: 'Refresh Taco props', exact: true }).click();
  await page.getByRole('heading', { name: 'Taco QA NFL', exact: true }).waitFor();
  check(await page.locator('#asTacoPanel article').count() === 1, 'Only unexpired valid Taco props render');
  check(await page.locator('#asTacoPanel del').textContent() === '22.5', 'Original line is retained');
  check(await page.locator('#asTacoPanel strong').textContent() === '15.5', 'Discounted line is retained');
  await page.screenshot({ path: 'artifacts/tacos-autoscout-mobile.png', fullPage: true });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Taco panel fits mobile');
  // Hold the regular request to prove Taco reads wait for the cache owner.
  let releaseBoard, sawBoard;
  const boardSeen = new Promise(resolve => { sawBoard = resolve; });
  const heldBoard = new Promise(resolve => { releaseBoard = resolve; });
  await page.route('**/api/apex/props?sport=NBA', async route => {
    sawBoard(); await heldBoard;
    return route.fulfill({ json: { ok: true, props: [], meta: { sport: 'NBA' } } });
  }, { times: 1 });
  await page.locator('#asSports').getByRole('button', { name: 'NBA', exact: true }).click();
  await boardSeen;
  await page.getByText('Waiting for this sport’s prop board…', { exact: true }).waitFor();
  check(!requestedSports.includes('NBA') && await page.locator('#asTacoPanel article').count() === 0, 'Cold-cache sport waits for regular board without stale Taco cards');
  releaseBoard();
  await page.getByRole('heading', { name: 'Taco QA NBA', exact: true }).waitFor();
  check(requestedSports.at(-1) === 'NBA' && await page.getByRole('heading', { name: 'Taco QA NFL', exact: true }).count() === 0, 'Board completion automatically loads the current sport’s Taco props');
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.screenshot({ path: 'artifacts/tacos-autoscout-desktop.png', fullPage: true });
  fixtureMode = 'failure';
  await page.getByRole('button', { name: 'Refresh Taco props', exact: true }).click();
  await page.getByText('Promotion data is temporarily unavailable.', { exact: true }).waitFor();
  check(await page.locator('#asTacoPanel article').count() === 0, 'Failed refresh does not show stale Taco offers');
  await page.getByRole('button', { name: 'Back to regular props', exact: true }).click();
  check(await toggle.getAttribute('aria-pressed') === 'false' && await page.locator('.asTableViewport').isVisible(), 'Back restores regular props');
  check(await page.locator('#asRules').getAttribute('aria-checked') === 'true', 'Scanner rules stay unchanged after Tacos');
  // Old sportsbook bookmarks migrate to Auto Scout, never resurrect a Taco tab.
  await page.goto(base + '/sportsbooks#tacos', { waitUntil: 'networkidle' });
  await page.waitForURL('**/apex#tacos');
  await page.getByRole('heading', { name: '🌮 Taco-only props', exact: true }).waitFor();
  check(true, 'Legacy Taco link opens Auto Scout only');
  await page.locator('.edge-workspace-nav').getByRole('link', { name: 'Sports', exact: true }).click();
  await page.waitForURL('**/sportsbooks#sports');
  await page.getByRole('heading', { name: 'NFL · Game lines', exact: true }).or(page.getByRole('heading', { name: 'NBA · Game lines', exact: true })).waitFor();
  check(await page.locator('[aria-label="Market board type"]').getByRole('button', { name: /taco/i }).count() === 0, 'Return to sportsbook has no Taco option');
}
