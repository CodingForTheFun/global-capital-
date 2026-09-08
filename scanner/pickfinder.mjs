import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { evaluatePick, buildDiversifiedCard, numberOrNull } from './criteria.mjs';
import {
  clearPickFinderConnection,
  clearPickFinderSession,
  getPickFinderConnectionState,
  loadPickFinderCredentials,
  loadPickFinderSession,
  savePickFinderCredentials,
  savePickFinderSession,
} from './secure-store.mjs';

const BASE = process.env.PICKFINDER_BASE_URL || 'https://www.pickfinder.app';
const PROPS = process.env.PICKFINDER_PROPS_URL || `${BASE}/props`;
const SIGNIN = process.env.PICKFINDER_SIGN_IN_URL || `${BASE}/sign-in`;
const HEADLESS = String(process.env.HEADLESS ?? 'true').toLowerCase() !== 'false';
const MAX = Math.max(1, Number(process.env.MAX_CANDIDATES || 60));
const CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.SCAN_CONCURRENCY || 3)));
const DATA = path.resolve(process.env.DATA_DIR || './data');
const FLOOR = Number(process.env.MIN_FILTER_HIT_RATE || 75);
const TEAM_SPORTS = ['NBA', 'WNBA', 'NHL', 'MLB', 'NFL', 'CFB', 'CBB'];
const HOME_AWAY_CRITICAL = ['NBA', 'WNBA', 'NHL', 'MLB'];
const ESPORTS = ['VAL', 'CS2', 'LOL', 'DOTA2', 'COD'];
const TABS = ['GAMES', 'GAMES WON', 'GAMES LOST', 'BP WON', 'BP RET', 'BP W%', 'ACES', 'DF'];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const progress = (cb, value) => { try { cb?.(value); } catch {} };
const clean = (value = '') => String(value)
  .replace(/\u00a0/g, ' ')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();
const esc = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function first(locators, timeout = 700) {
  for (const locator of locators) {
    try {
      const item = locator.first();
      if (await item.isVisible({ timeout })) return item;
    } catch {}
  }
  return null;
}

async function bodyText(page) {
  return clean(await page.locator('body').innerText().catch(() => ''));
}

async function optionTexts(page) {
  const out = [];
  for (const selector of [
    '[role="option"]',
    '[role="menuitem"]',
    '[role="listbox"] button',
    '[data-radix-collection-item]',
  ]) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 120);
    for (let i = 0; i < count; i++) {
      const item = locator.nth(i);
      if (!await item.isVisible().catch(() => false)) continue;
      const text = clean(await item.innerText().catch(() => ''));
      if (text && !out.includes(text)) out.push(text);
    }
  }
  return out;
}

async function clickName(page, names, exact = false) {
  for (const name of (Array.isArray(names) ? names : [names]).filter(Boolean)) {
    const re = name instanceof RegExp ? name : new RegExp(exact ? `^${esc(name)}$` : esc(name), 'i');
    const item = await first([
      page.getByRole('button', { name: re }),
      page.getByRole('option', { name: re }),
      page.getByRole('menuitem', { name: re }),
      page.getByRole('link', { name: re }),
      page.getByText(re, { exact }),
    ]);
    if (!item) continue;
    try {
      await item.scrollIntoViewIfNeeded().catch(() => {});
      await item.click({ timeout: 2500 });
      await wait(220);
      return true;
    } catch {}
  }
  return false;
}

async function filterTrigger(page, label) {
  const re = new RegExp(`^\\s*${esc(label)}(?:\\s|$)`, 'i');
  return first([
    page.getByRole('button', { name: re }),
    page.locator('button').filter({ hasText: new RegExp(esc(label), 'i') }),
    page.locator('[role="combobox"]').filter({ hasText: new RegExp(esc(label), 'i') }),
  ], 900);
}

