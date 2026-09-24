// Tennis match context for research filters: the opponent's current ranking,
// the opponent's playing hand and the court surface of each completed match.
//
// Source: Sportradar Tennis v3 (trial product already probed at startup).
//   /rankings.json                          current ATP/WTA singles rankings
//   /competitors/{id}/summaries.json        a player's recent matches
//   /competitors/{id}/profile.json          handedness
//   /competitions/{id}/info.json            tournament surface
//   /seasons/{id}/info.json                 surface fallback
//
// Rules:
//   * Identity is exact. Sportradar lists "Last, First"; a name must resolve to
//     exactly one ranked player, and a match must pair on date and opponent.
//   * Handedness and a tournament's surface do not change, so each is read
//     once and kept on the data volume; rankings refresh daily. A daily
//     request budget (SPORTRADAR_TENNIS_DAILY_REQUESTS, default 30) bounds the
//     trial allowance. With the budget spent, only stored answers are served.
//   * Payloads are read defensively and every unknown stays null. Nothing here
//     changes a line, a price, a hit rate or a history row.
import fs from 'node:fs';
import path from 'node:path';
import { sportradarTrialGet, sportradarTrialProductAvailable } from './trial-products.mjs';

const text = value => String(value ?? '').trim();
const list = value => (Array.isArray(value) ? value : []);
const fold = value => text(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const num = value => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** "Medvedev, Daniil" -> "daniil medvedev"; a name without a comma is kept in order. */
export function personKey(value) {
  const raw = text(value);
  const cut = raw.indexOf(',');
  return fold(cut > 0 ? `${raw.slice(cut + 1)} ${raw.slice(0, cut)}` : raw);
}

const PRODUCT = 'tennis';
const DAY_MS = 86_400_000;
const RANKINGS_TTL_MS = 20 * 60 * 60 * 1000;
const SUMMARIES_TTL_MS = 6 * 60 * 60 * 1000;
export const MAX_TENNIS_MATCHES = 20;
const MAX_NEW_PROFILES_PER_CALL = 8;
const MAX_NEW_SURFACES_PER_CALL = 6;

/* ------------------------------------------------------------- parsing */

function collect(node, keyName, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) collect(item, keyName, out);
    return out;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === keyName && Array.isArray(value)) out.push({ parent: node, rows: value });
    else if (value && typeof value === 'object') collect(value, keyName, out);
  }
  return out;
}

