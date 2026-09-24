// Issue #308: manual, credential-free proof of one game, never cache-age inference.
// No database, persistence, scheduler, server, H2H-backfill, or production singleton imports.
export const PROOF_LIMITS = Object.freeze({ requests: 10, totalMs: 30_000, requestMs: 7_000, bytes: 2_000_000 });
export const PROOF_EXIT = Object.freeze({ HEALTHY: 0, FAILING: 1, UNVERIFIABLE: 2 });
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba';
const WEB = 'https://site.web.api.espn.com/apis';
const identityKey = value => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const digits = value => /^\d+$/.test(String(value ?? ''));
const fault = code => Object.assign(new Error(code), { proofCode: code });
const fail = code => { throw fault(code); };
const scalar = value => typeof value === 'string' || typeof value === 'number';
const number = value => scalar(value) && String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const day = value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date) : null;
};
const completed = competition => competition?.status?.type?.completed === true
  && competition.status.type.state === 'post';
const codeOnly = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : null;

export function selectProofEvent(board, { date, eventId, now = Date.now() }) {
  if (!board?.leagues?.some(league => league.slug === 'wnba')) fail('SLATE_LEAGUE_UNVERIFIED');
  const events = (board.events || []).filter(event => digits(event.id)
    && (!eventId || String(event.id) === String(eventId))
    && [2, 3].includes(Number(event.season?.type)) && Number(event.season?.year) === Number(date.slice(0, 4))
    && day(event.date) === date && Date.parse(event.date) <= now
    && event.competitions?.length === 1 && completed(event.competitions[0])
    && String(event.competitions[0].id) === String(event.id));
  events.sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || String(a.id).localeCompare(String(b.id)));
  if (!events.length) fail('NO_VERIFIED_COMPLETED_EVENT');
  return events[0]; // Exactly one event; no probing the slate until something passes.
}

export function selectProofPlayer(summary, event, { athleteId } = {}) {
  const header = summary?.header, competition = header?.competitions?.[0];
  if (header?.league?.slug !== 'wnba' || String(header?.id) !== String(event.id)
    || header?.competitions?.length !== 1 || String(competition?.id) !== String(event.id)
    || !completed(competition) || Date.parse(competition.date) !== Date.parse(event.date)) fail('SUMMARY_EVENT_UNVERIFIED');
  const teams = competition.competitors || [], slateTeams = event.competitions[0].competitors || [];
  const ids = rows => rows.map(row => String(row.team?.id)).sort().join(',');
  if (teams.length !== 2 || slateTeams.length !== 2 || ids(teams) !== ids(slateTeams)
    || !teams.every(row => digits(row.team?.id)) || teams[0].team.id === teams[1].team.id) fail('SUMMARY_TEAMS_UNVERIFIED');
  const candidates = [];
  for (const box of summary.boxscore?.players || []) {
    const own = teams.find(row => String(row.team.id) === String(box.team?.id));
    if (!own) continue;
    const opponent = teams.find(row => String(row.team.id) !== String(box.team.id));
    for (const group of box.statistics || []) {
      const labels = group.labels || [], minutesIndex = labels.indexOf('MIN'), pointsIndex = labels.indexOf('PTS');
      if (minutesIndex < 0 || pointsIndex < 0 || new Set(labels).size !== labels.length) continue;
      for (const row of group.athletes || []) {
        const athlete = row.athlete;
        if (!digits(athlete?.id) || (athleteId && String(athlete.id) !== String(athleteId))
          || row.didNotPlay === true || row.active === false || row.ejected === true
          || !Array.isArray(row.stats) || row.stats.length !== labels.length) continue;
        const rawMinutes = String(row.stats[minutesIndex]);
        const minutes = /^\d+:\d{2}$/.test(rawMinutes) && Number(rawMinutes.split(':')[1]) < 60
          ? Number(rawMinutes.split(':')[0]) + Number(rawMinutes.split(':')[1]) / 60 : number(rawMinutes);
        const points = number(row.stats[pointsIndex]);
        if (!(minutes > 0) || points === null || points < 0 || !Number.isInteger(points)
          || typeof athlete.displayName !== 'string' || !athlete.displayName.trim()
          || athlete.displayName.length > 100 || !own.team.abbreviation || !opponent.team.abbreviation) continue;
        candidates.push({ eventId: String(event.id), athleteId: String(athlete.id), playerName: athlete.displayName,
          teamId: String(own.team.id), team: own.team.abbreviation,
          opponentId: String(opponent.team.id), opponent: opponent.team.abbreviation,
          date: event.date, season: String(event.season.year), seasonType: Number(event.season.type), minutes, points });
      }
    }
  }
  candidates.sort((a, b) => b.minutes - a.minutes || a.athleteId.localeCompare(b.athleteId));
  if (!candidates.length) fail('NO_VERIFIED_PLAYED_ATHLETE');
  if (candidates.filter(row => row.athleteId === candidates[0].athleteId).length !== 1) fail('AMBIGUOUS_BOX_SCORE_ATHLETE');
  return candidates[0];
}

