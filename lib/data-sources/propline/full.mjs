// Extended PropLine research surfaces for ObligeProps. These are enrichment:
// failures return through the guarded frontdoor and never become board-critical.
import { PROPLINE_BASE, proplineConfigured, proplineGet, proplineNoteQuota, proplineQuota, proplineReserve } from './client.mjs';
import { proplineSportKey } from './markets.mjs';

const text = (v) => String(v ?? '').trim();
const list = (v) => Array.isArray(v) ? v : [];
const obj = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const clamp = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n))) : d; };
const iso = (v) => { const n = Date.parse(text(v)); return Number.isFinite(n) ? new Date(n).toISOString() : null; };
const stable = (v) => Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v);
const publicCache = new Map(), postCache = new Map(), postInflight = new Map();

function eventPath(sport, eventId, suffix = '') { const key = proplineSportKey(sport), id = text(eventId); return key && id ? `/v1/sports/${key}/events/${encodeURIComponent(id)}${suffix}` : null; }
function playerPath(sport, player, suffix = '') { const key = proplineSportKey(sport), name = text(player); return key && name ? `/v1/sports/${key}/players/${encodeURIComponent(name)}${suffix}` : null; }

async function publicGet(path, params = {}, ttlSeconds = 60) {
  const key = `${path}?${stable(params)}`, hit = publicCache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const url = new URL(PROPLINE_BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== '' && v !== null && v !== undefined) url.searchParams.set(k, String(v));
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error('PropLine public request failed.'), { code: `PROPLINE_PUBLIC_HTTP_${response.status}` });
  publicCache.set(key, { value: body, until: Date.now() + ttlSeconds * 1000 });
  while (publicCache.size > 100) publicCache.delete(publicCache.keys().next().value);
  return body;
}

function assertPaidQuota() {
  const q = proplineQuota(), left = num(q.remaining), reserve = proplineReserve();
  if (left === 0) throw Object.assign(new Error('PropLine allowance spent.'), { code: 'PROPLINE_DAILY_LIMIT', resetAt: q.resetAt });
  if (reserve > 0 && left !== null && left <= reserve) throw Object.assign(new Error('PropLine reserve protected.'), { code: 'PROPLINE_QUOTA_RESERVE', reserve, resetAt: q.resetAt });
}

async function paidPost(path, body) {
  if (!proplineConfigured()) throw Object.assign(new Error('PropLine is not configured.'), { code: 'PROPLINE_NOT_CONFIGURED' });
  const key = `${path}|${stable(body)}`, hit = postCache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  if (postInflight.has(key)) return postInflight.get(key);
  assertPaidQuota();
  const task = fetch(PROPLINE_BASE + path, {
    method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', 'x-api-key': text(process.env.PROPLINE_API_KEY) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  }).then(async (response) => {
    proplineNoteQuota(response.headers);
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error('PropLine request failed.'), { code: response.status === 429 ? 'PROPLINE_RATE_LIMITED' : `PROPLINE_HTTP_${response.status}`, status: response.status });
    postCache.set(key, { value: payload, until: Date.now() + 15_000 });
    while (postCache.size > 100) postCache.delete(postCache.keys().next().value);
    return payload;
  }).finally(() => postInflight.delete(key));
  postInflight.set(key, task);
  return task;
}

export async function fetchPlayerHistory(sport, playerName, { market = '', bookmaker = '', limit = 20 } = {}) {
  const path = playerPath(sport, playerName, '/history'); if (!path || !text(market)) return null;
  const p = await proplineGet(path, { market: text(market), bookmaker: text(bookmaker) || undefined, limit: clamp(limit, 20, 1, 100) }, { ttlSeconds: 3600 });
  return { playerName: text(p?.player_name) || text(playerName), market: text(p?.market) || text(market), entries: list(p?.entries ?? p?.data ?? p).slice(0, 100).map((r) => ({ eventId: text(r?.event_id) || null, commenceTime: iso(r?.commence_time), bookmakerKey: text(r?.bookmaker) || null, bookmakerTitle: text(r?.bookmaker_title) || null, line: num(r?.line ?? r?.point), overPrice: num(r?.over_price), underPrice: num(r?.under_price), actualValue: num(r?.actual_value), overResult: text(r?.over_result).toLowerCase() || null, underResult: text(r?.under_result).toLowerCase() || null, resolvedAt: iso(r?.resolved_at) })) };
}

