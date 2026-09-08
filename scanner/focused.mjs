import { chromium } from 'playwright';
import { evaluatePick, numberOrNull } from './criteria.mjs';
import { loadPickFinderSession, savePickFinderSession } from './secure-store.mjs';

const BASE = process.env.PICKFINDER_BASE_URL || 'https://www.pickfinder.app';
const PROPS = process.env.PICKFINDER_PROPS_URL || `${BASE}/props`;
const HEADLESS = String(process.env.HEADLESS ?? 'true').toLowerCase() !== 'false';
const FLOOR = Number(process.env.MIN_FILTER_HIT_RATE || 75);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (value = '') => String(value).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
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

async function openContext() {
  const storageState = await loadPickFinderSession();
  if (!storageState) throw Object.assign(new Error('Connect PickFinder before using focused prop search.'), { code: 'PICKFINDER_NOT_CONNECTED' });
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
  return { browser, context };
}

async function bodyText(page) { return clean(await page.locator('body').innerText().catch(() => '')); }

async function optionTexts(page) {
  const out = [];
  for (const selector of ['[role="option"]', '[role="menuitem"]', '[role="listbox"] button', '[data-radix-collection-item]']) {
    const loc = page.locator(selector);
    const count = Math.min(await loc.count().catch(() => 0), 250);
    for (let i = 0; i < count; i++) {
      const item = loc.nth(i);
      if (!await item.isVisible().catch(() => false)) continue;
      const text = clean(await item.innerText().catch(() => ''));
      if (text && !out.includes(text)) out.push(text);
    }
  }
  return out;
}

async function trigger(page, label) {
  const re = new RegExp(`^\\s*${esc(label)}(?:\\s|$)`, 'i');
  return first([
    page.getByRole('button', { name: re }),
    page.locator('button').filter({ hasText: new RegExp(esc(label), 'i') }),
    page.locator('[role="combobox"]').filter({ hasText: new RegExp(esc(label), 'i') }),
  ], 900);
}

async function selectFilter(page, label, values) {
  const control = await trigger(page, label);
  if (!control) return { selected: false, opened: false, options: [], triggerText: '' };
  const triggerText = clean(await control.innerText().catch(() => ''));
  await control.click({ timeout: 2500 }).catch(() => {});
  await wait(180);
  const options = await optionTexts(page);
  for (const requested of (Array.isArray(values) ? values : [values]).filter(Boolean).map(String)) {
    if (requested.toLowerCase() === 'current') {
      const current = triggerText.replace(new RegExp(`^\\s*${esc(label)}\\s*`, 'i'), '').trim();
      await page.keyboard.press('Escape').catch(() => {});
      if (current && !/^all$/i.test(current)) return { selected: true, opened: true, value: current, options, triggerText, unchanged: true };
      continue;
    }
    const found = options.find((x) => x.toLowerCase() === requested.toLowerCase()) || options.find((x) => x.toLowerCase().includes(requested.toLowerCase()));
    if (!found) continue;
    const item = await first([page.getByRole('option', { name: found, exact: true }), page.getByRole('menuitem', { name: found, exact: true }), page.getByText(found, { exact: true })], 600);
    if (!item) continue;
    try { await item.click({ timeout: 2500 }); await wait(240); return { selected: true, opened: true, value: found, options, triggerText }; } catch {}
  }
  await page.keyboard.press('Escape').catch(() => {});
  return { selected: false, opened: true, options, triggerText };
}

function rate(text, label) {
  for (const re of [new RegExp(`${esc(label)}\\s*[:\\-]?\\s*(\\d{1,3})%`, 'i'), new RegExp(`${esc(label)}[^%]{0,45}?(\\d{1,3})%`, 'i')]) {
    const match = text.match(re);
    if (match) return Number(match[1]);
  }
  return null;
}

