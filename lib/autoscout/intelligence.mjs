/** Research-only intelligence. All derived results retain their evidence and limitations. */
import { analyzeResearch, analyzeLineHistory } from '../analytics/research.mjs';

const number = v => (typeof v !== 'number' && typeof v !== 'string') || String(v).trim() === ''
  ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const time = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;
const round = v => Number(v.toFixed(3));
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const bookOf = r => r.sportsbookKey || r.bookmaker_key || r.sportsbook;
const stampOf = r => r.providerUpdatedAt || r.updatedAt || r.created_at;
export const INTELLIGENCE_VERSION = '1.0.0';

export function verifiedGames(base = {}) {
  if (base.available !== true || !Array.isArray(base.gameLog)) return [];
  // The existing research service has resolved identity and market. Do not reinterpret raw feeds.
  const eligible = base.gameLog.filter(r => r && number(r.value) !== null && r.dnp !== true
    && r.didNotPlay !== true && r.completed !== false && r.status !== 'scheduled'
    && r.status !== 'in_progress' && (r.gameId || time(r.date) !== null));
  return analyzeResearch({ ...base, gameLog: eligible }).gameLog;
}

/** Always use the production calculation policy, including pushes and season coverage. */
export function sensitivityMap(base, { line, side = 'OVER', window = 'l10', venue = 'all', step = .5 } = {}) {
  const center = number(line), interval = number(step), gameLog = verifiedGames(base);
  if (center === null || !['OVER', 'UNDER'].includes(side) || !interval || interval < 0 || interval > 10 || !gameLog.length)
    return { available: false, rows: [], reason: 'Verified game logs and a numeric line are required.' };
  if (!['l5','l10','l15','l20','season','h2h'].includes(window)) window = 'l10';
  const rows = [-3,-2,-1,0,1,2,3].map(offset => {
    const threshold = round(center + offset * interval);
    const research = analyzeResearch({ ...base, gameLog }, threshold, side, venue);
    const metric = window === 'h2h' ? research.h2h : research.windows[window];
    return { line: threshold, active: offset === 0, games: metric?.games || 0,
      hits: metric?.hits ?? null, misses: metric?.misses ?? null, pushes: metric?.pushes ?? null,
      rate: number(metric?.hitRate), partial: metric?.partial === true };
  });
  return { available: rows.some(r => r.games > 0), rows, window, side, venue,
    note: 'Hypothetical research thresholds, not available offers or forecast probabilities. Pushes are not hits.' };
}

/** Exactly one comparable, regular line per identified book, event, market and side. */
export function disagreementMap(group = {}, side = 'OVER', now = Date.now()) {
  const byBook = new Map(), omitted = [];
  for (const row of group.rows || []) {
    const key = bookOf(row), line = number(row.line);
    if (!key || line === null || row.side !== side || row.isAlternate || row.isPromotional || row.isBoosted || row.isDiscounted) continue;
    if (time(stampOf(row)) !== null && time(stampOf(row)) > now + 300000) continue;
    if (['sport','eventId','marketId','playerId','entityType'].some(k => group[k] != null && row[k] != null && String(row[k]) !== String(group[k]))) continue;
    if (!byBook.has(key)) byBook.set(key, []);
    byBook.get(key).push({ key, name: row.sportsbook || key, line, at: stampOf(row) || null });
  }
  const books = [];
  for (const [key, values] of byBook) {
    const timed = values.filter(v => time(v.at) !== null && time(v.at) <= now + 300000);
    const candidates = timed.length ? timed.filter(v => time(v.at) === Math.max(...timed.map(v => time(v.at)))) : values;
    if (new Set(candidates.map(v => v.line)).size !== 1) { omitted.push(key); continue; }
    const value = candidates[0], age = time(value.at) === null ? null : now - time(value.at);
    books.push({ ...value, stale: age !== null && age > 30 * 60000, freshnessKnown: age !== null });
  }
  books.sort((a,b) => a.line-b.line || a.name.localeCompare(b.name));
  const lines = books.map(v => v.line), min = lines.length ? Math.min(...lines) : null, max = lines.length ? Math.max(...lines) : null;
  return { available: books.length > 0, comparable: books.length >= 2, books, omitted, min, max,
    spread: min === null ? null : round(max-min), median: lines.length ? (lines[Math.floor((lines.length-1)/2)]+lines[Math.ceil((lines.length-1)/2)])/2 : null,
    note: 'Same event, player, market and side. One regular line per book. No claim of best value.' };
}