export async function fetchPlayerTrendsFull(sport, playerName, { market = '', dfsOddsType = '' } = {}) {
  const path = playerPath(sport, playerName, '/trends'); if (!path) return null;
  const p = await proplineGet(path, { market: text(market) || undefined, dfs_odds_type: text(dfsOddsType).toLowerCase() || undefined }, { ttlSeconds: 3600 });
  const markets = list(p?.markets ?? p?.data?.markets).slice(0, 100).map((r) => {
    const windows = {};
    for (const n of [5, 10, 20, 50]) { const w = r?.[`last_${n}`]; if (!w) continue; const pct = num(w.over_pct); windows[`l${n}`] = { games: num(w.games), over: num(w.over), under: num(w.under), push: num(w.push), hitRate: pct === null ? null : pct > 1 ? pct / 100 : pct }; }
    return { marketKey: text(r?.market) || null, gamesGraded: num(r?.games_graded), referenceBookmaker: text(r?.reference_bookmaker) || null, recentLine: num(r?.recent_line), averageActual: num(r?.avg_actual), currentStreak: obj(r?.current_streak), lastGame: obj(r?.last_game), windows, redacted: r?.redacted === true };
  }).filter((r) => r.marketKey);
  return { playerName: text(p?.player_name) || text(playerName), sportKey: text(p?.sport_key) || proplineSportKey(sport), dfsOddsType: text(p?.dfs_odds_type) || null, markets };
}

export async function fetchEventStats(sport, eventId, { statType = '' } = {}) {
  const path = eventPath(sport, eventId, '/stats'); if (!path) return null;
  const p = await proplineGet(path, { stat_type: text(statType) || undefined }, { ttlSeconds: 90 });
  return { eventId: text(p?.id ?? eventId) || null, status: text(p?.status).toLowerCase() || null, homeTeam: text(p?.home_team) || null, awayTeam: text(p?.away_team) || null, homeScore: num(p?.home_score), awayScore: num(p?.away_score), players: list(p?.players).slice(0, 300).map((r) => ({ name: text(r?.name) || null, team: text(r?.team) || null, stats: obj(r?.stats) })).filter((r) => r.name) };
}

export async function fetchEventMarkets(sport, eventId) {
  const path = eventPath(sport, eventId, '/markets'); if (!path) return null;
  const p = await proplineGet(path, {}, { ttlSeconds: 300 });
  const markets = list(p?.markets ?? p?.data ?? p).slice(0, 500).map((r) => ({ key: text(r?.key ?? r?.market_key) || null, description: text(r?.description) || null, outcomesCount: num(r?.outcomes_count ?? r?.count), period: text(r?.period) || null })).filter((r) => r.key);
  return { eventId: text(p?.id ?? eventId) || text(eventId), markets, count: markets.length };
}

export async function fetchFutures(sport, { bookmakers = '' } = {}) {
  const key = proplineSportKey(sport); if (!key) return null;
  const p = await proplineGet(`/v1/sports/${key}/futures`, { bookmakers: text(bookmakers) || undefined }, { ttlSeconds: 3600 });
  const events = list(p?.events ?? p).slice(0, 100).map((e) => ({ id: text(e?.id) || null, title: text(e?.title) || null, commenceTime: iso(e?.commence_time), markets: list(e?.markets).slice(0, 300).map((m) => ({ key: text(m?.key) || null, description: text(m?.description) || null, bookmakerKey: text(m?.bookmaker) || null, bookmakerTitle: text(m?.bookmaker_title) || null, lastUpdate: iso(m?.last_update), outcomes: list(m?.outcomes).slice(0, 100).map((o) => ({ name: text(o?.name) || null, description: text(o?.description) || null, point: num(o?.point), price: num(o?.price), resolution: text(o?.resolution).toLowerCase() || null, actualValue: num(o?.actual_value) })).filter((o) => o.name) })).filter((m) => m.key) })).filter((e) => e.id || e.title);
  return { sportKey: key, events, eventCount: events.length, marketCount: events.reduce((n, e) => n + e.markets.length, 0) };
}