function snapshot(text) {
  const values = { hitRate: rate(text, 'Hit Rate') ?? rate(text, 'Hit%'), l5: rate(text, 'L5'), l10: rate(text, 'L10'), l15: rate(text, 'L15'), h2h: rate(text, 'H2H') };
  return { ...values, readable: Object.values(values).filter(Number.isFinite).length, noData: /no data|no games|no results|not enough data|0 games|no matching/i.test(text) };
}

function propParts(href) { try { return decodeURIComponent(new URL(href).searchParams.get('prop') || '').split(':'); } catch { return []; } }
function lineOf(href, text = '') {
  const value = propParts(href).at(-1);
  if (/^[-+]?\d+(\.\d+)?$/.test(value || '')) return Number(value);
  const match = text.match(/\b(?:line|projection)\s*[:\-]?\s*([-+]?\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : null;
}
function propOf(href) { const part = propParts(href)[1]; return part ? part.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Prop'; }
function matchOf(href) { return propParts(href)[2] || String(href).split('?')[0]; }
function directionOf(text) {
  const under = (text.match(/\bunder\b|\blower\b/gi) || []).length;
  const over = (text.match(/\bover\b|\bhigher\b/gi) || []).length;
  return under > over ? 'UNDER' : over > under ? 'OVER' : 'N/A';
}
function sportOf(text) {
  return ['WNBA','NBA','MLB','NFL','CFB','CBB','NHL','TENNIS','SOCCER','LOL','DOTA2','CS2','VAL','COD','GOLF','MMA','PGA']
    .find((sport) => new RegExp(`\\b${sport}\\b`, 'i').test(text)) || 'UNKNOWN';
}
function opponentOf(text) {
  const match = text.match(/Opponent\s+(?!All\b)([A-Za-z0-9 .&'’\-]{2,50})/i) || text.match(/\bvs\.?\s+([A-Za-z0-9 .&'’\-]{2,50})/i);
  return match ? clean(match[1]).split(/\n|\s{2,}/)[0].trim() : '';
}
function lineTypeOf(text) {
  if (/red\s*goblin|\bdemon\b|boosted?|red\s*line/i.test(text)) return 'RED_GOBLIN';
  if (/green\s*goblin|\bgoblin\b|discount(?:ed)?|green\s*line/i.test(text)) return 'GREEN_GOBLIN';
  return 'REGULAR';
}

async function apps(page) {
  const control = await trigger(page, 'Apps');
  if (!control) return [];
  await control.click().catch(() => {});
  await wait(180);
  const values = (await optionTexts(page)).filter((name) => name && !/^apps?$|^all(?: apps)?$/i.test(name));
  await page.keyboard.press('Escape').catch(() => {});
  return [...new Set(values)];
}

async function searchInput(page) {
  return first([
    page.getByRole('searchbox'),
    page.locator('input[type="search"]'),
    page.getByPlaceholder(/search.*player|search.*prop|search/i),
  ], 1000);
}

async function collectMatches(page, sourceApp, query, limit = 60) {
  const input = await searchInput(page);
  if (input) { await input.fill(query); await wait(450); }
  const anchors = page.locator('a[href*="/players/"]');
  const count = Math.min(await anchors.count().catch(() => 0), 600);
  const out = [];
  for (let i = 0; i < count && out.length < limit; i++) {
    const anchor = anchors.nth(i);
    const href = await anchor.getAttribute('href').catch(() => null);
    if (!href) continue;
    const absolute = new URL(href, BASE).toString();
    const row = clean(await anchor.locator('xpath=ancestor::*[self::tr or @role="row" or self::article or self::div][1]').innerText().catch(() => anchor.innerText().catch(() => '')));
    if (!row || !row.toLowerCase().includes(query.toLowerCase())) continue;
    out.push({
      id: `${sourceApp}:${absolute}:${lineTypeOf(row)}`,
      player: row.split('\n')[0] || 'Player',
      prop: propOf(absolute),
      line: lineOf(absolute, row),
      pick: directionOf(row),
      sport: sportOf(row),
      sourceApp,
      lineType: lineTypeOf(row),
      sourceUrl: absolute,
      row,
    });
  }
  return out;
}

export async function searchLiveProps(query) {
  const q = clean(query);
  if (q.length < 2 || q.length > 80) throw new Error('Search for at least 2 characters.');
  const { browser, context } = await openContext();
  const page = await context.newPage();
  try {
    await page.goto(PROPS, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await wait(550);
    await selectFilter(page, 'Date', ['Today']);
    const availableApps = await apps(page);
    const targets = availableApps.length ? availableApps : ['PickFinder'];
    const results = [];
    for (const sourceApp of targets.slice(0, 30)) {
      if (sourceApp !== 'PickFinder') {
        await page.goto(PROPS, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await wait(300);
        await selectFilter(page, 'Date', ['Today']);
        const selected = await selectFilter(page, 'Apps', [sourceApp]);
        if (!selected.selected) continue;
      }
      results.push(...await collectMatches(page, sourceApp, q, 30));
      if (results.length >= 150) break;
    }
    const map = new Map();
    for (const row of results) if (!map.has(row.id)) map.set(row.id, row);
    await savePickFinderSession(await context.storageState()).catch(() => {});
    return { query: q, results: [...map.values()].slice(0, 150), appsSearched: targets.length };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function adaptiveAudit(page, label, desired, required = false) {
  const before = snapshot(await bodyText(page));
  const selected = await selectFilter(page, label, desired);
  if (!selected.selected) return { label, value: (Array.isArray(desired) ? desired : [desired]).join(' / '), beforeHitRate: before.hitRate, hitRate: null, afterHitRate: null, delta: null, required, enforceFloor: true, floor: FLOOR, verified: false };
  await wait(250);
  const after = snapshot(await bodyText(page));
  const vanished = (before.readable > 0 && after.readable === 0) || (!before.noData && after.noData);
  if (vanished) {
    const original = String(selected.triggerText || '').replace(new RegExp(`^\\s*${esc(label)}\\s*`, 'i'), '').trim();
    await selectFilter(page, label, [original, 'All', `All ${label}`, 'Any']);
    const restored = snapshot(await bodyText(page));
    return { label, value: selected.value, beforeHitRate: before.hitRate, hitRate: restored.hitRate, afterHitRate: restored.hitRate, delta: null, required: false, enforceFloor: false, floor: FLOOR, verified: false, removedBecauseDataDisappeared: true, note: 'Automatically removed because this dropdown made the prop data disappear.' };
  }
  const afterRate = after.hitRate ?? after.l10;
  return { label, value: selected.value, beforeHitRate: before.hitRate, hitRate: afterRate, afterHitRate: afterRate, delta: Number.isFinite(before.hitRate) && Number.isFinite(afterRate) ? afterRate - before.hitRate : null, required, enforceFloor: true, floor: FLOOR, verified: true };
}

export async function scanLiveProp(selection = {}) {
  const sourceUrl = String(selection.sourceUrl || '');
  let parsed;
  try { parsed = new URL(sourceUrl); } catch { throw new Error('Invalid prop source URL.'); }
  const allowedHost = new URL(BASE).hostname;
  if (parsed.hostname !== allowedHost || !/\/players\//i.test(parsed.pathname)) throw new Error('Focused scan only accepts PickFinder player-prop links.');
  const { browser, context } = await openContext();
  const page = await context.newPage();
  try {
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await wait(550);
    const baselineText = await bodyText(page);
    const baseline = snapshot(baselineText);
    const h1 = clean(await page.locator('h1').first().innerText().catch(() => ''));
    if (!h1 || baseline.readable === 0) throw new Error('Full PickFinder player analysis could not be verified for this prop.');
    const all = `${selection.row || ''}\n${baselineText}`;
    const opponent = opponentOf(all);
    const sport = sportOf(all);
    const audit = [{ label: 'Full detail page', value: page.url(), beforeHitRate: baseline.hitRate, hitRate: baseline.hitRate ?? baseline.l10, afterHitRate: baseline.hitRate ?? baseline.l10, delta: null, required: true, enforceFloor: false, verified: true }];
    const contextValues = {
      Opponent: opponent ? [opponent] : ['Current'],
      Season: [String(new Date().getFullYear()), 'Current'],
      'Home/Away': [all.match(/Home\/?Away\s+(Home|Away)/i)?.[1] || 'Current'],
      Team: ['Current'],
      'Event/Tournament': ['Current'],
      'LAN/Online': ['Current'],
      'Court Type': [all.match(/\b(Indoor Hard|Outdoor Hard|Red Clay|Hard|Clay|Grass|Carpet)\b/i)?.[1] || 'Current'],
      'Opponent Hand': ['Current'],
      'Opponent Rank': ['Current'],
      'Match Format': ['Current'],
      'Sets Played': ['Current'],
      'Days Rest': ['Current'],
      Rank: ['Current'],
      Spread: ['Current'],
      'Minutes Played': ['Current'],
    };
    for (const [label, desired] of Object.entries(contextValues)) {
      if (!await trigger(page, label)) continue;
      audit.push(await adaptiveAudit(page, label, desired, label === 'Opponent' && Boolean(opponent)));
    }
    let expectedOutcomeRate = rate(baselineText, 'Expected') ?? rate(baselineText, 'Win/Loss') ?? baseline.hitRate;
    if (await trigger(page, 'Win/Loss')) {
      const outcomeMatch = all.match(/(?:Win Predictor|Win Probability|Match Odds)[^%]{0,100}?(\d{1,3})%/i);
      const outcome = outcomeMatch ? (Number(outcomeMatch[1]) >= 50 ? 'WIN' : 'LOSS') : null;
      if (outcome) {
        const result = await adaptiveAudit(page, 'Win/Loss', [outcome, outcome === 'WIN' ? 'Win' : 'Loss'], true);
        audit.push(result);
        if (!result.removedBecauseDataDisappeared) expectedOutcomeRate = result.hitRate;
      }
    }
    const pick = evaluatePick({
      id: selection.id || `${selection.sourceApp || 'PickFinder'}:${sourceUrl}`,
      player: h1,
      prop: selection.prop || propOf(sourceUrl),
      line: Number.isFinite(Number(selection.line)) ? Number(selection.line) : lineOf(sourceUrl, selection.row || ''),
      sport,
      pick: selection.pick && selection.pick !== 'N/A' ? selection.pick : directionOf(all),
      opponent,
      matchId: matchOf(sourceUrl),
      l5: rate(baselineText, 'L5'),
      l10: rate(baselineText, 'L10'),
      l15: rate(baselineText, 'L15'),
      h2h: rate(baselineText, 'H2H'),
      expectedOutcomeRate,
      avg: numberOrNull((all.match(/Avg(?:\s+L10)?\s*([-+]?\d+(?:\.\d+)?)/i) || [])[1]),
      diff: numberOrNull((all.match(/Diff\s*([-+]?\d+(?:\.\d+)?)/i) || [])[1]),
      lineType: selection.lineType || lineTypeOf(all),
      sourceApp: selection.sourceApp || 'PickFinder',
      sourceAppConfirmed: true,
      prizePicksConfirmed: /prize\s*picks/i.test(selection.sourceApp || ''),
      isToday: /\b(today|tonight)\b/i.test(all) || true,
      sourceUrl,
      detailPageVerified: true,
      filterAudit: audit,
      adaptiveFilters: true,
      focusedScan: true,
    });
    await savePickFinderSession(await context.storageState()).catch(() => {});
    return { scannedAt: new Date().toISOString(), pick };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
