import { chromium } from 'playwright';
import { evaluatePick, buildDiversifiedCard, numberOrNull } from './criteria.mjs';
import {
  runLiveScan as runRegularScan,
  verifyPickFinderConnection,
  disconnectPickFinder,
} from './pickfinder.mjs';
import { loadPickFinderSession, savePickFinderSession } from './secure-store.mjs';

export { verifyPickFinderConnection, disconnectPickFinder };

const BASE = process.env.PICKFINDER_BASE_URL || 'https://www.pickfinder.app';
const PROPS = process.env.PICKFINDER_PROPS_URL || `${BASE}/props`;
const HEADLESS = String(process.env.HEADLESS ?? 'true').toLowerCase() !== 'false';
const FLOOR = Number(process.env.MIN_FILTER_HIT_RATE || 75);
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.SCAN_CONCURRENCY || 3)));
const MAX_PER_APP = Math.max(1, Number(process.env.MAX_PER_APP || 500));
const MAX_TOTAL = Math.max(1, Number(process.env.MAX_TOTAL_CANDIDATES || 3000));
const SCAN_ALL_PROPS = String(process.env.SCAN_ALL_PROPS ?? 'true').toLowerCase() !== 'false';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (value = '') => String(value).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const esc = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function progress(cb, value) { try { cb?.(value); } catch {} }

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
  for (const selector of ['[role="option"]', '[role="menuitem"]', '[role="listbox"] button', '[data-radix-collection-item]']) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 250);
    for (let i = 0; i < count; i++) {
      const item = locator.nth(i);
      if (!await item.isVisible().catch(() => false)) continue;
      const text = clean(await item.innerText().catch(() => ''));
      if (text && !out.includes(text)) out.push(text);
    }
  }
  return out;
}

async function filterTrigger(page, label) {
  const re = new RegExp(`^\\s*${esc(label)}(?:\\s|$)`, 'i');
  return first([
    page.getByRole('button', { name: re }),
    page.locator('button').filter({ hasText: new RegExp(esc(label), 'i') }),
    page.locator('[role="combobox"]').filter({ hasText: new RegExp(esc(label), 'i') }),
  ], 900);
}

async function clickName(page, value, exact = true) {
  const re = value instanceof RegExp ? value : new RegExp(exact ? `^${esc(value)}$` : esc(value), 'i');
  const item = await first([
    page.getByRole('option', { name: re }),
    page.getByRole('menuitem', { name: re }),
    page.getByRole('button', { name: re }),
    page.getByText(re, { exact }),
  ], 800);
  if (!item) return false;
  try {
    await item.scrollIntoViewIfNeeded().catch(() => {});
    await item.click({ timeout: 2500 });
    await wait(240);
    return true;
  } catch { return false; }
}

async function inspectFilter(page, label) {
  const trigger = await filterTrigger(page, label);
  if (!trigger) return { exists: false, options: [], triggerText: '' };
  const triggerText = clean(await trigger.innerText().catch(() => ''));
  await trigger.click({ timeout: 2500 }).catch(() => {});
  await wait(180);
  const options = await optionTexts(page);
  await page.keyboard.press('Escape').catch(() => {});
  return { exists: true, options, triggerText };
}

async function selectFilter(page, label, requestedValues) {
  const trigger = await filterTrigger(page, label);
  if (!trigger) return { opened: false, selected: false, value: null, options: [], triggerText: '' };
  const triggerText = clean(await trigger.innerText().catch(() => ''));
  await trigger.click({ timeout: 2500 }).catch(() => {});
  await wait(180);
  const options = await optionTexts(page);
  const requested = (Array.isArray(requestedValues) ? requestedValues : [requestedValues]).filter(Boolean).map(String);
  for (const candidate of requested) {
    if (candidate.toLowerCase() === 'current') {
      const current = triggerText.replace(new RegExp(`^\\s*${esc(label)}\\s*`, 'i'), '').trim();
      if (current && !/^all$/i.test(current) && current.toLowerCase() !== label.toLowerCase()) {
        await page.keyboard.press('Escape').catch(() => {});
        return { opened: true, selected: true, value: current, options, triggerText, unchanged: true };
      }
      continue;
    }
    const found = options.find((x) => x.toLowerCase() === candidate.toLowerCase())
      || options.find((x) => x.toLowerCase().includes(candidate.toLowerCase()));
    if (found && await clickName(page, found, true)) return { opened: true, selected: true, value: found, options, triggerText };
  }
  await page.keyboard.press('Escape').catch(() => {});
  return { opened: true, selected: false, value: null, options, triggerText };
}