function findString(node, keys, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  for (const key of keys) if (typeof node[key] === 'string' && text(node[key])) return text(node[key]);
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      const found = findString(value, keys, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Current singles rankings as [{id, key, name, rank, tour}]. */
export function parseRankings(payload) {
  const out = [];
  for (const { parent, rows } of collect(payload, 'competitor_rankings')) {
    const tour = text(parent?.name || parent?.type) || null;
    for (const row of rows) {
      const id = text(row?.competitor?.id || row?.competitor_id);
      const name = text(row?.competitor?.name || row?.name);
      const rank = num(row?.rank);
      if (!id || !name || rank === null || rank < 1 || !Number.isInteger(rank)) continue;
      out.push({ id, key: personKey(name), name, rank, tour });
    }
  }
  return out;
}

/** Exactly one ranked player with this name, or null. */
export function resolveRanked(rankings, name) {
  const key = personKey(name);
  if (!key) return null;
  const ids = new Map();
  for (const row of rankings) if (row.key === key && !ids.has(row.id)) ids.set(row.id, row);
  return ids.size === 1 ? [...ids.values()][0] : null;
}

export function parseHandedness(payload) {
  const raw = fold(findString(payload?.info || payload, ['handedness', 'plays', 'hand']));
  if (!raw) return null;
  if (/^(left|l|left handed|lefthanded)\b/.test(raw)) return 'L';
  if (/^(right|r|right handed|righthanded)\b/.test(raw)) return 'R';
  return null;
}

/** Surface family and indoor flag from a value such as "hardcourt_indoor" or "red_clay". */
export function parseSurface(value) {
  const raw = fold(value);
  if (!raw) return null;
  const surface = raw.includes('clay') ? 'Clay' : raw.includes('grass') ? 'Grass' : raw.includes('carpet') ? 'Carpet' : raw.includes('hard') ? 'Hard' : null;
  if (!surface) return null;
  return { surface, indoor: raw.includes('indoor') ? true : raw.includes('outdoor') ? false : null };
}

export function surfaceFromInfo(payload) {
  return parseSurface(findString(payload?.info || payload, ['surface', 'ground', 'court_type', 'ground_type']));
}

/** Completed and scheduled matches as [{eventId, start, opponentId, opponentKey, competitionId, seasonId, status}]. */
export function parseSummaries(payload, competitorId) {
  const out = [];
  for (const summary of list(payload?.summaries)) {
    const event = summary?.sport_event || {};
    const start = Date.parse(text(event.start_time || event.scheduled));
    const competitors = list(event.competitors);
    if (!Number.isFinite(start) || competitors.length !== 2) continue;
    const mine = competitors.filter(row => text(row?.id) === competitorId);
    const other = competitors.filter(row => text(row?.id) && text(row?.id) !== competitorId);
    if (mine.length !== 1 || other.length !== 1) continue;
    const context = event.sport_event_context || {};
    out.push({
      eventId: text(event.id) || null,
      start,
      opponentId: text(other[0].id),
      opponentKey: personKey(other[0].name),
      competitionId: text(context.competition?.id) || null,
      seasonId: text(context.season?.id) || null,
      status: fold(summary?.sport_event_status?.status || summary?.sport_event_status?.match_status) || null,
    });
  }
  return out;
}

/** The summary for one of our completed matches: same opponent within 36 hours, exactly one. */
export function pairMatch(summaries, { date, opponent }) {
  const at = Date.parse(text(date)), key = personKey(opponent);
  if (!Number.isFinite(at) || !key) return null;
  const hits = summaries.filter(row => row.opponentKey === key && Math.abs(row.start - at) <= 36 * 60 * 60 * 1000);
  return hits.length === 1 ? hits[0] : null;
}

/* ---------------------------------------------------------------- store */

function fileStore(file) {
  let loaded = null;
  const empty = () => ({ version: 1, day: null, used: 0, rankings: null, hands: {}, surfaces: {} });
  return {
    load() {
      if (loaded) return loaded;
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        loaded = { ...empty(), ...parsed, hands: parsed?.hands || {}, surfaces: parsed?.surfaces || {} };
      } catch {
        loaded = empty();
      }
      return loaded;
    },
    save() {
      if (!loaded) return;
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const temp = file + '.tmp';
        fs.writeFileSync(temp, JSON.stringify(loaded));
        fs.renameSync(temp, file);
      } catch {}
    },
  };
}

export function memoryStore() {
  const data = { version: 1, day: null, used: 0, rankings: null, hands: {}, surfaces: {} };
  return { load: () => data, save() {} };
}

const DEFAULT_FILE = path.join(text(process.env.DATA_DIR || '/app/data'), 'autoscout', 'sportradar-tennis-context-v1.json');

/* ------------------------------------------------------------- service */

