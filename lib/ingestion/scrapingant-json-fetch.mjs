import fs from 'node:fs/promises';
import path from 'node:path';

const API_URL = 'https://api.scrapingant.com/v2/general';
const USAGE_URL = 'https://api.scrapingant.com/v2/usage';
const MAX_BYTES = 20 * 1024 * 1024;
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'autoscout', 'scrapingant-budget-v1.json');
const key = () => String(process.env.SCRAPINGANT_API_KEY || '').trim();
const int = (name, fallback, min, max) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};
const DAILY_CAP = () => int('SCRAPINGANT_DAILY_CREDIT_CAP', 300, 1, 1_000_000);
const HOURLY_REQUEST_CAP = () => int('SCRAPINGANT_MAX_REQUESTS_PER_HOUR', 30, 1, 10_000);
const MIN_REMAINING = () => int('SCRAPINGANT_MIN_REMAINING_CREDITS', 500, 0, 10_000_000);
const CACHE_MS = () => int('SCRAPINGANT_CACHE_MINUTES', 10, 1, 60) * 60_000;
const BROWSER_FALLBACK = () => !['0','false','no','off'].includes(String(process.env.SCRAPINGANT_BROWSER_FALLBACK_ENABLED || 'true').toLowerCase());
const DRAFTKINGS_ALLOWED = () => !['0','false','no','off'].includes(String(process.env.AUTOSCOUT_SCRAPINGANT_DRAFTKINGS || 'false').toLowerCase());

let budgetLoaded = false;
let budget = { day: '', credits: 0, requests: [] };
let saveChain = Promise.resolve();
let usageCache = { at: 0, data: null };
const resultCache = new Map();
const pending = new Map();

