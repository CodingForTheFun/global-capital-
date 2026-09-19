import { createHash } from 'node:crypto';

// This module never imports a live worker, sportsbook, or paid-history adapter.
// The CLI supplies the existing verified ESPN parser and persistence mapper.
const text = value => String(value ?? '').trim();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const historyKey = row => JSON.stringify([row.player_id, row.game_id, row.category]);
export const playerKey = row => JSON.stringify([text(row.sport).toUpperCase(), text(row.playerName)]);

/** Candidate matching only. Never use a normalized name to re-key stored games. */
export function historyName(value) {
  return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/['\u2019]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
    .replace(/(?:\s+(?:jr|sr|ii|iii|iv|v))+$/, '')
    .replace(/\b(?:[a-z]\s+)+[a-z]\b/g, initials => initials.replace(/\s/g, ''));
}

function scopeReason(context) {
  const sport = text(context.sport).toUpperCase();
  const period = text(context.period).toLowerCase();
  if (/(?:SZN|SEASON)$/.test(sport) || /season/.test(period)) return 'UNSUPPORTED_SEASON_SCOPE';
  if (/(?:[1-4]Q|[12]H|LIVE)$/.test(sport)) return 'UNSUPPORTED_PERIOD_SCOPE';
  const marketScope = `${text(context.market)} ${text(context.providerMarketKey)}`;
  if (/(?:^|[ _])(?:[1-4]q|q[1-4]|[12]h|h[12])(?:[ _]|$)|quarter|half|inning|season|first set|first period/i.test(marketScope)) return 'UNSUPPORTED_PERIOD_SCOPE';
  // normalizePrizePicks currently places projection_type in period when no
  // actual period is supplied. single_stat is scoring metadata, NOT 1H/1Q.
  // Only accept that known source marker with an independently valid market.
  const scoringMetadata = period === 'single_stat' && text(context.sourceBook).toLowerCase() === 'prizepicks';
  if (period && !['game', 'full_game', 'full game'].includes(period) && !scoringMetadata) return 'UNSUPPORTED_PERIOD_SCOPE';
  if (context.entityType && context.entityType !== 'player') return 'NON_PLAYER_ENTITY';
  if (/\s(?:\+|&|vs\.?)\s/.test(text(context.playerName))) return 'MULTI_PLAYER_ENTITY';
  return null;
}

export function buildHistoryPlan(snapshot, { canonicalSport, marketContract, publicLeagues }) {
  if (!snapshot || snapshot.truncated || !Array.isArray(snapshot.active) || !Array.isArray(snapshot.history)
    || !Number.isFinite(Date.parse(snapshot.asOf))) throw new Error('INVALID_OR_TRUNCATED_SNAPSHOT');
  const groups = new Map();
  for (const raw of snapshot.active) {
    const c = { ...raw, sport: text(raw.sport).toUpperCase(), playerName: text(raw.playerName) };
    const key = playerKey(c);
    if (!groups.has(key)) groups.set(key, { key, sport: c.sport, playerName: c.playerName, contexts: [] });
    groups.get(key).contexts.push(c);
  }
  const index = new Map();
  for (const row of snapshot.history) {
    const sport = canonicalSport(row.sport);
    if (!new RegExp(`^history:${sport}:[0-9]+$`).test(text(row.player_id)) || !(Number(row.games) > 0)) continue;
    const key = JSON.stringify([sport, historyName(row.player_name)]);
    if (!index.has(key)) index.set(key, new Set());
    index.get(key).add(row.player_id);
  }
  const players = [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
  for (const player of players) {
    const sport = canonicalSport(player.sport);
    const identities = index.get(JSON.stringify([sport, historyName(player.playerName)])) || new Set();
    player.nameMatchCount = identities.size; // Not proof of provider identity or exact-market history.
    const choices = new Map();
    const reasons = new Set();
    for (const context of player.contexts) {
      let reason = !historyName(player.playerName) ? 'INVALID_PLAYER_NAME' : scopeReason(context);
      if (!reason && !publicLeagues[sport]) reason = 'UNSUPPORTED_PUBLIC_SPORT';
      const params = { ...context, sport, providerMarketKey: context.providerMarketKey || context.marketId || null };
      const contract = reason ? null : marketContract(params);
      if (!reason && (!contract || contract.entityType !== 'player')) reason = 'UNSUPPORTED_EXACT_MARKET';
      if (reason) { reasons.add(reason); continue; }
      // Include team and market context: never select another player's identity
      // just because a shared display name happens to appear on the board.
      const key = JSON.stringify([params.team, params.homeTeam, params.awayTeam, params.providerMarketKey, params.market]);
      choices.set(key, params);
    }
    player.choices = [...choices.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, c]) => c);
    player.reasons = [...reasons].sort();
    player.status = player.choices.length ? 'PENDING_PUBLIC_VERIFICATION' : player.reasons[0] || 'UNSUPPORTED_EXACT_MARKET';
  }
  const cohort = players.map(p => [p.key, p.contexts.map(c => JSON.stringify(c)).sort()]);
  return { asOf: snapshot.asOf, cohortHash: hash(cohort), players, totalPlayers: players.length };
}