/** Transparent evidence availability, never a chance of winning or a model confidence score. */
export function evidenceQuality(base = {}, group = {}, side = 'OVER', now = Date.now()) {
  const games = verifiedGames(base), market = disagreementMap(group, side, now);
  const idKnown = Boolean(base.player?.id || base.player?.providerPlayerId || base.player?.playerId);
  const latest = market.books.map(b=>time(b.at)).filter(t=>t!==null && t<=now+300000);
  const age = latest.length ? Math.max(0, now - Math.max(...latest)) : null;
  const checks = [
    { label: 'Historical sample', met: games.length >= 10, detail: `${games.length} verified games; target 10+.` },
    { label: 'Resolved history identity', met: idKnown, detail: idKnown ? 'A provider player identifier accompanies the research.' : 'No resolved history identifier is exposed in this response.' },
    { label: 'Line freshness', met: age !== null && age <= 30*60000, detail: age === null ? 'Provider timestamp unavailable.' : `Newest comparable line: ${Math.floor(age/60000)} minutes old.` },
    { label: 'Book coverage', met: market.books.length >= 2, detail: `${market.books.length} unambiguous comparable books.` },
    { label: 'Opponent context', met: Boolean(base.matchup?.opponentId || base.matchup?.opponent), detail: base.matchup?.opponent || 'Opponent not verified in research.' },
    { label: 'Lineup confirmation', met: base.context?.lineupConfirmed === true, detail: base.context?.lineupConfirmed === true ? 'Explicit lineup confirmation supplied.' : 'No explicit lineup confirmation; not inferred from injury status.' },
  ];
  const passed = checks.filter(c=>c.met).length;
  return { passed, total: checks.length, games: games.length, checks,
    label: passed >= 5 && idKnown && games.length >= 10 ? 'Broad evidence' : passed >= 3 ? 'Partial evidence' : 'Limited evidence',
    note: 'Evidence coverage, not predictive confidence. More checks do not imply a safer or winning selection.' };
}

/** Timestamped observations only. An injury status without a timestamp is not an event. */
export function propTimeline({ history = [], propId, book, side = 'OVER', contextEvents = [], groupKey, now = Date.now() } = {}) {
  const events = [];
  if (propId && book) {
    const series = analyzeLineHistory(history, { propId, bookmaker: book, side });
    let previous = null;
    for (const row of series.rows.filter(r=>r.observedAt<=now+300000)) {
      if (!previous || previous.line !== row.line) events.push({ kind: 'line', at: row.created_at,
        label: previous ? `${book}: ${previous.line} → ${row.line}` : `${book}: first recorded line ${row.line}`,
        detail: `${side} · ${previous ? 'Observed change; cause unknown.' : 'Baseline observation, not a move.'}`,
        book, from: previous?.line ?? null, to: row.line, source: 'Stored line history' });
      previous = row;
    }
  }
  for (const item of contextEvents) {
    if (!groupKey || item.groupKey !== groupKey || !['injury','lineup','projection','game'].includes(item.kind)
        || time(item.at) === null || time(item.at)>now+300000 || !item.source || !item.label) continue;
    events.push({ kind:item.kind, at:item.at, label:String(item.label).slice(0,180), detail:'Timestamped observation; no causal claim.', source:String(item.source).slice(0,80) });
  }
  const seen = new Set();
  return events.sort((a,b)=>time(b.at)-time(a.at)).filter(e=>{const key=[e.kind,e.book,e.at,e.label].join('|');if(seen.has(key))return false;seen.add(key);return true;}).slice(0,100);
}