async function selectFilter(page, label, values) {
  const trigger = await filterTrigger(page, label);
  if (!trigger) return { opened: false, selected: false, value: null, options: [], triggerText: '' };

  const triggerText = clean(await trigger.innerText().catch(() => ''));
  await trigger.click({ timeout: 2500 }).catch(() => {});
  await wait(200);

  const options = await optionTexts(page);
  const requested = (Array.isArray(values) ? values : [values]).filter(Boolean).map(String);

  for (const candidate of requested) {
    if (candidate.toLowerCase() === 'current') continue;
    const found = options.find((x) => x.toLowerCase() === candidate.toLowerCase())
      || options.find((x) => x.toLowerCase().includes(candidate.toLowerCase()));
    if (found && await clickName(page, found, true)) {
      return { opened: true, selected: true, value: found, options, triggerText };
    }
  }

  if (requested.some((x) => x.toLowerCase() === 'current')) {
    const current = triggerText.replace(new RegExp(`^\\s*${esc(label)}\\s*`, 'i'), '').trim();
    if (current && !/^all$/i.test(current) && current.toLowerCase() !== label.toLowerCase()) {
      await page.keyboard.press('Escape').catch(() => {});
      return { opened: true, selected: true, value: current, options, triggerText };
    }
    const usable = options.filter((x) => !/^all$/i.test(x) && x.toLowerCase() !== label.toLowerCase());
    if (usable.length === 1 && await clickName(page, usable[0], true)) {
      return { opened: true, selected: true, value: usable[0], options, triggerText };
    }
  }

  await page.keyboard.press('Escape').catch(() => {});
  return { opened: true, selected: false, value: null, options, triggerText };
}

async function openAdvanced(page) {
  const item = await first([
    page.locator('button[aria-label*="filter" i]'),
    page.locator('button[title*="filter" i]'),
    page.locator('button[aria-label*="setting" i]'),
    page.locator('button[title*="setting" i]'),
    page.getByRole('button', { name: /advanced filters?|settings?|more filters?/i }),
  ], 900);
  if (!item) return false;
  try {
    await item.click({ timeout: 2500 });
    await wait(250);
    return true;
  } catch {
    return false;
  }
}

function rate(text, label) {
  for (const re of [
    new RegExp(`${esc(label)}\\s*[:\\-]?\\s*(\\d{1,3})%`, 'i'),
    new RegExp(`${esc(label)}[^%]{0,40}?(\\d{1,3})%`, 'i'),
  ]) {
    const match = text.match(re);
    if (match) return Number(match[1]);
  }
  return null;
}

async function hitRate(page) {
  const text = await bodyText(page);
  return rate(text, 'Hit Rate') ?? rate(text, 'Hit%') ?? rate(text, 'L10');
}

async function auditFilter(
  page,
  label,
  values,
  required = false,
  { advanced = false, requiredWhenAvailable = false } = {},
) {
  const beforeHitRate = await hitRate(page);
  let result = await selectFilter(page, label, values);

  if (!result.selected && advanced && await openAdvanced(page)) {
    result = await selectFilter(page, label, values);
  }

  const mustVerify = required || (requiredWhenAvailable && result.opened && result.options.length > 0);
  if (!result.selected) {
    return {
      label,
      value: (Array.isArray(values) ? values : [values]).join(' / ') || 'Current',
      beforeHitRate,
      hitRate: null,
      delta: null,
      required: mustVerify,
      enforceFloor: true,
      floor: FLOOR,
      verified: false,
      opened: result.opened,
      availableOptions: result.options.slice(0, 30),
    };
  }

  await wait(350);
  const afterHitRate = await hitRate(page);
  return {
    label,
    value: result.value,
    beforeHitRate,
    hitRate: afterHitRate,
    afterHitRate,
    delta: Number.isFinite(beforeHitRate) && Number.isFinite(afterHitRate)
      ? afterHitRate - beforeHitRate
      : null,
    required: mustVerify,
    enforceFloor: true,
    floor: FLOOR,
    verified: true,
    opened: true,
    availableOptions: result.options.slice(0, 30),
  };
}

function propParts(href) {
  try {
    return decodeURIComponent(new URL(href).searchParams.get('prop') || '').split(':');
  } catch {
    return [];
  }
}

