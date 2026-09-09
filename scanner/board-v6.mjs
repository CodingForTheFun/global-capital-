import { chromium } from 'playwright';
import { loadPickFinderSession, savePickFinderSession } from './secure-store.mjs';

const BASE = process.env.PICKFINDER_BASE_URL || 'https://www.pickfinder.app';
const PROPS = process.env.PICKFINDER_PROPS_URL || `${BASE}/props`;
const HEADLESS = String(process.env.HEADLESS ?? 'true').toLowerCase() !== 'false';
const MAX_BOARD_PROPS = Math.max(1000, Number(process.env.MAX_BOARD_PROPS || 25000));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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

async function optionTexts(page) {
  const out = [];
  for (const selector of ['[role="option"]','[role="menuitem"]','[role="listbox"] button','[data-radix-collection-item]']) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 400);
    for (let i = 0; i < count; i++) {
      const item = locator.nth(i);
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
  ], 850);
}

async function inspect(page, label) {
  const t = await trigger(page, label);
  if (!t) return { exists: false, options: [], text: '' };
  const text = clean(await t.innerText().catch(() => ''));
  await t.click({ timeout: 2200 }).catch(() => {});
  await wait(160);
  const options = await optionTexts(page);
  await page.keyboard.press('Escape').catch(() => {});
  return { exists: true, options, text };
}

async function choose(page, label, values) {
  const t = await trigger(page, label);
  if (!t) return false;
  await t.click({ timeout: 2200 }).catch(() => {});
  await wait(150);
  const options = await optionTexts(page);
  for (const desired of values.filter(Boolean)) {
    const found = options.find((x) => x.toLowerCase() === String(desired).toLowerCase())
      || options.find((x) => x.toLowerCase().includes(String(desired).toLowerCase()));
    if (!found) continue;
    const re = new RegExp(`^${esc(found)}$`, 'i');
    const item = await first([
      page.getByRole('option', { name: re }),
      page.getByRole('menuitem', { name: re }),
      page.getByRole('button', { name: re }),
      page.getByText(re, { exact: true }),
    ], 700);
    if (!item) continue;
    try { await item.click({ timeout: 2200 }); await wait(220); return true; } catch {}
  }
  await page.keyboard.press('Escape').catch(() => {});
  return false;
}

function usefulOptions(info, label) {
  if (!info.exists) return [];
  return [...new Set(info.options.map(clean).filter((x) => x && x.toLowerCase() !== label.toLowerCase()))];
}

function allChoice(options) {
  return options.find((x) => /^all(?:\s|$)/i.test(x)) || options.find((x) => /\bany\b/i.test(x)) || null;
}