export function summarizeHistoryPlan(plan, outcomes = []) {
  const byKey = new Map(outcomes.map(row => [row.key, row]));
  const sports = new Map();
  for (const p of plan.players) {
    if (!sports.has(p.sport)) sports.set(p.sport, { sport: p.sport, activePlayers: 0, nameMatchedPlayers: 0,
      ambiguousNames: 0, publicVerifiedThisRun: 0, durablePlayersProvedThisRun: 0, states: {} });
    const s = sports.get(p.sport), out = byKey.get(p.key);
    s.activePlayers++;
    if (p.nameMatchCount === 1) s.nameMatchedPlayers++;
    if (p.nameMatchCount > 1) s.ambiguousNames++;
    if (out?.publicVerified) s.publicVerifiedThisRun++;
    if (out?.durableVerified) s.durablePlayersProvedThisRun++;
    const state = out?.status || p.status;
    s.states[state] = (s.states[state] || 0) + 1;
  }
  return [...sports.values()].map(s => ({ ...s,
    storedNameCoveragePct: s.activePlayers ? Math.round(1000 * s.nameMatchedPlayers / s.activePlayers) / 10 : null,
    // Explicit: name matches, completed-game existence, exact markets, L20 and
    // complete seasons are different metrics. None is substituted for another.
    exactMarketCoveragePct: null, completeSeasonCoveragePct: null, targetPct: 100,
  }));
}

export function verifyPublicRows(result, params, rows, now = Date.now()) {
  const sport = text(params.sport), id = text(result?.player?.providerPlayerId);
  if (!result?.available || result.entityType !== 'player' || !new RegExp(`^history:${sport}:[0-9]+$`).test(id)
    || historyName(result.player.playerName || result.player.name) !== historyName(params.playerName)) return false;
  const pinned = text(params.providerPlayerId);
  if (pinned.startsWith('history:') && pinned !== id) return false;
  if (!Array.isArray(rows) || !rows.length) return false;
  return rows.every(row => {
    const g = row.stats || {}, date = Date.parse(row.game_date);
    const numeric = v => typeof v === 'number' && Number.isFinite(v);
    return row.player_id === id && row.sport === sport
      && new RegExp(`^${sport.toLowerCase()}:[0-9]+$`).test(text(row.game_id))
      && g.gameId === row.game_id && Date.parse(g.date) === date && Number.isFinite(date) && date < now
      && /^\d{4}$/.test(text(row.season)) && String(g.season) === String(row.season)
      && [2, 3].includes(row.season_type) && g.seasonType === row.season_type
      && new RegExp(`^${sport}:[0-9]+$`).test(text(g.teamId))
      && new RegExp(`^${sport}:[0-9]+$`).test(text(g.opponentId)) && g.teamId !== g.opponentId
      && numeric(g.scoreFor) && g.scoreFor >= 0 && numeric(g.scoreAgainst) && g.scoreAgainst >= 0 && numeric(g.value)
      && g.gameResult === (g.scoreFor === g.scoreAgainst ? 'T' : g.scoreFor > g.scoreAgainst ? 'W' : 'L')
      && (!['NBA', 'WNBA', 'NCAAB'].includes(sport) || numeric(g.minutes) && g.minutes > 0)
      && g.didNotPlay !== true && g.active !== false && !scopeReason({ ...params, ...g, sport })
      && (sport === 'MLB' ? ['batting', 'pitching'].includes(row.category) : row.category === 'general');
  });
}

function boundedInteger(value, fallback, max, label) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`INVALID_${label}`);
  return n;
}

