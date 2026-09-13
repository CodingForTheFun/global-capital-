/** Auto Scout evidence tools. No I/O, model calls, provider requests or betting actions. */
import { analyzeResearch, researchOpponentMatches } from '../analytics/research.mjs';

export const number = value => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const n = Number(value); return Number.isFinite(n) ? n : null;
};
export const timestamp = value => {
  if (!value || typeof value !== 'string') return null;
  const n = Date.parse(value); return Number.isFinite(n) ? n : null;
};
const array = value => Array.isArray(value) ? value : [];
const round = value => Math.round(value * 1000) / 1000;
const avg = rows => rows.length ? rows.reduce((sum, r) => sum + r.value, 0) / rows.length : null;
export function sample(base, line, side, window = 'l10') {
  const r = analyzeResearch(base || {}, line, side);
  const metric = window === 'h2h' ? r.h2h : r.windows?.[window];
  let rows = r.gameLog || [];
  if (window === 'season') rows = rows.filter(g => String(g.season) === String(r.season) && (g.seasonType == null || Number(g.seasonType) === 2));
  else if (window === 'h2h') rows = rows.filter(g => researchOpponentMatches(g, r.matchup));
  else rows = rows.slice(0, ({ l5: 5, l10: 10, l15: 15, l20: 20 })[window] || 10);
  return { r, rows, metric: metric || null };
}
export function lineSensitivity(base, activeLine, side = 'OVER', { window = 'l10', step = 1 } = {}) {
  const line = number(activeLine), increment = number(step);
  if (line === null || increment === null || increment <= 0 || increment > 100) return [];
  if (!['OVER','UNDER'].includes(side)) return [];
  return Array.from({ length: 9 }, (_, i) => round(line + (i - 4) * increment)).map(value => {
    const { metric } = sample(base, value, side, window);
    return { line: value, active: value === line, side, games: metric?.games ?? 0,
      hits: metric?.hits ?? null, pushes: metric?.pushes ?? null, misses: metric?.misses ?? null,
      hitRate: number(metric?.hitRate), average: number(metric?.average), partial: !!metric?.partial };
  });
}

/** One fresh main quote per book/side. Caller supplies ONE event/player/market. */
export function bookDistribution(rows, { side = 'OVER', now = Date.now(), maxAgeMs = 3 * 3600e3 } = {}) {
  const byBook = new Map();
  for (const row of array(rows)) {
    if (!row || row.side !== side || row.isAlternate || row.isPromotional || row.isGoblin || row.isDemon) continue;
    const line = number(row.line), key = String(row.sportsbookKey || row.sportsbook || '').trim();
    if (line === null || !key) continue;
    const at = row.providerUpdatedAt || row.updatedAt || null, time = timestamp(at);
    const quote = { book: key, name: String(row.sportsbook || key), line, at, time,
      stale: time !== null && (time > now + 60000 || now - time > maxAgeMs), timestampKnown: time !== null };
    const old = byBook.get(key);
    if (!old || (time ?? -1) > (old.time ?? -1)) byBook.set(key, quote);
  }
  const quotes = [...byBook.values()].sort((a,b) => a.line - b.line || a.book.localeCompare(b.book));
  const comparable = quotes.filter(q => !q.stale);
  const values = comparable.map(q => q.line).sort((a,b) => a - b);
  const mid = Math.floor(values.length / 2);
  return { side, quotes, books: comparable.length, available: values.length >= 2,
    min: values.length ? values[0] : null, max: values.length ? values.at(-1) : null,
    spread: values.length >= 2 ? round(values.at(-1) - values[0]) : null,
    median: values.length ? (values.length % 2 ? values[mid] : (values[mid-1] + values[mid]) / 2) : null,
    timestampKnown: comparable.filter(q => q.timestampKnown).length,
    excludedStale: quotes.filter(q => q.stale).length };
}