export function createTennisContext({
  get = (p, params, options) => sportradarTrialGet(PRODUCT, p, params, options),
  available = () => sportradarTrialProductAvailable(PRODUCT),
  store = fileStore(DEFAULT_FILE),
  now = Date.now,
  dailyBudget = () => Math.max(0, Math.floor(Number(process.env.SPORTRADAR_TENNIS_DAILY_REQUESTS ?? 30)) || 0),
} = {}) {
  const summariesCache = new Map();
  const stats = { requests: 0, cacheReads: 0, budgetBlocked: 0, failures: 0, lastError: null };

  function budgetLeft(data) {
    const day = new Date(now()).toISOString().slice(0, 10);
    if (data.day !== day) { data.day = day; data.used = 0; }
    return dailyBudget() - data.used;
  }

  async function read(data, p, ttlMs) {
    if (budgetLeft(data) <= 0) { stats.budgetBlocked += 1; return null; }
    const result = await get(p, {}, { ttlMs, timeoutMs: 10_000 });
    if (!result?.cached) { data.used += 1; stats.requests += 1; } else stats.cacheReads += 1;
    if (!result?.ok) { stats.failures += 1; stats.lastError = text(result?.code) || 'FAILED'; return null; }
    return result.payload;
  }

  async function rankings(data) {
    const stored = data.rankings;
    const keyed = rows => rows.map(row => ({ ...row, key: row.key || personKey(row.name) }));
    if (stored && now() - Date.parse(stored.fetchedAt) < RANKINGS_TTL_MS && Array.isArray(stored.rows)) return keyed(stored.rows);
    const payload = await read(data, '/rankings.json', RANKINGS_TTL_MS);
    const rows = payload ? parseRankings(payload) : [];
    if (rows.length) {
      data.rankings = { fetchedAt: new Date(now()).toISOString(), rows: rows.map(({ id, name, rank, tour }) => ({ id, name, rank, tour })) };
      store.save();
    }
    // A failed refresh keeps serving the last stored table rather than nothing.
    return keyed(rows.length ? rows : list(stored?.rows));
  }

  async function summaries(data, competitorId) {
    const hit = summariesCache.get(competitorId);
    if (hit && hit.until > now()) return hit.rows;
    const payload = await read(data, `/competitors/${encodeURIComponent(competitorId)}/summaries.json`, SUMMARIES_TTL_MS);
    const rows = payload ? parseSummaries(payload, competitorId) : null;
    if (rows) {
      summariesCache.set(competitorId, { rows, until: now() + SUMMARIES_TTL_MS });
      while (summariesCache.size > 300) summariesCache.delete(summariesCache.keys().next().value);
    }
    return rows || [];
  }

  // Stored answers: a known hand or surface is permanent; "not published"
  // expires after 30 days so a later profile update is picked up.
  const storedAnswer = (entry) => {
    if (!entry || typeof entry !== 'object') return undefined;
    if (entry.v !== null && entry.v !== undefined) return entry.v;
    return now() - Date.parse(entry.at || '') < 30 * DAY_MS ? null : undefined;
  };

  /** { value, fetched }: value undefined means not known yet. */
  async function hand(data, competitorId, allowFetch) {
    const stored = storedAnswer(data.hands[competitorId]);
    if (stored !== undefined) return { value: stored, fetched: false };
    if (!allowFetch) return { value: undefined, fetched: false };
    const payload = await read(data, `/competitors/${encodeURIComponent(competitorId)}/profile.json`, 30 * DAY_MS);
    if (!payload) return { value: undefined, fetched: true };
    const value = parseHandedness(payload);
    data.hands[competitorId] = { v: value, at: new Date(now()).toISOString() };
    store.save();
    return { value, fetched: true };
  }

  async function surface(data, match, allowFetch) {
    const key = match.competitionId || match.seasonId;
    if (!key) return { value: null, fetched: false };
    const stored = storedAnswer(data.surfaces[key]);
    if (stored !== undefined) return { value: stored, fetched: false };
    if (!allowFetch) return { value: undefined, fetched: false };
    let value = null;
    if (match.competitionId) {
      const payload = await read(data, `/competitions/${encodeURIComponent(match.competitionId)}/info.json`, 30 * DAY_MS);
      value = payload ? surfaceFromInfo(payload) : null;
    }
    if (!value && match.seasonId) {
      const payload = await read(data, `/seasons/${encodeURIComponent(match.seasonId)}/info.json`, 30 * DAY_MS);
      value = payload ? surfaceFromInfo(payload) : null;
    }
    data.surfaces[key] = { v: value, at: new Date(now()).toISOString() };
    store.save();
    return { value, fetched: true };
  }

  return {
    // Owner diagnostics only: request counts and the remaining daily budget.
    stats: () => ({ ...stats, budgetLeft: Math.max(0, budgetLeft(store.load())) }),
    // fill=false answers from stored values only for past matches (the page
    // header needs just the upcoming opponent); fill=true may spend budget on
    // missing hands and surfaces.
    async lookup({ player, opponent = null, matches = [], fill = true } = {}) {
      if (!available()) {
        return { ok: true, available: false, code: 'TENNIS_CONTEXT_UNAVAILABLE', message: 'Tennis match context is not available right now.', matches: {} };
      }
      const data = store.load();
      const ranked = await rankings(data);
      const me = resolveRanked(ranked, player);
      const current = opponent ? resolveRanked(ranked, opponent) : null;
      const out = {};
      let pending = false;
      let profilesLeft = MAX_NEW_PROFILES_PER_CALL, surfacesLeft = MAX_NEW_SURFACES_PER_CALL;
      const recent = me ? await summaries(data, me.id) : [];
      const wanted = list(matches).slice(0, MAX_TENNIS_MATCHES);
      for (const match of wanted) {
        const id = text(match?.id);
        if (!id) continue;
        const opponentRank = resolveRanked(ranked, match?.opponent)?.rank ?? null;
        const paired = recent.length ? pairMatch(recent, match) : null;
        let opponentHand = null, court = null;
        if (paired) {
          const h = await hand(data, paired.opponentId, fill && profilesLeft > 0);
          if (h.fetched) profilesLeft -= 1;
          if (h.value === undefined) pending = true; else opponentHand = h.value;
          const s = await surface(data, paired, fill && surfacesLeft > 0);
          if (s.fetched) surfacesLeft -= 1;
          if (s.value === undefined) pending = true; else court = s.value;
        }
        out[id] = {
          opponentRank,
          opponentHand,
          surface: court?.surface ?? null,
          indoor: court?.indoor ?? null,
          paired: Boolean(paired),
        };
      }
      // The upcoming match: the opponent's rank and hand, and the tournament
      // surface when the player's schedule already lists this pairing.
      let upcoming = null;
      if (current || opponent) {
        const scheduled = recent.filter(row => row.opponentKey === personKey(opponent) && row.start > now() - 12 * 60 * 60 * 1000);
        const next = scheduled.length === 1 ? scheduled[0] : null;
        const nextHand = current ? await hand(data, current.id, profilesLeft > 0) : { value: null };
        const nextSurface = next ? await surface(data, next, surfacesLeft > 0) : { value: null };
        upcoming = {
          opponentRank: current?.rank ?? null,
          opponentHand: nextHand.value ?? null,
          surface: nextSurface.value?.surface ?? null,
          indoor: nextSurface.value?.indoor ?? null,
        };
      }
      const matched = Object.values(out);
      return {
        ok: true,
        available: Boolean(me || current || matched.some(row => row.opponentRank !== null)),
        player: { rank: me?.rank ?? null, tour: me?.tour ?? null },
        rankingsAsOf: data.rankings?.fetchedAt || null,
        upcoming,
        matches: out,
        complete: !pending,
        coverage: {
          rankings: ranked.length > 0,
          playerRanked: Boolean(me),
          matchesPaired: matched.filter(row => row.paired).length,
          handsKnown: matched.filter(row => row.opponentHand).length,
          surfacesKnown: matched.filter(row => row.surface).length,
        },
      };
    },
  };
}

let shared = null;
let loggedLookups = 0;
export async function fetchTennisContext(params) {
  shared ||= createTennisContext();
  const result = await shared.lookup(params);
  // The first few lookups after a deploy log field coverage (counts only, no
  // names) so the live payload shape can be confirmed from the service logs.
  if (loggedLookups < 3) {
    loggedLookups += 1;
    console.log('[tennis-context] coverage', JSON.stringify({ available: result.available, complete: result.complete ?? null, requested: Object.keys(result.matches || {}).length, ...(result.coverage || {}), requests: shared.stats().requests, failures: shared.stats().failures, lastError: shared.stats().lastError }));
  }
  return result;
}
export function tennisContextHealth() {
  return shared ? shared.stats() : null;
}
