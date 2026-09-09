import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { evaluatePick, buildDiversifiedCard, numberOrNull } from './criteria.mjs';
import { criteriaFromRules, normalizeRules } from './rules.mjs';
import { activateControl, waitForUnlock } from './interaction.mjs';
import { safeError, internalDetail, publicMessageFor, PICKFINDER_SIGN_IN_FAILED } from '../lib/safe-error.mjs';
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
const CONCURRENCY = Math.max(1, Math.min(5, Number(process.env.SCAN_CONCURRENCY || 3)));
const DATA = path.resolve(process.env.DATA_DIR || './data');
const TZ = process.env.SCAN_TIME_ZONE || 'America/Chicago';
const TEAM_SPORTS = new Set(['NBA', 'WNBA', 'NHL', 'MLB', 'NFL', 'CFB', 'CBB']);
const ESPORTS = new Set(['VAL', 'CS2', 'LOL', 'DOTA2', 'COD']);
const TENNIS_TABS = ['GAMES', 'GAMES WON', 'GAMES LOST', 'BP WON', 'BP RET', 'BP W%', 'ACES', 'DF'];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const progress = (cb, value) => { try { cb?.(value); } catch {} };
const clean = (value = '') => String(value)
  .replace(/\u00a0/g, ' ')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();