export function evaluateProof(history, expected) {
  const verdict = (status, code) => ({ status, code, providerCode: codeOnly(history?.code) });
  if (history?.available !== true) return verdict('UNVERIFIABLE', 'RESEARCH_FAIL_CLOSED');
  if (history.player?.providerPlayerId !== `history:WNBA:${expected.athleteId}`
    || history.player?.sport !== 'WNBA') return verdict('FAILING', 'RETURNED_PLAYER_IDENTITY_MISMATCH');
  if (history.entityType !== 'player' || history.statKind !== 'Points' || !Array.isArray(history.gameLog))
    return verdict('UNVERIFIABLE', 'RESEARCH_CONTRACT_UNVERIFIED');
  const matches = history.gameLog.filter(row => row.gameId === `wnba:${expected.eventId}`);
  if (!matches.length) return verdict(history.coverage?.seasonComplete === true && String(history.season) === expected.season
    ? 'FAILING' : 'UNVERIFIABLE', 'VERIFIED_GAME_NOT_RETURNED');
  if (matches.length !== 1) return verdict('FAILING', 'DUPLICATE_TARGET_GAME');
  const row = matches[0];
  if (row.teamId !== `WNBA:${expected.teamId}` || row.opponentId !== `WNBA:${expected.opponentId}`
    || Date.parse(row.date) !== Date.parse(expected.date) || String(row.season) !== expected.season
    || row.seasonType !== expected.seasonType || !(row.minutes > 0) || row.statKind !== 'Points'
    || row.value !== expected.points || row.points !== expected.points) return verdict('FAILING', 'TARGET_GAME_DATA_MISMATCH');
  return verdict('HEALTHY', 'VERIFIED_GAME_RETURNED');
}