export async function calculateExpectedValue(sport, eventId, { market, name, point = null, description = '', price } = {}) {
  const path = eventPath(sport, eventId, '/ev/calc'), odds = num(price); if (!path || !text(market) || !text(name) || odds === null) return null;
  const p = await proplineGet(path, { market: text(market), name: text(name), point: point === null || point === '' ? undefined : Number(point), description: text(description) || undefined, price: odds }, { ttlSeconds: 60 });
  return { market: text(p?.market) || text(market), name: text(p?.name) || text(name), point: num(p?.point ?? point), description: text(p?.description) || text(description) || null, price: num(p?.price ?? odds), fairSource: text(p?.fair_source) || null, fairProbability: num(p?.fair_prob), impliedProbability: num(p?.implied_prob), evPercent: num(p?.ev_pct), isPlusEv: p?.is_plus_ev === true };
}

export async function fetchDfsPayouts({ platform = 'prizepicks', legWinProb = null } = {}) {
  const p = await publicGet('/v1/dfs/payouts', { platform: text(platform).toLowerCase() || 'prizepicks', leg_win_prob: legWinProb === null || legWinProb === '' ? undefined : Number(legWinProb) }, 3600);
  return { ...obj(p), platform: text(p?.platform) || text(platform).toLowerCase() || 'prizepicks' };
}

export async function fetchMarketHitRates({ days = 28, bookmaker = 'bovada' } = {}) {
  const p = await publicGet('/v1/markets/hit-rates', { days: clamp(days, 28, 1, 60), bookmaker: text(bookmaker).toLowerCase() || 'bovada' }, 600), source = p?.markets, markets = Object.create(null);
  const add = (key, values, fallback = {}) => { const rows = list(values).slice(-60).map((r) => ({ date: text(r?.date) || null, total: num(r?.total), won: num(r?.won) })); const total = rows.length ? rows.reduce((s, r) => s + (r.total || 0), 0) : num(fallback.total) || 0, won = rows.length ? rows.reduce((s, r) => s + (r.won || 0), 0) : num(fallback.won) || 0; markets[key] = { rows, total, won, overRate: total > 0 ? won / total : null }; };
  if (Array.isArray(source)) for (const r of source.slice(0, 500)) { const key = text(r?.key ?? r?.market ?? r?.market_key); if (key) add(key, r?.rows ?? r?.daily ?? r?.days, r); }
  else for (const [key, rows] of Object.entries(obj(source))) add(key, rows);
  return { days: clamp(p?.days, clamp(days, 28, 1, 60), 1, 60), bookmaker: text(p?.bookmaker) || text(bookmaker).toLowerCase() || 'bovada', markets };
}

export async function fetchResolutionSummary({ days = 30 } = {}) {
  const p = await publicGet('/v1/markets/resolution-summary', { days: clamp(days, 30, 1, 90) }, 3600);
  return { days: clamp(p?.days, clamp(days, 30, 1, 90), 1, 90), totalGraded: num(p?.total_graded), totalSettled: num(p?.total_settled), eventsGraded: num(p?.events_graded), sportsCovered: num(p?.sports_covered), bySport: list(p?.by_sport).slice(0, 100), topMarkets: list(p?.top_markets).slice(0, 12) };
}