/** Rate-limited public transport. Credentials never cross the ESPN boundary. */
export function createHistoryTransport({ fetchImpl = globalThis.fetch, maxRequests = 80, maxMs = 180000,
  intervalMs = 300, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  maxRequests = boundedInteger(maxRequests, 80, 500, 'REQUEST_LIMIT');
  maxMs = boundedInteger(maxMs, 180000, 600000, 'TIME_LIMIT');
  if (!Number.isFinite(intervalMs) || intervalMs < 250 || intervalMs > 5000) throw new Error('INVALID_INTERVAL');
  const started = now();
  let calls = 0, lastAt = -Infinity, stopped = null, inFlight = false;
  const status = () => ({ calls, elapsedMs: now() - started,
    stopped: stopped || (now() - started >= maxMs ? 'TIME_BUDGET' : calls >= maxRequests ? 'REQUEST_BUDGET' : null) });
  const fetchPublic = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.protocol !== 'https:' || url.port || url.username || url.password
      || !['site.api.espn.com', 'site.web.api.espn.com'].includes(url.hostname)
      || !url.pathname.startsWith('/apis/') || (options.method && options.method !== 'GET') || options.body)
      throw new Error('NON_PUBLIC_HISTORY_REQUEST_BLOCKED');
    // Do not accept API keys in a query even on an allowed host.
    if ([...url.searchParams.keys()].some(k => /key|token|secret|password|auth/i.test(k))) throw new Error('CREDENTIAL_QUERY_BLOCKED');
    if (status().stopped) { stopped = status().stopped; throw new Error(stopped); }
    if (inFlight) throw new Error('CONCURRENT_HISTORY_REQUEST_BLOCKED');
    inFlight = true;
    try {
      await sleep(Math.max(0, intervalMs - (now() - lastAt)));
      if (status().stopped) { stopped = status().stopped; throw new Error(stopped); }
      lastAt = now(); calls++;
      const signals = [AbortSignal.timeout(Math.max(1, Math.min(9000, maxMs - (now() - started))))];
      if (options.signal) signals.push(options.signal);
      const response = await fetchImpl(url.href, { method: 'GET', headers: { accept: 'application/json' },
        redirect: 'error', credentials: 'omit', signal: AbortSignal.any(signals) });
      if (response.status === 429) stopped = 'PUBLIC_RATE_LIMIT';
      else if ([401, 403].includes(response.status)) stopped = 'PUBLIC_ACCESS_DENIED';
      if (!response.ok) { await response.body?.cancel().catch(() => {}); return {ok:false,status:response.status,json:async()=>null}; }
      const maxBytes = 4000000, chunks = []; let bytes = 0;
      if (Number(response.headers.get('content-length')) > maxBytes) {
        stopped = 'PUBLIC_RESPONSE_TOO_LARGE'; await response.body?.cancel().catch(() => {}); throw new Error(stopped);
      }
      const reader = response.body.getReader();
      try {
        for (;;) {
          const {done,value} = await reader.read(); if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) { stopped = 'PUBLIC_RESPONSE_TOO_LARGE'; throw new Error(stopped); }
          chunks.push(Buffer.from(value));
        }
      } finally { await reader.cancel().catch(() => {}); }
      return new Response(Buffer.concat(chunks), {status:response.status,headers:{'content-type':'application/json'}});
    } finally { inFlight = false; }
  };
  return { fetch: fetchPublic, status };
}

function fairQueue(players) {
  const sports = new Map();
  for (const p of players.filter(p => p.choices.length)) {
    if (!sports.has(p.sport)) sports.set(p.sport, []);
    sports.get(p.sport).push(p);
  }
  for (const list of sports.values()) list.sort((a, b) => (a.nameMatchCount > 0) - (b.nameMatchCount > 0) || a.key.localeCompare(b.key));
  const queue = [];
  while ([...sports.values()].some(list => list.length)) for (const list of sports.values()) if (list.length) queue.push(list.shift());
  return queue;
}
const containsEvidence = (stored, expected) => stored && historyKey(stored) === historyKey(expected)
  && stored.sport === expected.sport && Date.parse(stored.game_date) === Date.parse(expected.game_date)
  && Object.entries(expected.stats).every(([k, v]) => JSON.stringify(stored.stats?.[k]) === JSON.stringify(v));