function dayKey(now = Date.now()) { return new Date(now).toISOString().slice(0, 10); }
async function loadBudget() {
  if (budgetLoaded) return;
  budgetLoaded = true;
  try {
    const parsed = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
    if (parsed && typeof parsed === 'object') budget = parsed;
  } catch {}
}
async function saveBudget() {
  saveChain = saveChain.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
    const temp = `${STATE_FILE}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(budget));
    await fs.rename(temp, STATE_FILE);
  });
  await saveChain;
}
async function normalizeBudget(now = Date.now()) {
  await loadBudget();
  const day = dayKey(now);
  if (budget.day !== day) budget = { day, credits: 0, requests: [] };
  const cutoff = now - 60 * 60_000;
  budget.requests = Array.isArray(budget.requests) ? budget.requests.filter((ts) => Number(ts) >= cutoff) : [];
}
async function reserve(estimated) {
  const now = Date.now();
  await normalizeBudget(now);
  if (budget.requests.length >= HOURLY_REQUEST_CAP()) throw Object.assign(new Error('SCRAPINGANT_HOURLY_LIMIT'), { code: 'SCRAPINGANT_HOURLY_LIMIT' });
  if (Number(budget.credits || 0) + estimated > DAILY_CAP()) throw Object.assign(new Error('SCRAPINGANT_DAILY_BUDGET'), { code: 'SCRAPINGANT_DAILY_BUDGET' });
  budget.credits = Number(budget.credits || 0) + estimated;
  budget.requests.push(now);
  await saveBudget();
}
async function settle(estimated, actual) {
  await normalizeBudget();
  const safeActual = Number.isFinite(actual) && actual >= 0 ? actual : estimated;
  budget.credits = Math.max(0, Number(budget.credits || 0) + safeActual - estimated);
  await saveBudget();
}

export function scrapingAntConfigured() { return Boolean(key()); }

async function providerUsage() {
  if (!key()) return null;
  if (Date.now() - usageCache.at < 30 * 60_000) return usageCache.data;
  try {
    const url = new URL(USAGE_URL);
    url.searchParams.set('x-api-key', key());
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const data = await response.json();
    usageCache = { at: Date.now(), data };
    return data;
  } catch { return null; }
}

async function readBody(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw Object.assign(new Error('SCRAPINGANT_TOO_LARGE'), { code: 'SCRAPINGANT_TOO_LARGE' });
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_BYTES) throw Object.assign(new Error('SCRAPINGANT_TOO_LARGE'), { code: 'SCRAPINGANT_TOO_LARGE' });
  return text;
}

async function requestMode(targetUrl, { targetHeaders = {}, browser = false, returnPageSource = false, estimatedCost = 1, transport }) {
  const usage = await providerUsage();
  const remaining = Number(usage?.remained_credits);
  if (Number.isFinite(remaining) && remaining <= MIN_REMAINING()) throw Object.assign(new Error('SCRAPINGANT_REMAINING_FLOOR'), { code: 'SCRAPINGANT_REMAINING_FLOOR', remaining });
  await reserve(estimatedCost);
  let actualCost = 0;
  let succeeded = false;
  try {
    const url = new URL(API_URL);
    url.searchParams.set('x-api-key', key());
    url.searchParams.set('url', targetUrl);
    url.searchParams.set('browser', String(browser));
    url.searchParams.set('proxy_type', 'datacenter');
    if (returnPageSource) url.searchParams.set('return_page_source', 'true');
    const headers = { accept: 'application/json,text/plain,*/*' };
    for (const [name, value] of Object.entries(targetHeaders || {})) {
      if (value == null || value === '') continue;
      headers[`ant-${String(name).toLowerCase()}`] = String(value);
    }
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(browser ? 45_000 : 25_000) });
    actualCost = Number(response.headers.get('ant-credits-cost')) || 0;
    const pageStatus = Number(response.headers.get('ant-page-status-code')) || 0;
    const body = await readBody(response);
    if (!response.ok) throw Object.assign(new Error('SCRAPINGANT_HTTP'), { code: 'SCRAPINGANT_HTTP', status: response.status, pageStatus });
    if (pageStatus >= 400) throw Object.assign(new Error('SCRAPINGANT_TARGET_HTTP'), { code: 'SCRAPINGANT_TARGET_HTTP', status: pageStatus });
    let data;
    try { data = JSON.parse(body); }
    catch { throw Object.assign(new Error('SCRAPINGANT_INVALID_JSON'), { code: 'SCRAPINGANT_INVALID_JSON' }); }
    succeeded = true;
    return { data, transport, creditsCost: actualCost || estimatedCost, providerRemaining: Number.isFinite(remaining) ? remaining : null, endpoint: new URL(targetUrl).host };
  } finally {
    const billed = succeeded ? (actualCost || estimatedCost) : actualCost;
    await settle(estimatedCost, billed).catch(() => {});
  }
}

export async function scrapingAntJsonFetch(targetUrl, { targetHeaders = {}, allowBrowserFallback = true } = {}) {
  if (!scrapingAntConfigured()) throw Object.assign(new Error('SCRAPINGANT_NOT_CONFIGURED'), { code: 'SCRAPINGANT_NOT_CONFIGURED' });
  let target;
  try { target = new URL(targetUrl); }
  catch { throw Object.assign(new Error('SCRAPINGANT_INVALID_TARGET'), { code: 'SCRAPINGANT_INVALID_TARGET' }); }
  if (target.hostname.endsWith('draftkings.com') && !DRAFTKINGS_ALLOWED()) {
    throw Object.assign(new Error('SCRAPINGANT_DRAFTKINGS_DISABLED'), { code: 'SCRAPINGANT_DRAFTKINGS_DISABLED' });
  }
  const cacheKey = JSON.stringify([targetUrl, targetHeaders]);
  const cached = resultCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return { ...cached.value, cached: true };
  if (pending.has(cacheKey)) return pending.get(cacheKey);
  const task = (async () => {
    const modes = [
      { browser: false, returnPageSource: false, estimatedCost: 1, transport: 'scrapingant-simple' },
      ...(allowBrowserFallback && BROWSER_FALLBACK() ? [
        { browser: true, returnPageSource: true, estimatedCost: 2, transport: 'scrapingant-browser-lite' },
        { browser: true, returnPageSource: false, estimatedCost: 10, transport: 'scrapingant-browser' },
      ] : []),
    ];
    let lastError = null;
    for (const mode of modes) {
      try {
        const result = await requestMode(targetUrl, { targetHeaders, ...mode });
        resultCache.set(cacheKey, { expires: Date.now() + CACHE_MS(), value: result });
        return result;
      } catch (error) {
        lastError = error;
        if (['SCRAPINGANT_DAILY_BUDGET','SCRAPINGANT_HOURLY_LIMIT','SCRAPINGANT_REMAINING_FLOOR'].includes(error?.code)) break;
      }
    }
    throw lastError || Object.assign(new Error('SCRAPINGANT_FAILED'), { code: 'SCRAPINGANT_FAILED' });
  })();
  pending.set(cacheKey, task);
  try { return await task; }
  finally { pending.delete(cacheKey); }
}

export async function scrapingAntBudgetStatus() {
  await normalizeBudget();
  const usage = await providerUsage();
  return {
    configured: scrapingAntConfigured(),
    dailyCreditsUsed: Number(budget.credits || 0),
    dailyCreditCap: DAILY_CAP(),
    requestsLastHour: budget.requests.length,
    hourlyRequestCap: HOURLY_REQUEST_CAP(),
    providerRemaining: Number.isFinite(Number(usage?.remained_credits)) ? Number(usage.remained_credits) : null,
    providerPlan: typeof usage?.plan_name === 'string' ? usage.plan_name : null,
  };
}