/** Explicit evidence checklist, NOT a forecast confidence or win probability. */
export function dataQuality(base = {}, distribution = {}, { now = Date.now() } = {}) {
  const clean = analyzeResearch(base, base.line, base.side);
  const games = clean.gameLog?.length || 0;
  const newest = Math.max(...array(distribution.quotes).filter(q => !q.stale && q.time !== null).map(q => q.time), -Infinity);
  const quoteAge = Number.isFinite(newest) ? now - newest : null;
  const checks = [
    { id:'identity', label:'History identity', pass: base.available === true && !!base.player?.providerPlayerId,
      detail: base.available && base.player?.providerPlayerId ? 'History returned with a provider player ID.' : 'No verified history identity in this response.' },
    { id:'history', label:'Historical sample', pass: games >= 20, detail: `${games} usable games; 20-game target. Short samples remain usable.` },
    { id:'freshness', label:'Quote freshness', pass: quoteAge !== null && quoteAge >= -60000 && quoteAge <= 30*60e3,
      detail: quoteAge === null ? 'Quote update time unavailable.' : quoteAge < -60000 ? 'Quote timestamp is in the future.' : `Newest comparable quote ${Math.max(0,Math.round(quoteAge/60000))} minutes old; 30-minute target.` },
    { id:'books', label:'Cross-book coverage', pass: distribution.books >= 2, detail: `${distribution.books || 0} comparable main-line books; two-book target. Unknown quote times are flagged.` },
    { id:'opponent', label:'Opponent sample', pass: (clean.h2h?.games || 0) >= 5, detail: `${clean.h2h?.games || 0} verified opponent games; five-game target.` },
    { id:'lineup', label:'Lineup verification', pass: base.context?.lineupVerified === true,
      detail: base.context?.lineupVerified === true ? 'Explicit verified-lineup flag supplied.' : 'Current lineup is not independently verified in this response.' },
  ];
  const passed = checks.filter(c => c.pass).length;
  return { checks, passed, total: checks.length, percent: Math.round(100 * passed / checks.length),
    label: passed >= 5 ? 'Strong coverage' : passed >= 3 ? 'Partial coverage' : 'Limited evidence', games };
}

/** Deterministic user-controlled proportional scenario, not an injury prediction. */
export function scenarioLab({ baseline, adjustmentPercent = 0, baselineMinutes = null, targetMinutes = null } = {}) {
  const b = number(baseline), adjustment = number(adjustmentPercent), bm = number(baselineMinutes), tm = number(targetMinutes);
  if (b === null || adjustment === null || adjustment < -50 || adjustment > 50) return { available:false, reason:'A measured baseline and a -50% to +50% adjustment are required.' };
  if (targetMinutes != null && (tm === null || bm === null || bm <= 0 || tm < 0 || tm > 60)) return { available:false, reason:'Minutes require a positive observed baseline and a target from 0 to 60.' };
  const minuteFactor = tm === null ? 1 : tm / bm;
  const adjusted = b * (1 + adjustment / 100) * minuteFactor;
  return { available:true, baseline:b, adjusted:round(adjusted), delta:round(adjusted-b),
    adjustmentPercent:adjustment, baselineMinutes:bm, targetMinutes:tm, minuteFactor,
    formula:'baseline × (1 + adjustment / 100) × (target minutes / baseline minutes, when used)' };
}

/** Persisted history is filtered by exact prop, book and side before use. */
export function intelligenceTimeline({ history = [], propId, book, side = 'OVER', observations = [] } = {}) {
  const seen = new Set(), out = [];
  if (propId && book) for (const row of array(history)) {
    if (row.prop_id !== propId || row.bookmaker_key !== book || row.side !== side) continue;
    const at = row.created_at, t = timestamp(at), line = number(row.line);
    if (t === null || line === null) continue;
    const id = `line|${propId}|${book}|${side}|${at}|${line}|${row.price}`;
    if (seen.has(id)) continue; seen.add(id);
    out.push({ id, kind:'Line', at, time:t, label:`${book} · ${side} ${line}`, detail:'Persisted observation; not necessarily the exact change time.', line });
  }
  for (const row of array(observations)) {
    const t = timestamp(row?.at);
    if (t === null || !['Injury','Lineup','Projection','Game'].includes(row.kind)) continue;
    const id = `${row.kind}|${row.at}|${row.label}`;
    if (seen.has(id)) continue; seen.add(id);
    out.push({ id, kind:row.kind, at:row.at, time:t, label:String(row.label || ''),
      detail:'Observed during this visit. Timing does not establish causation.' });
  }
  return out.sort((a,b) => b.time-a.time).slice(0,200);
}

/** Exact IDs + explicit participation only. Missing participation is never absence. */
export function dependencyGraph(base = {}) {
  base = base || {};
  const games = analyzeResearch(base, base.line, base.side).gameLog || [];
  const map = new Map();
  for (const game of games) {
    if (!game.gameId || number(game.value) === null) continue;
    const mates = new Map(), conflicts = new Set();
    for (const mate of array(game.teammateParticipation)) {
      if (!mate || !mate.playerId || mate.verified !== true || typeof mate.played !== 'boolean') continue;
      const id = String(mate.playerId), prior = mates.get(id);
      if (prior && prior.played !== mate.played) conflicts.add(id);
      mates.set(id,mate);
    }
    for (const [id,mate] of mates) {
      if (conflicts.has(id)) continue;
      if (!map.has(id)) map.set(id,{ id, name:String(mate.playerName || 'Teammate'), with:[], without:[] });
      map.get(id)[mate.played ? 'with' : 'without'].push(game);
    }
  }
  return [...map.values()].filter(g => g.with.length && g.without.length).map(g => ({
    id:g.id, name:g.name, withGames:g.with.length, withoutGames:g.without.length,
    withAverage:avg(g.with), withoutAverage:avg(g.without), delta:avg(g.without)-avg(g.with),
    smallSample:g.with.length < 5 || g.without.length < 5,
    games:g.with.concat(g.without).map(r => String(r.gameId)),
  })).sort((a,b) => Math.abs(b.delta)-Math.abs(a.delta));
}