// All HTTP, including the production provider's injected fetch, passes here.
// Only this dated slate, one summary, and the verified athlete/team scope are allowed.
export function createProofTransport({ date, fetchImpl, signal, limits = PROOF_LIMITS }) {
  let eventId = null, expected = null, networkRequests = 0, terminalFailure = null;
  const trace = [], visited = new Set();
  const datedScoreboard = `${SITE}/scoreboard?dates=${date.replaceAll('-', '')}&limit=100`;
  function route(url) {
    const u = new URL(url);
    if (u.username || u.password || u.hash || u.port || u.protocol !== 'https:') return null;
    if (u.href === datedScoreboard) return 'slate';
    if (eventId && u.href === `${SITE}/summary?event=${eventId}`) return 'summary';
    if (!expected) return null;
    if (u.href === `${SITE}/scoreboard?limit=1`) return 'season';
    if (u.origin === 'https://site.web.api.espn.com' && u.pathname === '/apis/search/v2'
      && [...u.searchParams.keys()].length === 2 && u.searchParams.get('sport') === 'basketball'
      && typeof u.searchParams.get('query') === 'string' && u.searchParams.get('query').length <= 100
      && identityKey(u.searchParams.get('query')) === identityKey(expected.playerName)) return 'identity';
    const athlete = `${WEB}/common/v3/sports/basketball/wnba/athletes/${expected.athleteId}`;
    if (u.href === athlete) return 'profile';
    if (u.origin + u.pathname === `${athlete}/gamelog`) {
      if (!u.search) return 'gamelog';
      if ([...u.searchParams.keys()].length === 1 && u.searchParams.has('season'))
        return u.searchParams.get('season') === expected.season ? 'gamelog' : 'blocked-prior-season';
    }
    if (u.href === `${SITE}/teams?limit=1000`) return 'teams';
    if ([expected.teamId, expected.opponentId].some(id => u.href === `${SITE}/teams/${id}/roster`)) return 'roster';
    return null;
  }
  const request = async (url, init = {}) => {
    const entry = { kind: 'blocked', status: null, error: null };
    trace.push(entry);
    let timer, combined;
    try {
      if (signal.aborted) fail('PROBE_DEADLINE');
      if (terminalFailure) fail(terminalFailure);
      const kind = route(String(url));
      if (kind) entry.kind = kind;
      if (kind === 'blocked-prior-season') fail('PRIOR_SEASON_READ_BLOCKED');
      if (!kind || (init.method || 'GET').toUpperCase() !== 'GET' || init.body != null
        || [...new Headers(init.headers).keys()].some(key => key !== 'accept')) fail('READ_SCOPE_BLOCKED');
      if (visited.has(String(url))) fail('REPEATED_REQUEST_BLOCKED');
      if (networkRequests >= limits.requests) fail('REQUEST_BUDGET_EXCEEDED');
      visited.add(String(url)); networkRequests++;
      const controller = new AbortController();
      combined = AbortSignal.any([signal, controller.signal, ...(init.signal ? [init.signal] : [])]);
      timer = setTimeout(() => controller.abort(), limits.requestMs);
      const response = await fetchImpl(String(url), {
        method: 'GET', headers: { accept: 'application/json' }, signal: combined,
        redirect: 'error', credentials: 'omit',
      });
      entry.status = response.status;
      if (!response.ok) { await response.body?.cancel(); fail(`UPSTREAM_HTTP_${response.status}`); }
      if (!response.body?.getReader) fail('UPSTREAM_BODY_UNVERIFIED');
      const reader = response.body.getReader(), chunks = []; let size = 0;
      try {
        while (true) {
          if (combined.aborted) fail('UPSTREAM_TIMEOUT');
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength;
          if (size > limits.bytes) { await reader.cancel(); fail('RESPONSE_SIZE_LIMIT'); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let payload;
      try { payload = JSON.parse(new TextDecoder().decode(bytes)); } catch { fail('UPSTREAM_INVALID_JSON'); }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('UPSTREAM_SCHEMA_UNVERIFIED');
      return { ok: true, status: response.status, json: async () => payload };
    } catch (error) {
      entry.error = error.proofCode || (combined?.aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_NETWORK_ERROR');
      if (entry.error !== 'PRIOR_SEASON_READ_BLOCKED') terminalFailure = entry.error;
      throw fault(entry.error); // Never expose upstream error strings/URLs/credentials.
    } finally { clearTimeout(timer); }
  };
  return { fetch: request, datedScoreboard,
    selectEvent: id => { if (!digits(id)) fail('INVALID_EVENT_ID'); eventId = String(id); },
    selectPlayer: player => { expected = player; },
    evidence: () => ({ networkRequests, trace: trace.map(row => ({ ...row })) }),
  };
}

export async function runWnbaProof({ date = '2026-09-17', eventId, athleteId,
  createResearch, fetchImpl = globalThis.fetch, now = () => Date.now(), limits = PROOF_LIMITS } = {}) {
  const started = now(), controller = new AbortController(); let transport, expected, history, timer;
  const base = { issue: 308, sport: 'WNBA', slateDate: date, slateTimeZone: 'America/New_York',
    market: 'player_points', scope: 'isolated-supported-provider; one verified game; not the HTTP route or existing process cache',
    observedAt: new Date(started).toISOString(), readOnly: true };
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
      || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
      || (eventId && !digits(eventId)) || (athleteId && !digits(athleteId))
      || typeof createResearch !== 'function') fail('INVALID_PROBE_ARGUMENTS');
    transport = createProofTransport({ date, fetchImpl, signal: controller.signal, limits });
    const work = async () => {
      const board = await (await transport.fetch(transport.datedScoreboard)).json();
      const event = selectProofEvent(board, { date, eventId, now: started });
      transport.selectEvent(event.id);
      const summary = await (await transport.fetch(`${SITE}/summary?event=${event.id}`)).json();
      expected = selectProofPlayer(summary, event, { athleteId }); transport.selectPlayer(expected);
      // Same factory as fetchPublicResearch; fresh private cache, no customer cache eviction.
      const research = createResearch({ fetchImpl: transport.fetch, now });
      history = await research({ sport: 'WNBA', playerName: expected.playerName, team: expected.team,
        market: 'Points', providerMarketKey: 'player_points', games: 15 });
      return evaluateProof(history, expected);
    };
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => {
      controller.abort(); reject(fault('PROBE_DEADLINE'));
    }, limits.totalMs); });
    let result = await Promise.race([work(), deadline]);
    const evidence = transport.evidence();
    // Never interpret guarded/offline/partial execution as a definitive negative.
    if (result.status === 'FAILING' && result.code === 'VERIFIED_GAME_NOT_RETURNED'
      && evidence.trace.some(row => row.error)) result = { ...result, status: 'UNVERIFIABLE' };
    return { ...base, ...result, expected, returned: { available: history?.available === true,
      games: history?.gameLog?.length ?? 0, season: history?.season ?? null,
      seasonComplete: history?.coverage?.seasonComplete === true, historyPartial: history?.coverage?.historyPartial === true }, ...evidence };
  } catch (error) {
    return { ...base, status: 'UNVERIFIABLE', code: error.proofCode || 'PROBE_INTERNAL_ERROR',
      providerCode: codeOnly(history?.code), ...(expected ? { expected } : {}), ...(transport?.evidence() || {}) };
  } finally { clearTimeout(timer); controller.abort(); }
}