export async function fetchFreshness() {
  const p = await publicGet('/v1/freshness', {}, 30), threshold = num(p?.stale_threshold_seconds);
  return { asOf: iso(p?.as_of), staleThresholdSeconds: threshold, bookmakers: list(p?.bookmakers).slice(0, 100).map((r) => { const props = obj(r?.market_classes?.props), gameLines = obj(r?.market_classes?.game_lines), propSec = num(props.staleness_seconds); return { key: text(r?.key) || null, marketCount: num(r?.market_count), stalenessSeconds: num(r?.staleness_seconds), isStale: r?.is_stale === true, marketClasses: { props: { ...props, is_stale: props.is_stale === true || (threshold !== null && propSec !== null && propSec > threshold) }, gameLines } }; }).filter((r) => r.key) };
}

function sgpQuote(r) { return r && typeof r === 'object' ? { bookmaker: text(r.bookmaker) || null, quoted: r.quoted === true, sgpPrice: num(r.sgp_price), independentPrice: num(r.independent_price), correlationFactor: num(r.correlation_factor), pricedAt: iso(r.priced_at), legs: list(r.legs).slice(0, 10).map((l) => ({ market: text(l?.market) || null, name: text(l?.name) || null, description: text(l?.description) || null, point: num(l?.point), accepted: l?.accepted === true, failureCode: text(l?.failure_code) || null })) } : null; }

export async function priceSameGameParlay(sport, eventId, { bookmaker = 'all', legs = [] } = {}) {
  const path = eventPath(sport, eventId, '/sgp'), safeLegs = list(legs).slice(0, 10).map((l) => ({ market: text(l?.market), name: text(l?.name), description: text(l?.description) || undefined, point: l?.point === null || l?.point === '' || l?.point === undefined ? undefined : Number(l.point), period: text(l?.period) || undefined, team: text(l?.team) || undefined, book_outcome_id: text(l?.book_outcome_id) || undefined })).filter((l) => l.market && l.name);
  if (!path || safeLegs.length < 2 || safeLegs.length > 10) return null;
  const p = await paidPost(path, { bookmaker: text(bookmaker).toLowerCase() || 'all', legs: safeLegs });
  const quotes = Array.isArray(p?.quotes) ? p.quotes.map(sgpQuote).filter(Boolean) : [sgpQuote(p)].filter(Boolean), bestBookmaker = text(p?.best_bookmaker) || quotes.find((q) => q.quoted)?.bookmaker || null;
  return { eventId: text(p?.id ?? eventId) || text(eventId), bestBookmaker, quotes, errors: list(p?.errors).slice(0, 10).map((e) => ({ bookmaker: text(e?.bookmaker) || null, status: num(e?.status), detail: text(e?.detail) || null })), best: quotes.find((q) => q.bookmaker === bestBookmaker) || quotes.filter((q) => q.quoted && q.sgpPrice !== null).sort((a, b) => b.sgpPrice - a.sgpPrice)[0] || null };
}

let freshnessMonitor = null, freshnessSignature = null;
export function startProplineFreshnessMonitor({ intervalMs = 300_000 } = {}) {
  if (freshnessMonitor) return freshnessMonitor;
  const check = async () => { try { const x = await fetchFreshness(), stale = x.bookmakers.filter((b) => b.isStale || b.marketClasses?.props?.is_stale), sig = stale.map((b) => b.key).sort().join(','); if (sig !== freshnessSignature) { freshnessSignature = sig; console.log(`[PropLine freshness] books=${x.bookmakers.length} stale=${stale.length}${sig ? ` keys=${sig.slice(0, 200)}` : ''}`); } } catch (e) { const sig = `error:${text(e?.code || e?.name || 'UNKNOWN')}`; if (sig !== freshnessSignature) { freshnessSignature = sig; console.log(`[PropLine freshness] unavailable code=${sig.slice(6, 80)}`); } } };
  const first = setTimeout(() => void check(), 2500); first.unref?.();
  freshnessMonitor = setInterval(() => void check(), Math.max(60_000, Number(intervalMs) || 300_000)); freshnessMonitor.unref?.();
  return freshnessMonitor;
}

export function __resetProplineFullForTests() { publicCache.clear(); postCache.clear(); postInflight.clear(); if (freshnessMonitor) clearInterval(freshnessMonitor); freshnessMonitor = null; freshnessSignature = null; }