const quoteKey = (g,r) => [g.sport,g.eventId,g.playerId || g.playerName,g.marketId || g.market,r.sportsbookKey || r.sportsbook,r.side].join('|');
/** Session-local change detector. Never asserts removals from a partial snapshot. */
export function createChangeRadar({ limit = 80 } = {}) {
  const states = new Map();
  return {
    clear() { states.clear(); },
    observe(groups, { sport, at = new Date().toISOString(), complete = false, stale = false } = {}) {
      if (!sport || stale || timestamp(at) === null) return;
      const old = states.get(sport), quotes = new Map(), events = old ? old.events.slice() : [];
      for (const g of array(groups)) for (const row of array(g.rows)) {
        if (g.sport !== sport || row.isAlternate || row.isPromotional || row.isGoblin || row.isDemon || !['OVER','UNDER'].includes(row.side) || number(row.line) === null) continue;
        const key = quoteKey(g,row), value = { key,groupKey:g.key,player:g.playerName,market:g.market,book:row.sportsbook || row.sportsbookKey,side:row.side,line:number(row.line),at };
        const priorInBatch = quotes.get(key);
        if (priorInBatch) continue;
        quotes.set(key,value);
        const prior = old?.quotes.get(key);
        if (prior && prior.line !== value.line) events.unshift({...value,kind:'Line move',from:prior.line,to:value.line,delta:round(value.line-prior.line),previousAt:prior.at});
        else if (old && !prior) events.unshift({...value,kind:'Newly returned',from:null,to:value.line,delta:null});
      }
      if (old && complete) for (const [key,prior] of old.quotes) if (!quotes.has(key)) events.unshift({...prior,kind:'Not in snapshot',at,from:prior.line,to:null,delta:null});
      const observed = complete ? quotes : new Map([...(old?.quotes || []),...quotes]);
      while (observed.size > 12000) observed.delete(observed.keys().next().value);
      const unique = new Map(); for (const e of events) { const id=[e.key,e.kind,e.at,e.from,e.to].join('|'); if (!unique.has(id)) unique.set(id,e); }
      states.set(sport,{quotes:observed,events:[...unique.values()].slice(0,limit),at});
    },
    events(sport) { return (states.get(sport)?.events || []).slice(); },
    observedAt(sport) { return states.get(sport)?.at || null; },
  };
}

/** A cited, reproducible brief assembled only from the supplied research payload. */
export function researchBrief({ group = {}, base = {}, line, side = 'OVER', distribution, quality, timeline = [] } = {}) {
  const r = analyzeResearch(base,line,side), facts = [], gaps = [];
  for (const id of ['l5','l10','l15','l20','season']) {
    const w = r.windows?.[id];
    if (number(w?.hitRate) === null || !w.games) continue;
    facts.push({ id:id.toUpperCase(),section:'games',text:`${id === 'season' ? `Season ${r.season ?? ''}${w.partial ? ' (partial)' : ''}` : id.toUpperCase()}: ${w.hits}/${w.games} hits (${w.hitRate}%), ${w.pushes || 0} pushes; average ${w.average}.` });
  }
  if (!facts.length) gaps.push('No completed game-log sample is available.');
  if (distribution?.available) facts.push({id:'BOOKS',section:'market',text:`Main ${side} lines range from ${distribution.min} to ${distribution.max} across ${distribution.books} books. This is market disagreement, not proof of an edge.`});
  else gaps.push('Fewer than two comparable book lines.');
  if (quality) { facts.push({id:'EVIDENCE',section:'evidence',text:`${quality.passed}/${quality.total} evidence checks met. This is data coverage, not win probability.`}); gaps.push(...quality.checks.filter(c=>!c.pass).map(c=>c.detail)); }
  if (timeline.length) facts.push({id:'TIMELINE',section:'timeline',text:`${timeline.length} recorded/observed timeline entries available. Events occurring together are not necessarily causal.`});
  else gaps.push('No stored timeline loaded for this selection.');
  return { title:`${group.playerName || 'Player'} · ${group.market || 'Prop'} · ${side} ${number(line) ?? 'Unavailable'}`,
    facts, gaps:[...new Set(gaps)], disclaimer:'Historical results describe this sample, not future probability. Pushes are not hits. No wager is placed.',
    text:[`${group.playerName || 'Player'} · ${group.market || 'Prop'} · ${side} ${number(line) ?? 'Unavailable'}`,...facts.map(f=>`[${f.id}] ${f.text}`),'Missing evidence:',...[...new Set(gaps)].map(g=>`- ${g}`),'Research only; not a guarantee.'].join('\n') };
}