function rate(text, label) {
  for (const re of [new RegExp(`${esc(label)}\\s*[:\\-]?\\s*(\\d{1,3})%`, 'i'), new RegExp(`${esc(label)}[^%]{0,45}?(\\d{1,3})%`, 'i')]) {
    const match = text.match(re);
    if (match) return Number(match[1]);
  }
  return null;
}

function analyticsSnapshot(text) {
  const values = {
    hitRate: rate(text, 'Hit Rate') ?? rate(text, 'Hit%'),
    l5: rate(text, 'L5'),
    l10: rate(text, 'L10'),
    l15: rate(text, 'L15'),
    h2h: rate(text, 'H2H'),
  };
  const readable = Object.values(values).filter((value) => Number.isFinite(value)).length;
  const noData = /no data|no games|no results|not enough data|0 games|no matching/i.test(text);
  return { ...values, readable, noData };
}

async function revertFilter(page, label, result) {
  const original = String(result.triggerText || '').replace(new RegExp(`^\\s*${esc(label)}\\s*`, 'i'), '').trim();
  const candidates = [original, 'All', `All ${label}`, 'Any', 'None'].filter(Boolean);
  const reset = await selectFilter(page, label, candidates);
  return reset.selected;
}

async function adaptiveAudit(page, label, desired, { required = false, enforceFloor = true } = {}) {
  const beforeText = await bodyText(page);
  const before = analyticsSnapshot(beforeText);
  const result = await selectFilter(page, label, desired);
  if (!result.selected) {
    return {
      label,
      value: (Array.isArray(desired) ? desired : [desired]).filter(Boolean).join(' / ') || 'Current',
      beforeHitRate: before.hitRate,
      hitRate: null,
      afterHitRate: null,
      delta: null,
      required,
      enforceFloor,
      floor: FLOOR,
      verified: false,
      availableOptions: result.options?.slice(0, 40) || [],
    };
  }

  await wait(300);
  const afterText = await bodyText(page);
  const after = analyticsSnapshot(afterText);
  const dataDisappeared = (before.readable > 0 && after.readable === 0) || (!before.noData && after.noData);
  if (dataDisappeared) {
    const reverted = await revertFilter(page, label, result);
    const restored = analyticsSnapshot(await bodyText(page));
    return {
      label,
      value: result.value,
      beforeHitRate: before.hitRate,
      hitRate: restored.hitRate,
      afterHitRate: restored.hitRate,
      delta: null,
      required: false,
      enforceFloor: false,
      floor: FLOOR,
      verified: false,
      removedBecauseDataDisappeared: true,
      reverted,
      note: 'Filter removed automatically because it made this prop data disappear.',
      availableOptions: result.options?.slice(0, 40) || [],
    };
  }

  return {
    label,
    value: result.value,
    beforeHitRate: before.hitRate,
    hitRate: after.hitRate ?? after.l10,
    afterHitRate: after.hitRate ?? after.l10,
    delta: Number.isFinite(before.hitRate) && Number.isFinite(after.hitRate) ? after.hitRate - before.hitRate : null,
    required,
    enforceFloor,
    floor: FLOOR,
    verified: true,
    availableOptions: result.options?.slice(0, 40) || [],
  };
}