async function loadEverything(page) {
  let previous = -1;
  let stable = 0;
  for (let i = 0; i < 70 && stable < 4; i++) {
    const count = await page.locator('a[href*="/players/"]').count().catch(() => 0);
    stable = count === previous ? stable + 1 : 0;
    previous = count;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await page.keyboard.press('End').catch(() => {});
    await wait(260);
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
}

function propParts(href) {
  try { return decodeURIComponent(new URL(href).searchParams.get('prop') || '').split(':'); } catch { return []; }
}
function lineOf(href, row = '') {
  const part = propParts(href).at(-1);
  if (/^[-+]?\d+(?:\.\d+)?$/.test(part || '')) return Number(part);
  const match = row.match(/(?:line|projection)\s*[:\-]?\s*([-+]?\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : null;
}
function propOf(href) {
  const part = propParts(href)[1];
  return part ? part.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Prop';
}
function matchOf(href) { return propParts(href)[2] || ''; }
function pathParts(href) {
  try {
    const parts = new URL(href).pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const index = parts.findIndex((x) => x.toLowerCase() === 'players');
    return index >= 0 ? parts.slice(index + 1) : [];
  } catch { return []; }
}
function pretty(value = '') { return String(value).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim(); }
function sportFrom(href, row = '') {
  const parts = pathParts(href);
  const raw = String(parts[0] || '').toUpperCase().replace(/[-_ ]+/g, '');
  const map = { NCAAF:'CFB', NCAAB:'CBB', COLLEGEFOOTBALL:'CFB', COLLEGEBASKETBALL:'CBB', VALORANT:'VAL', LEAGUEOFLEGENDS:'LOL', DOTA:'DOTA2', COUNTERSTRIKE2:'CS2' };
  if (raw) return map[raw] || raw;
  return ['WNBA','NBA','MLB','NFL','CFB','CBB','NHL','TENNIS','SOCCER','LOL','DOTA2','CS2','VAL','COD','GOLF','MMA','PGA'].find((s) => new RegExp(`\\b${s}\\b`, 'i').test(row)) || 'OTHER';
}
function playerFrom(href, row = '') {
  const parts = pathParts(href);
  if (parts.length > 1) return pretty(parts.slice(1).join(' '));
  const firstLine = clean(row).split('\n').map(clean).find(Boolean) || '';
  return firstLine && !/^pickfinder$/i.test(firstLine) ? firstLine : 'Player';
}
function opponentOf(row = '') {
  const match = row.match(/\bvs\.?\s+([^\n•|]{1,60})/i);
  return match ? clean(match[1]) : '';
}
function directionOf(row = '') {
  const under = (row.match(/\bunder\b|\blower\b/gi) || []).length;
  const over = (row.match(/\bover\b|\bhigher\b/gi) || []).length;
  return under > over ? 'UNDER' : over > under ? 'OVER' : 'N/A';
}
function lineTypeOf(row = '', modifier = '') {
  const text = `${modifier} ${row}`;
  if (/red\s*goblin|\bdemon\b|boosted?|red\s*line/i.test(text)) return 'RED_GOBLIN';
  if (/green\s*goblin|\bgoblin\b|discount(?:ed)?|green\s*line/i.test(text)) return 'GREEN_GOBLIN';
  return 'REGULAR';
}
function eventDate(matchId = '') {
  const m = String(matchId).match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

async function extractRows(page, sourceApp, modifierLabel, dateLabel) {
  await loadEverything(page);
  const anchors = page.locator('a[href*="/players/"]');
  const count = Math.min(await anchors.count().catch(() => 0), MAX_BOARD_PROPS);
  const out = [];
  for (let i = 0; i < count; i++) {
    const anchor = anchors.nth(i);
    const href = await anchor.getAttribute('href').catch(() => null);
    if (!href) continue;
    const absolute = new URL(href, BASE).toString();
    const row = clean(await anchor.locator('xpath=ancestor::*[self::tr or @role="row" or self::article or self::div][1]').innerText().catch(() => anchor.innerText().catch(() => '')));
    const matchId = matchOf(absolute);
    const lineType = lineTypeOf(row, modifierLabel);
    out.push({
      id: `${sourceApp}:${lineType}:${absolute}`,
      player: playerFrom(absolute, row),
      sport: sportFrom(absolute, row),
      prop: propOf(absolute),
      line: lineOf(absolute, row),
      pick: directionOf(row),
      opponent: opponentOf(row),
      matchId,
      eventDate: eventDate(matchId),
      sourceApp,
      sourceAppConfirmed: sourceApp !== 'PickFinder',
      prizePicksConfirmed: /prize\s*picks/i.test(sourceApp),
      lineType,
      modifierLabel: modifierLabel || 'All',
      sourceUrl: absolute,
      detailPageVerified: false,
      boardLoaded: true,
      researchStatus: 'BOARD_ONLY',
      ruleStatus: 'OFF',
      qualified: null,
      confidence: null,
      filterAudit: [],
      rawRow: row,
      dateScope: dateLabel || 'All',
    });
  }
  return out;
}

function dedupe(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = [row.sourceApp,row.sourceUrl,row.lineType].join('|').toLowerCase();
    const previous = map.get(key);
    if (!previous || String(row.rawRow || '').length > String(previous.rawRow || '').length) map.set(key, row);
  }
  return [...map.values()];
}

export async function loadFullPickFinderBoard({ onProgress } = {}) {
  const storageState = await loadPickFinderSession();
  if (!storageState) throw Object.assign(new Error('Connect your PickFinder account before loading the board.'), { code: 'PICKFINDER_RECONNECT' });
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 1100 }, locale: 'en-US' });
  const page = await context.newPage();
  const collected = [];
  const inventory = [];
  try {
    await page.goto(PROPS, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await wait(500);
    const appInfo = await inspect(page, 'Apps');
    const apps = usefulOptions(appInfo, 'Apps');
    const appAll = allChoice(apps);
    const appSegments = appAll ? [appAll] : (apps.length ? apps : ['PickFinder']);

    for (let ai = 0; ai < appSegments.length && collected.length < MAX_BOARD_PROPS; ai++) {
      const app = appSegments[ai];
      await page.goto(PROPS, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await wait(350);
      if (app !== 'PickFinder') await choose(page, 'Apps', [app]);

      const dateInfo = await inspect(page, 'Date');
      const dates = usefulOptions(dateInfo, 'Date');
      const dateAll = allChoice(dates);
      const dateSegments = dateAll ? [dateAll] : (dates.length ? dates : [null]);

      const modifierInfo = await inspect(page, 'Modifier');
      const modifiers = usefulOptions(modifierInfo, 'Modifier');
      const modAll = allChoice(modifiers);
      const modifierSegments = modAll ? [modAll] : (modifiers.length ? modifiers : [null]);

      inventory.push({ app, available: true, dates: dateSegments.filter(Boolean), modifiers: modifierSegments.filter(Boolean) });

      for (const date of dateSegments) {
        for (const modifier of modifierSegments) {
          await page.goto(PROPS, { waitUntil: 'domcontentloaded', timeout: 45000 });
          await wait(300);
          if (app !== 'PickFinder') await choose(page, 'Apps', [app]);
          if (date) await choose(page, 'Date', [date]);
          if (modifier) await choose(page, 'Modifier', [modifier]);
          onProgress?.({ stage:'board', message:`Loading ${app}${date ? ` • ${date}` : ''}${modifier ? ` • ${modifier}` : ''}`, reviewed:collected.length, total:0 });
          const rows = await extractRows(page, appAll ? 'PickFinder' : app, modifier, date);
          collected.push(...rows);
          if (collected.length >= MAX_BOARD_PROPS) break;
        }
        if (collected.length >= MAX_BOARD_PROPS) break;
      }
    }

    const picks = dedupe(collected).slice(0, MAX_BOARD_PROPS);
    await savePickFinderSession(await context.storageState()).catch(() => {});
    return {
      mode:'live',
      scannedAt:new Date().toISOString(),
      source:'PickFinder authenticated full-board loader',
      scannerVersion:'board-v6',
      rulesEnabled:false,
      totalReviewed:picks.length,
      totalLoaded:picks.length,
      qualifiedCount:0,
      rejectedCount:0,
      picks,
      diversifiedCard:[],
      bestAvailable:[],
      greenGoblins:picks.filter((p) => p.lineType === 'GREEN_GOBLIN'),
      redGoblins:picks.filter((p) => p.lineType === 'RED_GOBLIN'),
      appInventory:inventory,
      warnings:[
        'Rules are OFF — the feed shows the full PickFinder board without qualification filtering.',
        ...(picks.length >= MAX_BOARD_PROPS ? [`Board reached MAX_BOARD_PROPS=${MAX_BOARD_PROPS}; raise it if PickFinder exposes more rows.`] : []),
      ],
    };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