const esc = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function first(locators, timeout = 650) {
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

async function controlTexts(page) {
  const loc = page.locator('button,[role="button"],[role="combobox"],[role="tab"]');
  const count = Math.min(await loc.count().catch(() => 0), 220);
  const out = [];
  for (let i = 0; i < count; i++) {
    const text = clean(await loc.nth(i).innerText().catch(() => ''));
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

async function optionTexts(page) {
  const out = [];
  for (const selector of ['[role="option"]', '[role="menuitem"]', '[role="listbox"] button', '[data-radix-collection-item]']) {
    const loc = page.locator(selector);
    const count = Math.min(await loc.count().catch(() => 0), 140);
    for (let i = 0; i < count; i++) {
      const item = loc.nth(i);
      if (!await item.isVisible().catch(() => false)) continue;
      const text = clean(await item.innerText().catch(() => ''));
      if (text && !out.includes(text)) out.push(text);
    }
  }
  return out;
}

async function clickNamed(page, name, exact = true) {
  const re = name instanceof RegExp ? name : new RegExp(exact ? `^\\s*${esc(name)}\\s*$` : esc(name), 'i');
  const item = await first([
    page.getByRole('button', { name: re }),
    page.getByRole('tab', { name: re }),
    page.getByRole('option', { name: re }),
    page.getByRole('menuitem', { name: re }),
    page.getByRole('link', { name: re }),
    page.getByText(re, { exact }),
  ], 800);
  if (!item) return false;
  try {
    await item.scrollIntoViewIfNeeded().catch(() => {});
    await item.click({ timeout: 2500 });
    await wait(250);
    return true;
  } catch {
    return false;
  }
}

async function filterTrigger(page, label) {
  const start = new RegExp(`^\\s*${esc(label)}(?:\\s|$)`, 'i');
  return first([
    page.getByRole('button', { name: start }),
    page.getByRole('combobox', { name: start }),
    page.locator('button').filter({ hasText: start }),
    page.locator('[role="combobox"]').filter({ hasText: start }),
  ], 750);
}

async function selectFilter(page, label, values) {
  const trigger = await filterTrigger(page, label);
  if (!trigger) return { opened: false, selected: false, value: null, options: [] };
  const triggerText = clean(await trigger.innerText().catch(() => ''));
  await trigger.click({ timeout: 2500 }).catch(() => {});
  await wait(180);
  const options = await optionTexts(page);
  const requested = (Array.isArray(values) ? values : [values]).filter(Boolean).map(String);

  for (const requestedValue of requested) {
    if (requestedValue.toLowerCase() === 'current') continue;
    const value = options.find((option) => option.toLowerCase() === requestedValue.toLowerCase())
      || options.find((option) => option.toLowerCase().startsWith(requestedValue.toLowerCase()));
    if (value && await clickNamed(page, value, true)) return { opened: true, selected: true, value, options };
  }

  if (requested.some((value) => value.toLowerCase() === 'current')) {
    const current = triggerText.replace(new RegExp(`^\\s*${esc(label)}\\s*`, 'i'), '').trim();
    if (current && !/^(all|any)$/i.test(current) && current.toLowerCase() !== label.toLowerCase()) {
      await page.keyboard.press('Escape').catch(() => {});
      return { opened: true, selected: true, value: current, options };
    }
  }

  await page.keyboard.press('Escape').catch(() => {});
  return { opened: true, selected: false, value: null, options };
}

function rate(text, label) {
  for (const re of [
    new RegExp(`${esc(label)}\\s*HR\\s*(\\d{1,3})%`, 'i'),
    new RegExp(`${esc(label)}HR\\s*(\\d{1,3})%`, 'i'),
    new RegExp(`${esc(label)}\\s*[:\\-]?\\s*(\\d{1,3})%`, 'i'),
    new RegExp(`${esc(label)}[^%]{0,45}?(\\d{1,3})%`, 'i'),
  ]) {
    const match = text.match(re);
    if (match) return Number(match[1]);
  }
  return null;
}

async function hitRate(page) {
  const text = await bodyText(page);
  return rate(text, 'Hit Rate') ?? rate(text, 'L10') ?? rate(text, 'L5');
}

function sportFromHref(href) {
  try {
    const match = new URL(href).pathname.match(/\/players\/([^/]+)/i);
    return String(match?.[1] || '').toUpperCase() || 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

function propParts(href) {
  try {
    return decodeURIComponent(new URL(href).searchParams.get('prop') || '').split(':');
  } catch {
    return [];
  }
}
function propOf(href) {
  const value = propParts(href)[1] || 'prop';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
function matchOf(href) { return propParts(href)[2] || ''; }
function lineOf(href, text = '') {
  const value = propParts(href).at(-1);
  if (/^[-+]?\d+(\.\d+)?$/.test(value || '')) return Number(value);
  const match = text.match(/\b(?:line|projection)\s*[:\-]?\s*([-+]?\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : null;
}

function todayKey() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}${get('month')}${get('day')}`;
}
function todayFromMatchId(matchId) {
  const prefix = String(matchId || '').match(/^(\d{8})/)?.[1];
  return prefix ? prefix === todayKey() : null;
}

function directionOf(text) {
  const explicitUnder = (text.match(/\b(?:under|lower)\b/gi) || []).length;
  const explicitOver = (text.match(/\b(?:over|higher)\b/gi) || []).length;
  if (explicitUnder !== explicitOver) return explicitUnder > explicitOver ? 'UNDER' : 'OVER';
  const probability = text.match(/\bO\s*(\d{1,3}(?:\.\d+)?)%[\s\S]{0,30}?\bU\s*(\d{1,3}(?:\.\d+)?)%/i);
  if (probability) return Number(probability[1]) >= Number(probability[2]) ? 'OVER' : 'UNDER';
  return 'N/A';
}

function opponentOf(text) {
  for (const re of [
    /H2H\s+vs\s+([^\n]{2,50})/i,
    /\bvs\s+([^\n]{2,50}?)(?:\s+\d+\s+GAMES?|\n|$)/i,
    /Opponent\s+(?!All\b)([^\n]{2,50})/i,
  ]) {
    const match = text.match(re);
    if (match) return clean(match[1]).replace(/\s*\([^)]*\)\s*$/, '').trim();
  }
  return '';
}

function outcomeOf(text) {
  for (const re of [
    /Win chance:\s*(\d{1,3})%/i,
    /Win Predictor[^%]{0,100}?(\d{1,3})%/i,
    /Win Probability[^%]{0,100}?(\d{1,3})%/i,
  ]) {
    const match = text.match(re);
    if (match) return { outcome: Number(match[1]) >= 50 ? 'WIN' : 'LOSS', probability: Number(match[1]) };
  }
  return { outcome: null, probability: null };
}

function surfaceOf(text) {
  return text.match(/\b(Indoor Hard|Outdoor Hard|Red Clay|Hard|Clay|Grass|Carpet)\b/i)?.[1] || null;
}

function genericName(value) {
  return /^(pickfinder|players|video guide|get discord access|discord|line movement|prop history)$/i.test(clean(value));
}

async function extractPlayerName(page, candidate) {
  const anchor = clean(candidate.anchorText || '');
  const rowLines = clean(candidate.row || '').split('\n').map(clean).filter(Boolean);
  const candidates = [anchor, ...rowLines.slice(0, 5)];
  for (const selector of ['main h1', 'main h2', 'main h3', 'h1', 'h2']) {
    const count = Math.min(await page.locator(selector).count().catch(() => 0), 6);
    for (let i = 0; i < count; i++) candidates.push(clean(await page.locator(selector).nth(i).innerText().catch(() => '')));
  }
  for (const value of candidates) {
    if (!value || genericName(value) || /^(L5|L10|L15|H2H|O[-+\d]|U[-+\d])/i.test(value)) continue;
    if (value.length > 2 && value.length < 70 && !/^(WNBA|NBA|MLB|NFL|CFB|CBB|NHL|TENNIS|SOCCER|LOL|DOTA2|CS2|VAL|COD)$/i.test(value)) return value;
  }
  return 'Unknown player';
}

async function pageUnlocked(page) {
  const text = await bodyText(page);
  if (/sign\s+in\s+to\s+unlock|log\s+in\s+to\s+unlock|sign\s+in\s+to\s+view/i.test(text)) return false;
  if (await first([page.locator('input[type="password"]')], 250)) return false;
  return /\bL5\b|\bL10\b|\bL15\b|\bH2H\b|Avg L10|Hit Rate/i.test(text);
}

async function hasPrizePicks(page, candidateText = '') {
  if (/prize\s*picks|prizepicks/i.test(candidateText)) return true;
  const img = await first([
    page.locator('img[alt*="prize" i]'),
    page.locator('img[src*="prize" i]'),
  ], 250);
  return Boolean(img);
}

async function diagnostic(page, label, extra = {}) {
  try {
    const dir = path.join(DATA, 'diagnostics-v2');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${Date.now()}-${label.replace(/[^a-z0-9_-]/gi, '-').slice(0, 60)}.json`), JSON.stringify({
      url: page.url(),
      controls: await controlTexts(page),
      bodyPreview: (await bodyText(page)).slice(0, 12000),
      ...extra,
    }, null, 2));
  } catch {}
}

async function performLogin(page, context, logs, onProgress) {
  progress(onProgress, { stage: 'auth', message: 'Verifying PickFinder account is unlocked' });
  await page.goto(PROPS, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await wait(900);
  if (await pageUnlocked(page)) {
    logs.push('Authenticated PickFinder session verified by unlocked analytics');
    await savePickFinderSession(await context.storageState()).catch(() => {});
    return;
  }

  const credentials = await loadPickFinderCredentials();
  if (!credentials) {
    throw safeError('PICKFINDER_RECONNECT');
  }

  progress(onProgress, { stage: 'auth', message: 'Signing in to PickFinder' });
  await page.goto(SIGNIN, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await wait(650);

  const email = await first([
    page.locator('input[type="email"]'),
    page.getByLabel(/email/i),
    page.getByPlaceholder(/email/i),
    page.locator('input[name*="email" i]'),
  ], 1300);
  const password = await first([
    page.locator('input[type="password"]'),
    page.getByLabel(/password/i),
    page.getByPlaceholder(/password/i),
  ], 1300);
  if (!email || !password) {
    await diagnostic(page, 'signin-form-missing');
    throw safeError('PICKFINDER_AUTH_UI_CHANGED', PICKFINDER_SIGN_IN_FAILED);
  }

  await email.fill(credentials.email);
  await password.fill(credentials.password);
  const submit = await first([
    page.locator('button[type="submit"]'),
    page.getByRole('button', { name: /sign in|log in|continue/i }),
  ], 1100);
  if (!submit) {
    await diagnostic(page, 'signin-submit-missing');
    throw safeError('PICKFINDER_AUTH_UI_CHANGED', PICKFINDER_SIGN_IN_FAILED);
  }

  // The sign-in modal's backdrop can sit above the submit button and swallow
  // pointer events. Prefer a real click, then fall back to the form's own
  // submit handler / Enter, and never let Playwright's call log reach the UI.
  const activation = await activateControl(submit, { fallbackField: password, clickTimeout: 3500 });
  logs.push(`Sign-in submitted via ${activation.strategy || 'no available strategy'}`);
  if (!activation.ok) {
    console.error('[AutoProp auth] sign-in submit blocked', JSON.stringify(activation.trace));
    await diagnostic(page, 'signin-submit-blocked', { activationTrace: activation.trace });
    throw safeError('PICKFINDER_AUTH_BLOCKED', PICKFINDER_SIGN_IN_FAILED);
  }

  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await wait(1000);
  await page.goto(PROPS, { waitUntil: 'domcontentloaded', timeout: 45000 });

  if (!await waitForUnlock(() => pageUnlocked(page), { attempts: 8, firstDelayMs: 900, delayMs: 700 })) {
    const text = await bodyText(page);
    await diagnostic(page, 'signin-still-locked');
    if (/captcha|verification|verify|two.factor|2fa|one.time/i.test(text)) {
      // Fail closed: AutoProp does not attempt to solve or bypass these.
      throw safeError('PICKFINDER_INTERACTIVE_AUTH');
    }
    throw safeError('PICKFINDER_LOCKED', 'PickFinder did not unlock the analytics. Check the account subscription, then reconnect.');
  }

  await savePickFinderSession(await context.storageState());
  logs.push('PickFinder login succeeded and unlocked analytics were verified');
}

async function contextWithLogin(logs, onProgress) {
  const browser = await chromium.launch({ headless: HEADLESS });
  try {
    const saved = await loadPickFinderSession();
    const context = await browser.newContext({
      ...(saved ? { storageState: saved } : {}),
      viewport: { width: 1440, height: 1050 },
      locale: 'en-US',
      timezoneId: TZ,
    });
    const page = await context.newPage();
    await performLogin(page, context, logs, onProgress);
    return { browser, context, page };
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

async function applyTopFilters(page, logs) {
  const pp = await selectFilter(page, 'Apps', ['PrizePicks', 'Prize Picks']);
  const regular = await selectFilter(page, 'Modifier', ['Regular', 'Main', 'Standard']);
  const date = await selectFilter(page, 'Date', ['Today']);
  logs.push(`Board filters: PrizePicks=${pp.selected}; Regular=${regular.selected}; Today=${date.selected}`);
  return { pp: pp.selected, regular: regular.selected, today: date.selected };
}

async function discoverCandidates(page, logs, onProgress) {
  progress(onProgress, { stage: 'discover', message: 'Loading regular PrizePicks props for today', reviewed: 0, total: 0 });
  await page.goto(PROPS, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await wait(700);
  if (!await pageUnlocked(page)) throw safeError('PICKFINDER_LOCKED');
  const top = await applyTopFilters(page, logs);
  await wait(500);
  await diagnostic(page, 'props-board', { top });

  const anchors = page.locator('a[href*="/players/"]');
  const count = Math.min(await anchors.count().catch(() => 0), MAX * 10);
  const out = [];
  const seen = new Set();
  for (let i = 0; i < count && out.length < MAX; i++) {
    const anchor = anchors.nth(i);
    const href = await anchor.getAttribute('href').catch(() => null);
    if (!href) continue;
    const absolute = new URL(href, BASE).toString();
    if (seen.has(absolute)) continue;
    const anchorText = clean(await anchor.innerText().catch(() => ''));
    const row = clean(await anchor.locator('xpath=ancestor::*[self::tr or @role="row" or self::article or @data-row or self::div][1]').innerText().catch(() => anchorText));
    const combined = `${row}\n${anchorText}`;
    if (/\b(green\s+goblin|goblin|demon|boosted|discount(?:ed)?)\b/i.test(combined)) continue;
    const matchId = matchOf(absolute);
    const today = todayFromMatchId(matchId);
    if (today === false) continue;
    out.push({
      href: absolute,
      row,
      anchorText,
      top,
      sport: sportFromHref(absolute),
      matchId,
      line: lineOf(absolute, combined),
      prop: propOf(absolute),
    });
    seen.add(absolute);
  }
  logs.push(`Discovered ${out.length} regular-line candidates; date enforced from match IDs when available`);
  progress(onProgress, { stage: 'discover', message: `Opening ${out.length} full detail pages`, reviewed: 0, total: out.length });
  return out;
}

async function auditByDropdown(page, label, values, required, floor) {
  const beforeHitRate = await hitRate(page);
  const result = await selectFilter(page, label, values);
  if (!result.selected) {
    return { label, value: (Array.isArray(values) ? values : [values]).join(' / '), beforeHitRate, hitRate: null, afterHitRate: null, delta: null, required, enforceFloor: true, floor, verified: false, availableOptions: result.options.slice(0, 25) };
  }
  await wait(300);
  const afterHitRate = await hitRate(page);
  if (afterHitRate === null && beforeHitRate !== null) {
    await page.keyboard.press('Escape').catch(() => {});
    return { label, value: result.value, beforeHitRate, hitRate: beforeHitRate, afterHitRate: beforeHitRate, delta: 0, required: false, enforceFloor: false, floor, verified: false, removedBecauseDataDisappeared: true };
  }
  return { label, value: result.value, beforeHitRate, hitRate: afterHitRate, afterHitRate, delta: Number.isFinite(beforeHitRate) && Number.isFinite(afterHitRate) ? afterHitRate - beforeHitRate : null, required, enforceFloor: true, floor, verified: true };
}

async function auditContextButton(page, label, patterns, required, floor) {
  const beforeHitRate = await hitRate(page);
  const controls = await controlTexts(page);
  let matched = null;
  for (const pattern of patterns) {
    matched = controls.find((value) => pattern instanceof RegExp ? pattern.test(value) : value.toLowerCase() === String(pattern).toLowerCase());
    if (matched) break;
  }
  if (!matched || !await clickNamed(page, matched, true)) {
    return { label, value: patterns.map(String).join(' / '), beforeHitRate, hitRate: null, afterHitRate: null, delta: null, required, enforceFloor: true, floor, verified: false };
  }
  const afterHitRate = await hitRate(page);
  if (afterHitRate === null && beforeHitRate !== null) {
    return { label, value: matched, beforeHitRate, hitRate: beforeHitRate, afterHitRate: beforeHitRate, delta: 0, required: false, enforceFloor: false, floor, verified: false, removedBecauseDataDisappeared: true };
  }
  return { label, value: matched, beforeHitRate, hitRate: afterHitRate, afterHitRate, delta: Number.isFinite(beforeHitRate) && Number.isFinite(afterHitRate) ? afterHitRate - beforeHitRate : null, required, enforceFloor: true, floor, verified: true };
}

async function auditFilter(page, label, values, required, floor, fallbackPatterns = []) {
  let row = await auditByDropdown(page, label, values, required, floor);
  if (!row.verified && !row.removedBecauseDataDisappeared && fallbackPatterns.length) {
    row = await auditContextButton(page, label, fallbackPatterns, required, floor);
  }
  return row;
}

async function tennisTabs(page) {
  const rows = [];
  for (const tab of TENNIS_TABS) {
    const beforeHitRate = await hitRate(page);
    const found = await clickNamed(page, new RegExp(`^${esc(tab)}$`, 'i'), true);
    if (!found) { rows.push({ tab, verified: false, beforeHitRate, hitRate: null, delta: null }); continue; }
    const text = await bodyText(page);
    const afterHitRate = await hitRate(page);
    const values = { l5: rate(text, 'L5'), l10: rate(text, 'L10'), l15: rate(text, 'L15'), h2h: rate(text, 'H2H') };
    const nums = Object.values(values).filter(Number.isFinite);
    rows.push({ tab, verified: true, beforeHitRate, hitRate: afterHitRate, delta: Number.isFinite(beforeHitRate) && Number.isFinite(afterHitRate) ? afterHitRate - beforeHitRate : null, ...values, score: nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null });
  }
  return rows;
}

async function analyze(context, candidate, rules, logs) {
  const criteria = criteriaFromRules(rules);
  const page = await context.newPage();
  const base = {
    id: candidate.href,
    player: candidate.anchorText || candidate.row.split('\n')[0] || 'Unknown player',
    prop: candidate.prop,
    line: candidate.line,
    sport: candidate.sport,
    pick: directionOf(`${candidate.row}\n${candidate.anchorText}`),
    opponent: opponentOf(candidate.row),
    matchId: candidate.matchId,
    sourceUrl: candidate.href,
  };
  try {
    await page.goto(candidate.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await wait(650);
    const unlocked = await pageUnlocked(page);
    const body = await bodyText(page);
    const hasAnalytics = rate(body, 'L5') !== null || rate(body, 'L10') !== null || rate(body, 'L15') !== null;
    if (!unlocked || !hasAnalytics) {
      await diagnostic(page, 'detail-locked-or-missing', { candidate });
      throw new Error(unlocked ? 'Full detail analytics could not be read.' : 'PickFinder detail page is locked.');
    }

    const player = await extractPlayerName(page, candidate);
    const sport = sportFromHref(page.url()) !== 'UNKNOWN' ? sportFromHref(page.url()) : candidate.sport;
    const pick = directionOf(`${candidate.row}\n${body}`);
    const opponent = opponentOf(`${candidate.row}\n${body}`);
    const expected = outcomeOf(body);
    const floor = rules.minFilterHitRate;
    const currentYear = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric' }).format(new Date());
    const regularLine = !/\b(green\s+goblin|goblin|demon|boosted|discount(?:ed)?)\b/i.test(`${candidate.row}\n${body}`)
      && (candidate.top.regular || /\bregular\b|\bmain\b|\bstandard\b/i.test(candidate.row));
    const prizePicksConfirmed = candidate.top.pp || await hasPrizePicks(page, `${candidate.row}\n${body}`);
    const matchToday = todayFromMatchId(candidate.matchId);
    const isToday = matchToday === null ? candidate.top.today : matchToday;

    const audit = [{ label: 'Full detail page', value: page.url(), beforeHitRate: null, hitRate: await hitRate(page), afterHitRate: await hitRate(page), delta: null, required: true, enforceFloor: false, verified: true }];

    audit.push(await auditFilter(page, 'Opponent', opponent ? [opponent] : ['Current'], rules.requireOpponent, floor, opponent ? [new RegExp(`^H2H\\s+vs\\s+${esc(opponent)}`, 'i'), new RegExp(`^vs\\s+${esc(opponent)}`, 'i')] : []));

    if (TEAM_SPORTS.has(sport)) {
      audit.push(await auditFilter(page, 'Season', [currentYear, 'Current'], rules.requireSeason, floor, [new RegExp(`^${currentYear}\\s+Averages`, 'i'), /^2025\s+Averages/i]));
      audit.push(await auditFilter(page, 'Home/Away', ['Current'], rules.requireHomeAway, floor, [/Home Averages/i, /Away Averages/i]));
      audit.push(await auditFilter(page, 'Team', ['Current'], rules.requireTeam, floor, []));
    }

    if (ESPORTS.has(sport)) {
      audit.push(await auditFilter(page, 'Team', ['Current'], rules.requireTeam, floor, [/^Team Form$/i]));
      audit.push(await auditFilter(page, 'Event/Tournament', ['Current'], rules.requireAdvancedAvailable, floor, [/^Matchup$/i]));
      audit.push(await auditFilter(page, 'LAN/Online', ['Current'], rules.requireAdvancedAvailable, floor, []));
    }

    if (sport === 'TENNIS') {
      audit.push(await auditFilter(page, 'Court Type', [surfaceOf(body) || 'Current'], rules.requireAdvancedAvailable, floor, [/Court Type/i, /Surface/i]));
      audit.push(await auditFilter(page, 'Season', [currentYear, 'Current'], rules.requireSeason, floor, [/Player Form/i, /Last 15/i]));
      audit.push(await auditFilter(page, 'Home/Away', ['Current'], rules.requireHomeAway, floor, []));
      audit.push(await auditFilter(page, 'Team', ['Current'], rules.requireTeam, floor, []));
      audit.push(await auditFilter(page, 'Opponent Hand', ['Current'], rules.requireAdvancedAvailable, floor, [/Righty/i, /Lefty/i]));
      audit.push(await auditFilter(page, 'Opponent Rank', ['Current'], rules.requireAdvancedAvailable, floor, [/^VS Rank$/i]));
      audit.push(await auditFilter(page, 'Match Format', ['Current'], rules.requireAdvancedAvailable, floor, [/^Best Of$/i]));
      audit.push(await auditFilter(page, 'Sets Played', ['Current'], rules.requireAdvancedAvailable, floor, [/Total Sets/i, /Sets Won/i, /Sets Lost/i]));
    }

    for (const label of ['Days Rest', 'Rank', 'Spread', 'Minutes Played']) {
      const fallbacks = label === 'Rank' ? [/^Rankings$/i] : [];
      audit.push(await auditFilter(page, label, ['Current'], rules.requireAdvancedAvailable, floor, fallbacks));
    }

    let expectedOutcomeRate = null;
    if (rules.requireWinLoss) {
      if (expected.outcome) {
        const row = await auditFilter(page, 'Win/Loss', [expected.outcome, expected.outcome === 'WIN' ? 'Win' : 'Loss'], true, floor, []);
        audit.push(row);
        expectedOutcomeRate = row.verified && Number.isFinite(Number(row.hitRate)) ? Number(row.hitRate) : null;
      } else {
        audit.push({ label: 'Win/Loss', value: 'Expected result unresolved', beforeHitRate: await hitRate(page), hitRate: null, afterHitRate: null, delta: null, required: true, enforceFloor: true, floor, verified: false });
      }
    } else {
      expectedOutcomeRate = expected.probability;
    }

    const tabAudit = sport === 'TENNIS' ? await tennisTabs(page) : [];
    if (audit.some((row) => row.required && !row.verified)) await diagnostic(page, `${sport}-required-unverified`, { player, candidate, audit });

    return evaluatePick({
      ...base,
      player,
      sport,
      pick,
      opponent,
      l5: rate(body, 'L5'),
      l10: rate(body, 'L10'),
      l15: rate(body, 'L15'),
      h2h: rate(body, 'H2H'),
      expectedOutcome: expected.outcome,
      expectedOutcomeRate,
      avg: numberOrNull((body.match(/Avg(?:\s+L10)?\s*([-+]?\d+(?:\.\d+)?)/i) || [])[1]),
      diff: numberOrNull((body.match(/Diff\s*([-+]?\d+(?:\.\d+)?)/i) || [])[1]),
      regularLine,
      prizePicksConfirmed,
      isToday: Boolean(isToday),
      detailPageVerified: true,
      filterAudit: audit,
      tabAudit,
      strongestTab: [...tabAudit].filter((row) => Number.isFinite(row.score)).sort((a, b) => b.score - a.score)[0]?.tab || null,
    }, criteria);
  } catch (error) {
    logs.push(`Detail failure ${candidate.href}: ${error.message}`);
    return evaluatePick({
      ...base,
      detailPageVerified: false,
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
      isToday: todayFromMatchId(candidate.matchId) === true,
      // `value` is rendered in the prop audit table and `scanError` ships inside
      // latest.json, so neither may carry a raw Playwright/browser message.
      filterAudit: [{ label: 'Full detail page', value: 'Could not be verified', hitRate: null, required: true, enforceFloor: false, verified: false }],
      scanError: publicMessageFor(error, 'This prop could not be fully researched.'),
    }, criteria);
  } finally {
    await page.close().catch(() => {});
  }
}

function bestAvailable(picks, rules) {
  if (!rules.bestAvailable) return [];
  return picks
    .filter((pick) => !pick.qualified
      && pick.detailPageVerified === true
      && pick.regularLine === true
      && pick.prizePicksConfirmed === true
      && pick.isToday === true
      && ['OVER', 'UNDER'].includes(String(pick.pick || '').toUpperCase())
      && Number.isFinite(Number(pick.line)))
    .map((pick) => {
      const misses = [];
      let missing = 0;
      let shortfall = 0;
      const checks = [
        ['L5', pick.l5, rules.minL5],
        ['L10', pick.l10, rules.minL10],
        ['L15', pick.l15, rules.minL15],
      ];
      if (rules.useH2H && pick.h2h !== null && pick.h2h !== undefined) checks.push(['H2H', pick.h2h, rules.minH2H]);
      if (rules.requireWinLoss) checks.push(['Expected W/L', pick.expectedOutcomeRate, rules.minExpectedOutcome]);
      for (const [label, value, floor] of checks) {
        if (!Number.isFinite(Number(value))) { missing++; shortfall += 20; misses.push(`${label} unverified`); }
        else if (Number(value) < floor) { const gap = floor - Number(value); shortfall += gap; misses.push(`${label} short by ${gap}%`); }
      }
      for (const row of pick.filterAudit || []) {
        if (row.enforceFloor === false || row.removedBecauseDataDisappeared) continue;
        const after = row.afterHitRate ?? row.hitRate;
        if (row.required && !Number.isFinite(Number(after))) { missing++; shortfall += 20; misses.push(`${row.label} unverified`); }
        else if (row.verified && Number(after) < rules.minFilterHitRate) { const gap = rules.minFilterHitRate - Number(after); shortfall += gap; misses.push(`${row.label} short by ${gap}%`); }
      }
      const rates = [pick.l5, pick.l10, pick.l15, pick.h2h, pick.expectedOutcomeRate].filter((v) => Number.isFinite(Number(v))).map(Number);
      const base = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
      const researchScore = Math.max(1, Math.min(99, Math.round(base - shortfall * 0.45 - missing * 5)));
      return { ...pick, bestAvailable: true, qualified: false, researchScore, nearMisses: [...new Set(misses)].slice(0, 10), totalShortfall: shortfall, missingRequired: missing };
    })
    .sort((a, b) => a.missingRequired - b.missingRequired || a.totalShortfall - b.totalShortfall || b.researchScore - a.researchScore)
    .slice(0, rules.bestAvailableLimit);
}

export async function verifyPickFinderConnection({ email, password } = {}) {
  if (email || password) await savePickFinderCredentials({ email, password });
  await clearPickFinderSession();
  const logs = [];
  try {
    const { browser, context, page } = await contextWithLogin(logs);
    try {
      if (!await pageUnlocked(page)) throw safeError('PICKFINDER_LOCKED');
      await savePickFinderSession(await context.storageState());
      // `logs` stays server-side: it names selectors, strategies and page state.
      console.log('[AutoProp auth] connection verified', JSON.stringify(logs));
      return { connected: true, ...await getPickFinderConnectionState() };
    } finally {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  } catch (error) {
    await clearPickFinderSession().catch(() => {});
    console.error('[AutoProp auth] connection verification failed', JSON.stringify(internalDetail(error, { logs })));
    throw error;
  }
}

export async function disconnectPickFinder() {
  await clearPickFinderConnection();
  return { connected: false, ...await getPickFinderConnectionState() };
}

export async function runLiveScan({ onProgress, rules: inputRules } = {}) {
  const rules = normalizeRules({ ...(inputRules || {}), preset: inputRules?.preset || 'custom' });
  const logs = [];
  progress(onProgress, { stage: 'starting', message: 'Starting authenticated full-detail PickFinder scan', reviewed: 0, total: 0 });
  const { browser, context, page } = await contextWithLogin(logs, onProgress);
  try {
    const list = await discoverCandidates(page, logs, onProgress);
    const picks = new Array(list.length);
    let next = 0;
    let reviewed = 0;
    let qualifiedSoFar = 0;
    async function worker(number) {
      while (true) {
        const index = next++;
        if (index >= list.length) return;
        progress(onProgress, { stage: 'analyze', message: `Worker ${number}: researching ${index + 1}/${list.length}`, reviewed, total: list.length, qualifiedSoFar });
        const pick = await analyze(context, list[index], rules, logs);
        picks[index] = pick;
        reviewed++;
        if (pick.qualified) qualifiedSoFar++;
        progress(onProgress, { stage: 'analyze', message: pick.qualified ? `${pick.player} qualified` : `${pick.player} reviewed`, reviewed, total: list.length, currentPlayer: pick.player, qualifiedSoFar });
      }
    }
    const workerCount = Math.min(CONCURRENCY, Math.max(1, list.length));
    await Promise.all(Array.from({ length: workerCount }, (_, index) => worker(index + 1)));
    await savePickFinderSession(await context.storageState()).catch(() => {});
    const done = picks.filter(Boolean);
    const qualified = done.filter((pick) => pick.qualified).sort((a, b) => b.confidence - a.confidence);
    const fallback = qualified.length ? [] : bestAvailable(done, rules);
    const warnings = [];
    if (!qualified.length) warnings.push(fallback.length ? `No props passed every active rule. Showing ${fallback.length} Best Available near-misses.` : 'No props passed every active rule and no hard-eligible Best Available props were found.');
    return {
      mode: 'live',
      scannedAt: new Date().toISOString(),
      source: 'PickFinder authenticated full-detail browser scan v2',
      rulesApplied: rules,
      totalReviewed: done.length,
      qualifiedCount: qualified.length,
      rejectedCount: done.length - qualified.length,
      picks: done,
      bestAvailable: fallback,
      diversifiedCard: buildDiversifiedCard(done, 4),
      warnings,
      logs,
      scannerConcurrency: workerCount,
      summaryViewUsedForJudgment: false,
      filterChangeTracking: true,
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