/** Explainable basketball per-minute what-if, not a trained prediction or teammate effect. */
export function scenarioLab(base = {}, { sport, targetMinutes, usagePercent = 0, window = 10 } = {}) {
  if (!['NBA','WNBA','NCAAB'].includes(sport)) return { available:false, reason:'Minute-based scenarios require a basketball game log with minutes. No sport conversion is inferred.' };
  const requested = number(targetMinutes), usage = number(usagePercent);
  if (requested === null || requested < 0 || requested > 60 || usage === null || usage < -50 || usage > 50)
    return { available:false, reason:'Enter 0–60 minutes and a user-assumed usage adjustment between −50% and +50%.' };
  const games = verifiedGames(base).slice(0, window === 20 ? 20 : 10).filter(g=>number(g.minutes)!==null && number(g.minutes)>0);
  if (games.length < 4) return { available:false, reason:'At least four verified games with positive minutes and this stat are required.' };
  const totalMinutes = games.reduce((s,g)=>s+number(g.minutes),0), rate = games.reduce((s,g)=>s+g.value,0)/totalMinutes;
  const baselineMinutes = totalMinutes/games.length, baseline = rate*baselineMinutes, adjusted = rate*requested*(1+usage/100);
  return { available:true, games:games.length, rate:round(rate), baselineMinutes:round(baselineMinutes),
    baseline:round(baseline), targetMinutes:requested, usagePercent:usage, adjusted:round(adjusted), delta:round(adjusted-baseline),
    formula:'(sum of observed stat / sum of observed minutes) × assumed minutes × (1 + assumed usage change / 100)',
    note:'User-controlled hypothetical; linear rate assumption, not an AI forecast. Teammate absences do not automatically change usage.' };
}

/** A missing participant is UNKNOWN. Only an explicit played:false is an absence. */
export function playerDependencies(base = {}) {
  const buckets = new Map();
  for (const game of verifiedGames(base)) {
    if (!Array.isArray(game.teammateParticipation)) continue;
    const seen = new Set();
    for (const member of game.teammateParticipation) {
      if (!member?.playerId || !member.name || typeof member.played !== 'boolean' || member.verified !== true || !member.source) continue;
      const id = String(member.playerId); if (seen.has(id)) continue; seen.add(id);
      if (game.teammateParticipation.some(other => String(other?.playerId) === id && typeof other.played === 'boolean' && other.played !== member.played)) continue;
      if (!buckets.has(id)) buckets.set(id,{ id, name:String(member.name), with:[], without:[] });
      buckets.get(id)[member.played?'with':'without'].push(game.value);
    }
  }
  return [...buckets.values()].map(b=>({ id:b.id, name:b.name, withGames:b.with.length, withoutGames:b.without.length,
    withAverage:mean(b.with), withoutAverage:mean(b.without),
    difference:b.with.length&&b.without.length?round(mean(b.without)-mean(b.with)):null,
    limited:b.with.length<5||b.without.length<5,
    note:'Historical association, not causation. Opponents, role and season may differ.' }));
}