function lineOf(href, text = '') {
  const parts = propParts(href);
  const value = parts.at(-1);
  if (/^[-+]?\\d+(\\.\\d+)?$/.test(value || '')) return Number(value);
  const match = text.match(/\\b(?:line|projection)\\s*[:\\-]?\\s*([-+]?\\d+(?:\\.\\d+)?)/i);
  return match ? Number(match[1]) : null;
}

function propOf(href) {
  const parts = propParts(href);
  return parts[1]
    ? parts[1].replace(/_/g, ' ').replace(/\\b\\w/g, (c) => c.toUpperCase())
    : 'Prop';
}

function matchOf(href) {
  const parts = propParts(href);
  return parts[2] || String(href).split('?')[0];
}

function sportOf(text) {
  return ['WNBA', 'NBA', 'MLB', 'NFL', 'CFB', 'TENNIS', 'SOCCER', 'LOL', 'DOTA2', 'CS2', 'VAL', 'COD', 'CBB', 'NHL']
    .find((sport) => new RegExp(`\\b${sport}\\b`, 'i').test(text)) || 'UNKNOWN';
}

function directionOf(text) {
  const under = (text.match(/\\bunder\\b|\\blower\\b/gi) || []).length;
  const over = (text.match(/\\bover\\b|\\bhigher\\b/gi) || []).length;
  return under > over ? 'UNDER' : over > under ? 'OVER' : 'N/A';
}