/** A finite maintenance run, never a scheduler. Apply always re-fetches public evidence. */
export async function runHistoryMaintenance(plan, {
  mode = 'audit', approveSnapshot, maxPlayers = 12, maxRows = 200, offset = 0,
  fetchResearch, mapRows, readRows, insertRows, onEvidence, transportStatus = () => ({}), now = Date.now,
} = {}) {
  if (!['audit', 'probe', 'apply'].includes(mode)) throw new Error('INVALID_MODE');
  maxPlayers = boundedInteger(maxPlayers, 12, 100, 'PLAYER_LIMIT');
  maxRows = boundedInteger(maxRows, 200, 1000, 'ROW_LIMIT');
  if (!Number.isInteger(offset) || offset < 0) throw new Error('INVALID_OFFSET');
  if (mode === 'apply' && approveSnapshot !== plan.cohortHash) throw new Error('SNAPSHOT_APPROVAL_REQUIRED');
  const outcomes = new Map(plan.players.map(p => [p.key, { key: p.key, sport: p.sport, playerName: p.playerName,
    status: p.status, nameMatchCount: p.nameMatchCount, publicVerified: false, durableVerified: false, written: 0 }]));
  let attempted = 0, inserted = 0, submitted = 0, stop = null;
  if (mode !== 'audit') {
    if (typeof fetchResearch !== 'function' || typeof mapRows !== 'function') throw new Error('PUBLIC_ADAPTER_REQUIRED');
    if (mode === 'apply' && (typeof readRows !== 'function' || typeof insertRows !== 'function')) throw new Error('PERSISTENCE_ADAPTER_REQUIRED');
    const queue = fairQueue(plan.players);
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i], out = outcomes.get(p.key);
      if (i < offset || attempted >= maxPlayers || stop || transportStatus().stopped || submitted >= maxRows) {
        out.status = 'DEFERRED_BUDGET'; continue;
      }
      attempted++;
      let result, params, rows;
      // At most two existing exact markets; no invented substitute stat.
      for (const choice of p.choices.slice(0, 2)) {
        params = choice;
        try { result = await fetchResearch({ ...params, games: 20 }); }
        catch { result = { available: false, code: 'PUBLIC_PROVIDER_ERROR' }; }
        if (result?.available || transportStatus().stopped || result?.retryable) break;
      }
      if (!result?.available) {
        out.status = transportStatus().stopped || (/^[A-Z0-9_]{1,60}$/.test(result?.code || '') ? result.code : 'PUBLIC_PROVIDER_ERROR');
        continue;
      }
      try { rows = mapRows(result, params, { now }); }
      catch { rows = []; }
      if (!verifyPublicRows(result, params, rows, now())) { out.status = 'INVALID_PUBLIC_EVIDENCE'; continue; }
      out.publicVerified = true;
      out.verifiedPlayerId = result.player.providerPlayerId;
      // Keep an honest bounded sample; do not describe it as a complete season.
      rows = [...new Map(rows.map(r => [historyKey(r), r])).values()]
        .sort((a, b) => Date.parse(b.game_date) - Date.parse(a.game_date)).slice(0, Math.min(40, maxRows - submitted));
      out.verifiedGames = rows.length;
      out.games = rows.map(r => ({ gameId: r.game_id, date: r.game_date, category: r.category }));
      if (onEvidence) await onEvidence({ candidate: {sport: p.sport, playerName: p.playerName}, params, rows });
      if (mode === 'probe') { out.status = 'VERIFIED_BACKFILL_READY'; submitted += rows.length; continue; }
      try {
        const existing = await readRows(rows);
        if (!Array.isArray(existing)) throw new Error('READ_BACK_INVALID');
        const seen = new Set(existing.map(historyKey));
        const missing = rows.filter(r => !seen.has(historyKey(r)));
        // No update path: even a racing live write is protected by ON CONFLICT DO NOTHING.
        if (transportStatus().stopped) { out.status = 'DEFERRED_BEFORE_WRITE'; continue; }
        if (missing.length) {
          const ack = await insertRows(missing, { sport: p.sport, playerName: p.playerName });
          submitted += missing.length;
          if (!Number.isInteger(ack?.written) || ack.written < 0 || ack.written > missing.length) throw new Error('WRITE_ACK_INVALID');
          out.written = ack.written; inserted += ack.written;
          const persisted = await readRows(missing);
          if (!Array.isArray(persisted) || !missing.every(r => containsEvidence(persisted.find(s => historyKey(s) === historyKey(r)), r)))
            throw new Error('READ_BACK_MISMATCH');
        }
        // Existing records must also agree with the public evidence before this
        // run claims durable proof. A conflict is reported, never overwritten.
        if (!rows.every(r => !seen.has(historyKey(r)) || containsEvidence(existing.find(s => historyKey(s) === historyKey(r)), r))) {
          out.status = 'EXISTING_HISTORY_CONFLICT'; continue;
        }
        out.durableVerified = true;
        out.status = missing.length ? 'PERSISTED_AND_READ_BACK' : 'ALREADY_PERSISTED_AND_VERIFIED';
      } catch {
        out.status = 'PERSISTENCE_UNVERIFIED'; stop = 'PERSISTENCE_UNVERIFIED';
      }
    }
  }
  return { schemaVersion: 1, mode, asOf: plan.asOf, cohortHash: plan.cohortHash, targetPct: 100,
    totalPlayers: plan.totalPlayers, attemptedPlayers: attempted, insertedRows: inserted, submittedRows: submitted,
    stopped: stop || transportStatus().stopped || null, network: transportStatus(),
    note: 'Stored name coverage is diagnostic only. Exact-market and complete-season coverage are not inferred. Unavailable and deferred players remain in every denominator.',
    sports: summarizeHistoryPlan(plan, [...outcomes.values()]), outcomes: [...outcomes.values()] };
}