/** Bounded in-memory radar: no polling, paid requests, storage of accounts or invented history. */
export function createChangeRadar({ capacity = 2500 } = {}) {
  const snapshots = new Map(), observations = new Map(); let events = [];
  return {
    observe(groups = [], { scope, at, stale = false, now = Date.now() } = {}) {
      const seenAt = time(at);
      if (!scope || stale || seenAt === null || seenAt > now+300000 || (snapshots.get(scope) || 0) >= seenAt) return;
      snapshots.delete(scope); snapshots.set(scope,seenAt);
      while (snapshots.size>12) snapshots.delete(snapshots.keys().next().value);
      for (const g of groups.slice(0,capacity)) for (const side of ['OVER','UNDER']) {
        for (const offer of disagreementMap(g,side,now).books) {
          const key=[scope,g.key,offer.key,side].join('|'), prior=observations.get(key);
          const providerAt=time(offer.at);
          // Never turn a provider's older quote into a fresh market move.
          const monotonic = !prior || providerAt===null || prior.providerAt===null || providerAt>=prior.providerAt;
          if (prior && monotonic && prior.line!==offer.line && !(providerAt!==null && providerAt===prior.providerAt)) {
            events.unshift({ groupKey:g.key, player:g.playerName, market:g.market, side, book:offer.name,
              from:prior.line, to:offer.line, delta:round(offer.line-prior.line), at:new Date(seenAt).toISOString(),
              observed:true, label:'Observed between board refreshes; cause unknown.' });
          }
          if(monotonic) { observations.delete(key); observations.set(key,{line:offer.line,providerAt}); }
        }
      }
      while(observations.size>capacity) observations.delete(observations.keys().next().value);
      events=events.filter(e=>now-time(e.at)<24*3600000).slice(0,100);
    },
    current(keys = null) { return events.filter(e=>!keys||keys.has(e.groupKey)).slice(0,20); },
    clear() { snapshots.clear(); observations.clear(); events=[]; },
  };
}

/** Deterministic, cited briefing: no extra AI request, no recommendations to wager. */
export function researchBrief({ base = {}, group = {}, line, side = 'OVER', timeline = [], now = Date.now() } = {}) {
  const gameLog=verifiedGames(base), analysis=analyzeResearch({...base,gameLog},line,side), evidence=[];
  for (const key of ['l5','l10','l15','l20','season','h2h']) {
    const metric=key==='h2h'?analysis.h2h:analysis.windows[key];
    if (metric?.games && number(metric.hitRate)!==null) evidence.push({
      id:`E${evidence.length+1}`, label:key.toUpperCase(),
      text:`${metric.hits}/${metric.games} games (${Math.round(metric.hitRate)}%) met the ${side.toLowerCase()} criterion; ${metric.pushes||0} pushes.${key==='season'&&analysis.coverage?.seasonPartial?' Partial current-season coverage.':''}`,
      source:`Verified ${group.market||'stat'} game log, ${gameLog.at(-1)?.date?.slice(0,10)||'date unknown'} to ${gameLog[0]?.date?.slice(0,10)||'date unknown'}` });
  }
  const map=disagreementMap(group,side,now), quality=evidenceQuality(base,group,side,now);
  if(map.available) evidence.push({id:`E${evidence.length+1}`,label:'Book comparison',text:`${map.books.length} comparable books: ${map.min}–${map.max}.`,source:'Current normalized board; book timestamps shown in Disagreement.'});
  for(const event of timeline.slice(0,3)) evidence.push({id:`E${evidence.length+1}`,label:'Observed event',text:`${event.at}: ${event.label}`,source:event.source});
  const gaps=[];
  if(!gameLog.length)gaps.push('Verified game logs are unavailable.');
  if(!timeline.length)gaps.push('No timestamped change history has been loaded.');
  if(!playerDependencies(base).some(d=>!d.limited))gaps.push('Sufficient verified with/without teammate samples are unavailable.');
  const title=`${group.playerName||'Player'} · ${group.market||'Research'} · ${side} ${number(line)??'Unavailable'}`;
  const note='Historical outcomes are not forecast probabilities. Correlation is not causation. This brief is not a recommendation to wager.';
  return {title,evidence,quality,gaps,note,text:[title,`Evidence coverage: ${quality.passed}/${quality.total} checks (${quality.label}).`,...evidence.map(e=>`[${e.id}] ${e.label}: ${e.text}\nSource: ${e.source}`),...gaps.map(g=>`Missing: ${g}`),note].join('\n\n')};
}