function opponentOf(text) {
  for (const re of [
    /Opponent\\s+(?!All\\b)([A-Za-z0-9 .&'’-]{2,40})/i,
    /\\bvs\\.?\\s+([A-Za-z0-9 .&'’-]{2,40})/i,
  ]) {
    const match = text.match(re);
    if (match) return clean(match[1]).split(/\\n|\\s{2,}/)[0].trim();
  }
  return '';
}

function venueOf(text) {
  const match = text.match(/Home\\/?Away\\s+(Home|Away)/i);
  if (match) return match[1];
  return /\\bHome\\b/i.test(text) && !/\\bAway\\b/i.test(text)
    ? 'Home'
    : /\\bAway\\b/i.test(text) && !/\\bHome\\b/i.test(text)
      ? 'Away'
      : null;
}

function outcomeOf(text) {
  for (const re of [
    /Win Predictor[^%]{0,100}?(\\d{1,3})%/i,
    /(?:Win Probability|Match Odds)[^%]{0,100}?(\\d{1,3})%/i,
  ]) {
    const match = text.match(re);
    if (match) return Number(match[1]) >= 50 ? 'WIN' : 'LOSS';
  }
  return null;
}

function surfaceOf(text) {
  const match = text.match(/\\b(Indoor Hard|Outdoor Hard|Red Clay|Hard|Clay|Grass|Carpet)\\b/i);
  return match?.[1] || null;
}

function signals(text, top) {
  return {
    regularLine: !!top.regular && !/\\b(goblin|demon|green goblin|discount(?:ed)?|boosted)\\b/i.test(text),
    prizePicksConfirmed: !!top.pp || /prize\\s*picks|prizepicks/i.test(text),
    isToday: !!top.today || /\\b(today|tonight)\\b/i.test(text),
  };
}

async function diagnostic(page, label, extra = {}) {
  try {
    const dir = path.join(DATA, 'diagnostics');
    await fs.mkdir(dir, { recursive: true });
    const controls = await page.locator('button,[role="combobox"]').allInnerTexts().catch(() => []);
    await fs.writeFile(
      path.join(dir, `${Date.now()}-${label.replace(/[^a-z0-9_-]/gi, '-').slice(0, 50)}.json`),
      JSON.stringify({ url: page.url(), controls, ...extra }, null, 2),
    );
  } catch {}
}

async function login(page, context, logs, onProgress) {
  progress(onProgress, { stage: 'auth', message: 'Checking PickFinder session' });
  await page.goto(PROPS, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await wait(900);

  const passwordField = () => first([
    page.locator('input[type="password"]'),
    page.getByLabel(/password/i),
    page.getByPlaceholder(/password/i),
  ], 500);

  let pass = await passwordField();
  let needsLogin = !!pass || /sign[-_ ]?in|login/i.test(new URL(page.url()).pathname);

  if (!needsLogin) {
    const signIn = await first([
      page.getByRole('link', { name: /sign in|log in|login/i }),
      page.getByRole('button', { name: /sign in|log in|login/i }),
    ], 500);
    needsLogin = !!signIn && !/\\bProps\\b|\\bAnalysis\\b/i.test(await bodyText(page));
  }

  if (!needsLogin) {
    logs.push('Authenticated PickFinder session confirmed');
    await savePickFinderSession(await context.storageState()).catch(() => {});
    return;
  }

  const credentials = await loadPickFinderCredentials();
  if (!credentials) {
    throw Object.assign(
      new Error('PickFinder is not connected. Connect it from the dashboard first.'),
      { code: 'PICKFINDER_NOT_CONNECTED' },
    );
  }

  progress(onProgress, { stage: 'auth', message: 'Signing in to PickFinder' });
  await page.goto(SIGNIN, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await wait(600);
  await clickName(page, /sign in|log in|login/i).catch(() => {});
  await wait(350);

  const email = await first([
    page.locator('input[type="email"]'),
    page.getByLabel(/email/i),
    page.getByPlaceholder(/email/i),
    page.locator('input[name*="email" i]'),
  ], 1000);
  pass = await passwordField();

  if (!email || !pass) throw new Error('PickFinder sign-in form could not be found.');

  await email.fill(credentials.email);
  await pass.fill(credentials.password);

  const submit = await first([
    page.getByRole('button', { name: /sign in|log in|login|continue/i }),
    page.locator('button[type="submit"]'),
  ], 1000);
  if (!submit) throw new Error('PickFinder sign-in button could not be found.');

  await submit.click({ timeout: 3000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await wait(900);

  if (await passwordField() || /sign[-_ ]?in|login/i.test(new URL(page.url()).pathname)) {
    const text = await bodyText(page);
    if (/captcha|verify|verification|one[- ]?time|2fa|two[- ]factor/i.test(text)) {
      throw new Error('PickFinder requires interactive verification. Complete it in PickFinder, then reconnect.');
    }
    throw new Error('PickFinder sign-in did not complete. Check the login.');
  }

  await page.goto(PROPS, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await savePickFinderSession(await context.storageState());
  logs.push('PickFinder login verified and encrypted session saved');
}

async function contextWithLogin(logs, onProgress) {
  const browser = await chromium.launch({ headless: HEADLESS });
  try {
    const saved = await loadPickFinderSession();
    const context = await browser.newContext({
      ...(saved ? { storageState: saved } : {}),
      viewport: { width: 1440, height: 1000 },
      locale: 'en-US',
    });
    const page = await context.newPage();
    await login(page, context, logs, onProgress);
    return { browser, context, page };
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

async function topFilters(page, logs) {
  const pp = await selectFilter(page, 'Apps', ['PrizePicks', 'Prize Picks']);
  const regular = await selectFilter(page, 'Modifier', ['Regular', 'Main', 'Standard']);
  const today = await selectFilter(page, 'Date', ['Today']);
  logs.push(`Top filters: PrizePicks=${pp.selected}, regular=${regular.selected}, today=${today.selected}`);
  return { pp: pp.selected, regular: regular.selected, today: today.selected };
}

async function candidates(page, logs, onProgress) {
  progress(onProgress, {
    stage: 'discover',
    message: 'Finding tonight’s regular PrizePicks props',
    reviewed: 0,
    total: 0,
  });

  await page.goto(PROPS, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await wait(700);
  const top = await topFilters(page, logs);
  await diagnostic(page, 'props-controls');

  const anchors = page.locator('a[href*="/players/"]');
  const count = Math.min(await anchors.count().catch(() => 0), MAX * 8);
  const out = [];
  const seen = new Set();

  for (let i = 0; i < count && out.length < MAX; i++) {
    const anchor = anchors.nth(i);
    const href = await anchor.getAttribute('href').catch(() => null);
    if (!href) continue;

    const absolute = new URL(href, BASE).toString();
    if (seen.has(absolute)) continue;

    const row = clean(await anchor
      .locator('xpath=ancestor::*[self::tr or @role="row" or self::article or self::div][1]')
      .innerText()
      .catch(() => anchor.innerText().catch(() => '')));
    if (!row) continue;

    if (/\\b(goblin|demon|green goblin|discount(?:ed)?|boosted)\\b/i.test(row)) continue;

    out.push({ href: absolute, row, top });
    seen.add(absolute);
  }

  logs.push(`Found ${out.length} candidates; no performance decisions were made from summary view`);
  progress(onProgress, {
    stage: 'discover',
    message: `Found ${out.length} candidates — opening every full detail page`,
    reviewed: 0,
    total: out.length,
  });
  return out;
}

async function verifyDetailPage(page, href) {
  const url = page.url();
  const body = await bodyText(page);
  const h1 = await page.locator('h1').first().innerText().catch(() => '');
  const hasPlayerPath = /\\/players\\//i.test(new URL(url).pathname) || /\\/players\\//i.test(new URL(href).pathname);
  const hasAnalytics = /\\bL5\\b|\\bL10\\b|\\bL15\\b|\\bH2H\\b|Hit Rate|Opponent|Season/i.test(body);
  return {
    verified: Boolean(hasPlayerPath && clean(h1) && hasAnalytics),
    url,
    playerHeading: clean(h1),
    hasPlayerPath,
    hasAnalytics,
  };
}

async function tabs(page) {
  const rows = [];
  for (const tab of TABS) {
    const before = await hitRate(page);
    if (!await clickName(page, tab, true)) {
      rows.push({ tab, verified: false, beforeHitRate: before, hitRate: null, delta: null });
      continue;
    }
    await wait(220);
    const text = await bodyText(page);
    const after = await hitRate(page);
    const values = {
      l5: rate(text, 'L5'),
      l10: rate(text, 'L10'),
      l15: rate(text, 'L15'),
      h2h: rate(text, 'H2H'),
    };
    const nums = Object.values(values).filter(Number.isFinite);
    rows.push({
      tab,
      verified: true,
      beforeHitRate: before,
      hitRate: after,
      delta: Number.isFinite(before) && Number.isFinite(after) ? after - before : null,
      ...values,
      score: nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null,
    });
  }
  const best = [...rows]
    .filter((row) => Number.isFinite(row.score))
    .sort((a, b) => b.score - a.score)[0];
  return { rows, strongestTab: best?.tab || null, strongestScore: best?.score ?? null };
}

async function analyze(context, candidate, logs) {
  const page = await context.newPage();
  try {
    await page.goto(candidate.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await wait(700);

    const detail = await verifyDetailPage(page, candidate.href);
    if (!detail.verified) {
      await diagnostic(page, 'detail-page-unverified', { detail });
      throw new Error('Full PickFinder player detail page could not be verified.');
    }

    const body = await bodyText(page);
    const all = `${candidate.row}\n${body}`;
    const sport = sportOf(all);
    const pick = directionOf(candidate.row) !== 'N/A' ? directionOf(candidate.row) : directionOf(body);
    const opponent = opponentOf(all);
    const venue = venueOf(all);
    const outcome = outcomeOf(all);
    const sig = signals(all, candidate.top);
    const year = String(new Date().getFullYear());

    const auditRows = [{
      label: 'Full detail page',
      value: detail.url,
      beforeHitRate: null,
      hitRate: await hitRate(page),
      delta: null,
      required: true,
      enforceFloor: false,
      verified: true,
    }];

    auditRows.push(
      opponent
        ? await auditFilter(page, 'Opponent', [opponent], true)
        : {
            label: 'Opponent',
            value: 'Current opponent',
            beforeHitRate: await hitRate(page),
            hitRate: null,
            delta: null,
            required: true,
            enforceFloor: true,
            floor: FLOOR,
            verified: false,
          },
    );

    if (TEAM_SPORTS.includes(sport)) {
      auditRows.push(await auditFilter(page, 'Season', [year, 'Current'], true));
      auditRows.push(
        venue
          ? await auditFilter(page, 'Home/Away', [venue], HOME_AWAY_CRITICAL.includes(sport))
          : {
              label: 'Home/Away',
              value: 'Current venue',
              beforeHitRate: await hitRate(page),
              hitRate: null,
              delta: null,
              required: HOME_AWAY_CRITICAL.includes(sport),
              enforceFloor: true,
              floor: FLOOR,
              verified: false,
            },
      );
      auditRows.push(await auditFilter(page, 'Team', ['Current'], true));
    }

    if (ESPORTS.includes(sport)) {
      auditRows.push(await auditFilter(page, 'Team', ['Current'], true));
      auditRows.push(await auditFilter(page, 'Event/Tournament', ['Current'], true));
      auditRows.push(await auditFilter(
        page,
        'LAN/Online',
        ['Current', 'LAN', 'Online'],
        false,
        { advanced: true, requiredWhenAvailable: true },
      ));
    }

    if (sport === 'TENNIS') {
      auditRows.push(await auditFilter(page, 'Court Type', [surfaceOf(all) || 'Current'], true));
      auditRows.push(await auditFilter(page, 'Season', [year, 'Current'], true));
      auditRows.push(await auditFilter(
        page,
        'Home/Away',
        venue ? [venue] : ['Current'],
        false,
        { requiredWhenAvailable: true },
      ));
      auditRows.push(await auditFilter(
        page,
        'Team',
        ['Current'],
        false,
        { requiredWhenAvailable: true },
      ));
      for (const label of ['Opponent Hand', 'Opponent Rank', 'Match Format', 'Sets Played']) {
        auditRows.push(await auditFilter(
          page,
          label,
          ['Current'],
          false,
          { advanced: true, requiredWhenAvailable: true },
        ));
      }
    }

    for (const label of ['Days Rest', 'Rank', 'Spread', 'Minutes Played']) {
      auditRows.push(await auditFilter(
        page,
        label,
        ['Current'],
        false,
        { advanced: true, requiredWhenAvailable: true },
      ));
    }

    let outcomeRate = null;
    if (outcome) {
      const result = await auditFilter(
        page,
        'Win/Loss',
        [outcome, outcome === 'WIN' ? 'Win' : 'Loss'],
        true,
        { advanced: true },
      );
      auditRows.push(result);
      outcomeRate = result.hitRate;
    } else {
      auditRows.push({
        label: 'Win/Loss',
        value: 'Expected outcome unresolved',
        beforeHitRate: await hitRate(page),
        hitRate: null,
        delta: null,
        required: true,
        enforceFloor: true,
        floor: FLOOR,
        verified: false,
      });
    }

    const tabAudit = sport === 'TENNIS'
      ? await tabs(page)
      : { rows: [], strongestTab: null, strongestScore: null };

    if (auditRows.some((row) => row.required && (!row.verified || row.hitRate === null && row.enforceFloor !== false))) {
      await diagnostic(page, `${sport}-missing-required-filter`, { auditRows });
    }

    const avg = numberOrNull((all.match(/Avg(?:\\s+L10)?\\s*([-+]?\\d+(?:\\.\\d+)?)/i) || [])[1]);
    const diff = numberOrNull((all.match(/Diff\\s*([-+]?\\d+(?:\\.\\d+)?)/i) || [])[1]);

    return evaluatePick({
      id: candidate.href,
      player: detail.playerHeading || candidate.row.split('\\n')[0] || 'Unknown',
      prop: propOf(candidate.href),
      line: lineOf(candidate.href, candidate.row),
      sport,
      pick,
      opponent,
      matchId: matchOf(candidate.href),
      l5: rate(body, 'L5'),
      l10: rate(body, 'L10'),
      l15: rate(body, 'L15'),
      h2h: rate(body, 'H2H'),
      expectedOutcome: outcome,
      expectedOutcomeRate: outcomeRate,
      avg,
      diff,
      regularLine: sig.regularLine,
      prizePicksConfirmed: sig.prizePicksConfirmed,
      isToday: sig.isToday,
      sourceUrl: candidate.href,
      detailPageVerified: true,
      filterAudit: auditRows,
      tabAudit: tabAudit.rows,
      strongestTab: tabAudit.strongestTab,
      strongestTabScore: tabAudit.strongestScore,
    });
  } catch (error) {
    logs.push(`Detail failure ${candidate.href}: ${error.message}`);
    return evaluatePick({
      id: candidate.href,
      player: 'Unresolved',
      prop: propOf(candidate.href),
      line: lineOf(candidate.href, candidate.row),
      sport: 'UNKNOWN',
      pick: directionOf(candidate.row),
      opponent: '',
      matchId: candidate.href,
      l5: null,
      l10: null,
      l15: null,
      h2h: null,
      expectedOutcome: null,
      expectedOutcomeRate: null,
      avg: null,
      diff: null,
      regularLine: false,
      prizePicksConfirmed: false,
      isToday: false,
      sourceUrl: candidate.href,
      detailPageVerified: false,
      filterAudit: [{
        label: 'Full detail page',
        value: 'Failed to verify',
        beforeHitRate: null,
        hitRate: null,
        delta: null,
        required: true,
        enforceFloor: false,
        verified: false,
      }],
    });
  } finally {
    await page.close().catch(() => {});
  }
}

export async function verifyPickFinderConnection({ email, password } = {}) {
  if (email || password) await savePickFinderCredentials({ email, password });
  await clearPickFinderSession();

  const logs = [];
  try {
    const { browser, context, page } = await contextWithLogin(logs);
    try {
      await page.goto(PROPS, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await wait(500);
      if (await first([page.locator('input[type="password"]')], 350)) {
        throw new Error('PickFinder session is not authenticated.');
      }
      await savePickFinderSession(await context.storageState());
      return { connected: true, ...await getPickFinderConnectionState(), logs };
    } finally {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  } catch (error) {
    await clearPickFinderConnection().catch(() => {});
    throw error;
  }
}

export async function disconnectPickFinder() {
  await clearPickFinderConnection();
  return { connected: false, ...await getPickFinderConnectionState() };
}

export async function runLiveScan({ onProgress } = {}) {
  const logs = [];
  const warnings = [];
  progress(onProgress, {
    stage: 'starting',
    message: 'Starting strict full-detail PickFinder scan',
    reviewed: 0,
    total: 0,
  });

  const { browser, context, page } = await contextWithLogin(logs, onProgress);
  try {
    const list = await candidates(page, logs, onProgress);
    const picks = new Array(list.length);
    let next = 0;
    let reviewed = 0;
    let qualifiedSoFar = 0;

    async function worker(workerNumber) {
      while (true) {
        const index = next++;
        if (index >= list.length) return;

        progress(onProgress, {
          stage: 'analyze',
          message: `Worker ${workerNumber}: opening full detail page ${index + 1}/${list.length}`,
          reviewed,
          total: list.length,
        });

        const pick = await analyze(context, list[index], logs);
        picks[index] = pick;
        reviewed++;
        if (pick.qualified) qualifiedSoFar++;

        progress(onProgress, {
          stage: 'analyze',
          message: pick.qualified ? `${pick.player} qualified` : `${pick.player} rejected`,
          reviewed,
          total: list.length,
          currentPlayer: pick.player,
          qualifiedSoFar,
        });
      }
    }

    const workers = Math.min(CONCURRENCY, Math.max(1, list.length));
    await Promise.all(Array.from({ length: workers }, (_, i) => worker(i + 1)));
    await savePickFinderSession(await context.storageState()).catch(() => {});

    const done = picks.filter(Boolean);
    const qualified = done.filter((pick) => pick.qualified).sort((a, b) => b.confidence - a.confidence);
    if (!qualified.length) warnings.push('No props passed every strict verification rule.');

    return {
      mode: 'live',
      scannedAt: new Date().toISOString(),
      source: 'PickFinder authenticated full-detail browser scan',
      summaryViewUsedForJudgment: false,
      everyCandidateDetailPageOpened: true,
      filterChangeTracking: true,
      totalReviewed: done.length,
      qualifiedCount: qualified.length,
      rejectedCount: done.length - qualified.length,
      scannerConcurrency: workers,
      picks: done,
      diversifiedCard: buildDiversifiedCard(done, 4),
      warnings,
      logs,
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