function propParts(href) {
  try { return decodeURIComponent(new URL(href).searchParams.get('prop') || '').split(':'); } catch { return []; }
}
function lineOf(href, text = '') {
  const value = propParts(href).at(-1);
  if (/^[-+]?\d+(\.\d+)?$/.test(value || '')) return Number(value);
  const match = text.match(/\b(?:line|projection)\s*[:\-]?\s*([-+]?\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : null;
}
function propOf(href) {
  const part = propParts(href)[1];
  return part ? part.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Prop';
}
function matchOf(href) { return propParts(href)[2] || String(href).split('?')[0]; }
function sportOf(text) {
  return ['WNBA','NBA','MLB','NFL','CFB','CBB','NHL','TENNIS','SOCCER','LOL','DOTA2','CS2','VAL','COD','GOLF','MMA','PGA']
    .find((sport) => new RegExp(`\\b${sport}\\b`, 'i').test(text)) || 'UNKNOWN';
}
function directionOf(text) {
  const under = (text.match(/\bunder\b|\blower\b/gi) || []).length;
  const over = (text.match(/\bover\b|\bhigher\b/gi) || []).length;
  return under > over ? 'UNDER' : over > under ? 'OVER' : 'N/A';
}
function opponentOf(text) {
  const match = text.match(/Opponent\s+(?!All\b)([A-Za-z0-9 .&'’\-]{2,50})/i) || text.match(/\bvs\.?\s+([A-Za-z0-9 .&'’\-]{2,50})/i);
  return match ? clean(match[1]).split(/\n|\s{2,}/)[0].trim() : '';
}
function venueOf(text) {
  const match = text.match(/Home\/?Away\s+(Home|Away)/i);
  return match?.[1] || null;
}
function surfaceOf(text) { return text.match(/\b(Indoor Hard|Outdoor Hard|Red Clay|Hard|Clay|Grass|Carpet)\b/i)?.[1] || null; }
function outcomeOf(text) {
  const match = text.match(/(?:Win Predictor|Win Probability|Match Odds)[^%]{0,100}?(\d{1,3})%/i);
  return match ? (Number(match[1]) >= 50 ? 'WIN' : 'LOSS') : null;
}

function classifyLineType(text = '', selectedModifier = '') {
  const combined = `${selectedModifier} ${text}`;
  if (/red\s*goblin|\bdemon\b|boosted?|red\s*line/i.test(combined)) return 'RED_GOBLIN';
  if (/green\s*goblin|\bgoblin\b|discount(?:ed)?|green\s*line/i.test(combined)) return 'GREEN_GOBLIN';
  if (/regular|main|standard/i.test(combined)) return 'REGULAR';
  return selectedModifier ? 'UNKNOWN' : 'REGULAR';
}

async function discoverApps(page) {
  const info = await inspectFilter(page, 'Apps');
  const apps = info.options
    .map(clean)
    .filter((name) => name && !/^all(?: apps)?$/i.test(name) && !/^apps$/i.test(name));
  return [...new Set(apps)];
}

async function discoverModifiers(page) {
  const info = await inspectFilter(page, 'Modifier');
  if (!info.exists || !info.options.length) return [{ label: 'Current', lineType: 'REGULAR', useCurrent: true }];
  const usable = info.options.map(clean).filter((name) => name && !/^modifier$/i.test(name));
  const preferred = usable.filter((name) => /regular|main|standard|goblin|demon|discount|boost|green|red/i.test(name));
  const source = preferred.length ? preferred : usable.filter((name) => !/^all$/i.test(name));
  return [...new Set(source)].map((label) => ({ label, lineType: classifyLineType('', label), useCurrent: false }));
}

async function loadAllAnchors(page) {
  let stable = 0;
  let previous = -1;
  const loops = SCAN_ALL_PROPS ? 45 : 6;
  for (let i = 0; i < loops && stable < 3; i++) {
    const count = await page.locator('a[href*="/players/"]').count().catch(() => 0);
    if (count === previous) stable++; else stable = 0;
    previous = count;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await wait(350);
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
}

async function discoverCandidates(page, app, modifier, topToday) {
  await page.goto(PROPS, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await wait(550);
  const appSelection = await selectFilter(page, 'Apps', [app]);
  if (!appSelection.selected) return { candidates: [], appConfirmed: false, modifierConfirmed: false };
  const todaySelection = await selectFilter(page, 'Date', ['Today']);
  let modifierConfirmed = modifier.useCurrent;
  if (!modifier.useCurrent) {
    const selected = await selectFilter(page, 'Modifier', [modifier.label]);
    modifierConfirmed = selected.selected;
    if (!selected.selected) return { candidates: [], appConfirmed: true, modifierConfirmed: false };
  }
  await loadAllAnchors(page);
  const anchors = page.locator('a[href*="/players/"]');
  const count = await anchors.count().catch(() => 0);
  const out = [];
  const seen = new Set();
  for (let i = 0; i < count && out.length < MAX_PER_APP; i++) {
    const anchor = anchors.nth(i);
    const href = await anchor.getAttribute('href').catch(() => null);
    if (!href) continue;
    const absolute = new URL(href, BASE).toString();
    const row = clean(await anchor.locator('xpath=ancestor::*[self::tr or @role="row" or self::article or self::div][1]').innerText().catch(() => anchor.innerText().catch(() => '')));
    if (!row) continue;
    const lineType = classifyLineType(row, modifier.label);
    if (modifier.lineType !== 'UNKNOWN' && lineType !== modifier.lineType && modifier.lineType !== 'REGULAR') continue;
    const key = `${absolute}|${app}|${lineType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ href: absolute, row, sourceApp: app, sourceAppConfirmed: true, lineType, modifierLabel: modifier.label, modifierConfirmed, topToday: topToday || todaySelection.selected });
  }
  return { candidates: out, appConfirmed: true, modifierConfirmed };
}

async function availableAuditPlan(page, context) {
  const controls = await page.locator('button,[role="combobox"]').allInnerTexts().catch(() => []);
  const text = controls.map(clean).join('\n');
  const known = ['Opponent','Season','Home/Away','Team','Event/Tournament','LAN/Online','Court Type','Opponent Hand','Opponent Rank','Match Format','Sets Played','Days Rest','Rank','Spread','Minutes Played','Win/Loss'];
  return known.filter((label) => new RegExp(esc(label), 'i').test(text)).map((label) => {
    if (label === 'Opponent') return { label, desired: context.opponent ? [context.opponent] : ['Current'], required: Boolean(context.opponent) };
    if (label === 'Season') return { label, desired: [String(new Date().getFullYear()), 'Current'], required: true };
    if (label === 'Home/Away') return { label, desired: context.venue ? [context.venue] : ['Current'], required: false };
    if (label === 'Court Type') return { label, desired: context.surface ? [context.surface] : ['Current'], required: context.sport === 'TENNIS' };
    if (label === 'Win/Loss') return { label, desired: context.outcome ? [context.outcome, context.outcome === 'WIN' ? 'Win' : 'Loss'] : ['Current'], required: Boolean(context.outcome), outcome: true };
    return { label, desired: ['Current'], required: false };
  });
}

async function analyzeCandidate(context, candidate) {
  const page = await context.newPage();
  try {
    await page.goto(candidate.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await wait(550);
    const body = await bodyText(page);
    const h1 = clean(await page.locator('h1').first().innerText().catch(() => ''));
    const analytics = analyticsSnapshot(body);
    if (!h1 || analytics.readable === 0) throw new Error('Full player analytics page could not be verified.');
    const all = `${candidate.row}\n${body}`;
    const sport = sportOf(all);
    const opponent = opponentOf(all);
    const venue = venueOf(all);
    const surface = surfaceOf(all);
    const outcome = outcomeOf(all);
    const pick = directionOf(candidate.row) !== 'N/A' ? directionOf(candidate.row) : directionOf(body);
    const auditRows = [{ label: 'Full detail page', value: page.url(), beforeHitRate: analytics.hitRate, hitRate: analytics.hitRate ?? analytics.l10, afterHitRate: analytics.hitRate ?? analytics.l10, delta: null, required: true, enforceFloor: false, verified: true }];
    const plan = await availableAuditPlan(page, { sport, opponent, venue, surface, outcome });
    let outcomeRate = null;
    for (const row of plan) {
      const audited = await adaptiveAudit(page, row.label, row.desired, { required: row.required, enforceFloor: true });
      auditRows.push(audited);
      if (row.outcome && !audited.removedBecauseDataDisappeared) outcomeRate = audited.hitRate;
    }
    if (outcomeRate === null) outcomeRate = rate(body, 'Win/Loss') ?? rate(body, 'Expected') ?? analytics.hitRate;
    const avg = numberOrNull((all.match(/Avg(?:\s+L10)?\s*([-+]?\d+(?:\.\d+)?)/i) || [])[1]);
    const diff = numberOrNull((all.match(/Diff\s*([-+]?\d+(?:\.\d+)?)/i) || [])[1]);
    return evaluatePick({
      id: `${candidate.sourceApp}:${candidate.lineType}:${candidate.href}`,
      player: h1,
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
      lineType: candidate.lineType,
      modifierLabel: candidate.modifierLabel,
      sourceApp: candidate.sourceApp,
      sourceAppConfirmed: candidate.sourceAppConfirmed,
      prizePicksConfirmed: /prize\s*picks/i.test(candidate.sourceApp),
      isToday: candidate.topToday || /\b(today|tonight)\b/i.test(all),
      sourceUrl: candidate.href,
      detailPageVerified: true,
      filterAudit: auditRows,
      adaptiveFilters: true,
    });
  } catch (error) {
    return evaluatePick({
      id: `${candidate.sourceApp}:${candidate.lineType}:${candidate.href}`,
      player: candidate.row.split('\n')[0] || 'Unresolved',
      prop: propOf(candidate.href),
      line: lineOf(candidate.href, candidate.row),
      sport: sportOf(candidate.row),
      pick: directionOf(candidate.row),
      opponent: opponentOf(candidate.row),
      matchId: matchOf(candidate.href),
      l5: null, l10: null, l15: null, h2h: null, expectedOutcome: null, expectedOutcomeRate: null,
      lineType: candidate.lineType,
      modifierLabel: candidate.modifierLabel,
      sourceApp: candidate.sourceApp,
      sourceAppConfirmed: candidate.sourceAppConfirmed,
      prizePicksConfirmed: /prize\s*picks/i.test(candidate.sourceApp),
      isToday: candidate.topToday,
      sourceUrl: candidate.href,
      detailPageVerified: false,
      filterAudit: [{ label: 'Full detail page', value: error.message, beforeHitRate: null, hitRate: null, required: true, enforceFloor: false, verified: false }],
      adaptiveFilters: true,
    });
  } finally {
    await page.close().catch(() => {});
  }
}

function dedupePicks(picks) {
  const map = new Map();
  for (const pick of picks) {
    const key = [pick.sourceApp || 'PrizePicks', pick.player, pick.prop, pick.line, pick.pick, pick.lineType || (pick.regularLine ? 'REGULAR' : 'UNKNOWN')].join('|').toLowerCase();
    const previous = map.get(key);
    if (!previous || Number(pick.confidence || 0) > Number(previous.confidence || 0) || (pick.qualified && !previous.qualified)) map.set(key, pick);
  }
  return [...map.values()];
}

function topByType(picks, lineType, limit = 12) {
  return picks.filter((pick) => pick.lineType === lineType).sort((a, b) => Number(b.qualified) - Number(a.qualified) || Number(b.confidence || 0) - Number(a.confidence || 0)).slice(0, limit);
}

async function supplementalScan({ onProgress } = {}) {
  const storageState = await loadPickFinderSession();
  if (!storageState) return { picks: [], apps: [], warnings: ['Supplemental multi-book scan skipped because no saved PickFinder session was available.'] };
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
  const page = await context.newPage();
  try {
    await page.goto(PROPS, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await wait(600);
    const apps = await discoverApps(page);
    const selectedApps = apps.length ? apps : ['PrizePicks'];
    const candidates = [];
    const inventory = [];
    for (let appIndex = 0; appIndex < selectedApps.length && candidates.length < MAX_TOTAL; appIndex++) {
      const app = selectedApps[appIndex];
      progress(onProgress, { stage: 'books', message: `Discovering ${app} props (${appIndex + 1}/${selectedApps.length})`, reviewed: 0, total: candidates.length });
      await page.goto(PROPS, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await wait(400);
      const appSel = await selectFilter(page, 'Apps', [app]);
      if (!appSel.selected) { inventory.push({ app, available: false, modifiers: [] }); continue; }
      await selectFilter(page, 'Date', ['Today']);
      const modifiers = await discoverModifiers(page);
      inventory.push({ app, available: true, modifiers: modifiers.map((m) => m.label) });
      for (const modifier of modifiers) {
        if (/prize\s*picks/i.test(app) && modifier.lineType === 'REGULAR') continue;
        const found = await discoverCandidates(page, app, modifier, true);
        for (const candidate of found.candidates) {
          candidates.push(candidate);
          if (candidates.length >= MAX_TOTAL) break;
        }
        if (candidates.length >= MAX_TOTAL) break;
      }
    }

    const picks = new Array(candidates.length);
    let next = 0;
    let reviewed = 0;
    async function worker(workerNumber) {
      while (true) {
        const index = next++;
        if (index >= candidates.length) return;
        const candidate = candidates[index];
        progress(onProgress, { stage: 'multibook', message: `${candidate.sourceApp} • ${candidate.lineType.replaceAll('_', ' ')} • ${index + 1}/${candidates.length}`, reviewed, total: candidates.length });
        picks[index] = await analyzeCandidate(context, candidate);
        reviewed++;
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, candidates.length)) }, (_, index) => worker(index + 1)));
    await savePickFinderSession(await context.storageState()).catch(() => {});
    return { picks: picks.filter(Boolean), apps: inventory, warnings: candidates.length >= MAX_TOTAL ? [`Multi-book scan reached MAX_TOTAL_CANDIDATES=${MAX_TOTAL}. Raise it to scan a larger board.`] : [] };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

export async function runLiveScan(options = {}) {
  progress(options.onProgress, { stage: 'regular', message: 'Running strict PrizePicks regular-line scan', reviewed: 0, total: 0 });
  const regular = await runRegularScan(options);
  progress(options.onProgress, { stage: 'multibook', message: 'Expanding to Goblins and every PickFinder app/book', reviewed: 0, total: 0 });
  const supplemental = await supplementalScan(options);
  const regularTagged = (regular.picks || []).map((pick) => ({ ...pick, sourceApp: pick.sourceApp || 'PrizePicks', sourceAppConfirmed: true, lineType: pick.lineType || 'REGULAR' }));
  const picks = dedupePicks([...regularTagged, ...supplemental.picks]);
  const qualified = picks.filter((pick) => pick.qualified).sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
  const greenGoblins = topByType(picks, 'GREEN_GOBLIN');
  const redGoblins = topByType(picks, 'RED_GOBLIN');
  return {
    ...regular,
    mode: 'live',
    scannedAt: new Date().toISOString(),
    source: 'PickFinder authenticated multi-book full-detail scan',
    scannerVersion: 'masterpiece-1',
    allPickFinderAppsDiscoveredAtRuntime: true,
    adaptiveDropdownRollback: true,
    totalReviewed: picks.length,
    qualifiedCount: qualified.length,
    rejectedCount: picks.length - qualified.length,
    picks,
    diversifiedCard: buildDiversifiedCard(picks, 4),
    appInventory: supplemental.apps,
    greenGoblins,
    redGoblins,
    warnings: [...(regular.warnings || []), ...supplemental.warnings],
    logs: [...(regular.logs || []), `Dynamic PickFinder app inventory: ${supplemental.apps.map((row) => row.app).join(', ') || 'none discovered'}`],
  };
}
