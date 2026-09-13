import {analyzeResearch, researchOpponentMatches, summarizeResearchSample} from './research.mjs';

const numeric = v => (typeof v === 'number' || typeof v === 'string') && String(v).trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
const timestamp = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;
const identity = row => row.gameId || (row.date && (row.opponentId || row.opponent) ? JSON.stringify([row.date,row.opponentId||row.opponent]) : null);
const fingerprint = row => JSON.stringify([row.value,row.date,row.opponentId??null,row.opponent??null,row.isHome??null,row.started??null,row.minutes??null,row.season??null,row.seasonType??null]);

// The research API already resolves the player and statistic. Keep that scope;
// do not join other players, team totals, or infer missing participation here.
export function matchupSample(base = {}, {window = 'l10', now = Date.now(), eventStart} = {}) {
  if (base.available !== true || base.entityType === 'team' || !Array.isArray(base.gameLog)) return [];
  if (!Number.isFinite(now)) return [];
  const start = timestamp(eventStart), cutoff = start === null ? now : Math.min(now,start);
  const byGame = new Map();
  for (const source of base.gameLog) {
    if (!source || numeric(source.value) === null) continue;
    const date = timestamp(source.date), id = identity(source);
    if (!id || date === null || date >= cutoff || source.completed === false || source.dnp === true || source.didNotPlay === true) continue;
    if (source.status != null && !['final','completed','post','closed'].includes(String(source.status).toLowerCase())) continue;
    if (base.player?.sport && source.sport && source.sport !== base.player.sport) continue;
    if (base.player?.id && source.playerId && String(base.player.id) !== String(source.playerId)) continue;
    const row = {...source,value:numeric(source.value),minutes:numeric(source.minutes)};
    if (!byGame.has(id)) byGame.set(id,[]);
    byGame.get(id).push(row);
  }
  const rows = [...byGame.values()].filter(versions=>new Set(versions.map(fingerprint)).size === 1).map(versions=>versions[0])
    .sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)||String(identity(a)).localeCompare(String(identity(b))));
  if (window === 'season') return base.season == null ? [] : rows.filter(r=>String(r.season) === String(base.season) && (r.seasonType == null || Number(r.seasonType) === 2));
  if (window === 'h2h') return rows.filter(r=>researchOpponentMatches(r,base.matchup||{}));
  const limit = {l5:5,l10:10,l15:15,l20:20}[window];
  return limit ? rows.slice(0,limit) : [];
}

function summarize(rows, line, side) {
  // Reuse the published research policy, including pushes in the denominator.
  const result = analyzeResearch({available:rows.length>0,gameLog:rows},line,side);
  const aggregate = summarizeResearchSample(rows,line,side);
  return {games:aggregate.games,average:aggregate.average,hitRate:aggregate.hitRate,hits:aggregate.hits,
    misses:aggregate.misses,pushes:aggregate.pushes,limited:rows.length>0&&rows.length<5,rows:result.gameLog};
}

export function matchupAnalysis(base = {}, options = {}) {
  const line = numeric(options.line), side = options.side === 'UNDER' ? 'UNDER' : 'OVER';
  const rows = matchupSample(base,options), summarizeRows = r=>summarize(r,line,side);
  const baseline = summarizeRows(rows);
  const opponentKnown = Boolean(base.matchup?.opponentId || base.matchup?.opponent);
  return {available:rows.length>0,window:options.window||'l10',line,side,baseline,
    home:summarizeRows(rows.filter(r=>r.isHome===true)),away:summarizeRows(rows.filter(r=>r.isHome===false)),
    h2h:summarizeRows(opponentKnown?rows.filter(r=>researchOpponentMatches(r,base.matchup||{})):[]),opponentKnown,
    opponent:base.matchup?.opponent||null,unknownVenue:rows.filter(r=>typeof r.isHome!=='boolean').length,
    targetVenue:base.matchup?.isHome===true?'home':base.matchup?.isHome===false?'away':null,
    partialSeason:options.window==='season'&&base.coverage?.seasonComplete!==true};
}

export function similarGames(base = {}, options = {}) {
  const rows = matchupSample(base,options), venue = options.venue || 'matchup', role = options.role || 'any';
  const selectedVenue = venue === 'matchup' ? (base.matchup?.isHome===true?'home':base.matchup?.isHome===false?'away':null) : venue;
  const min = options.minMinutes == null || options.minMinutes === '' ? null : numeric(options.minMinutes);
  const max = options.maxMinutes == null || options.maxMinutes === '' ? null : numeric(options.maxMinutes);
  const minProvided = options.minMinutes != null && options.minMinutes !== '';
  const maxProvided = options.maxMinutes != null && options.maxMinutes !== '';
  const minutesRequested = minProvided || maxProvided;
  const invalidRange = minProvided && min === null || maxProvided && max === null || min !== null && min < 0 || max !== null && max < 0 || min !== null && max !== null && min > max;
  const minutesSupported = ['NBA','WNBA','NCAAB','NHL'].includes(options.sport || base.player?.sport);
  let reason = null;
  if (!['any','home','away'].includes(selectedVenue)) reason = 'The upcoming venue is not verified. Choose a historical venue to explore.';
  if (!['any','starter','bench'].includes(role)) reason = 'Choose a supported starter-status filter.';
  if (minutesRequested && (!minutesSupported || invalidRange)) reason = 'Choose a valid minutes range for a sport with recorded minutes.';
  const matches = reason ? [] : rows.filter(r=>(selectedVenue==='any'||r.isHome===(selectedVenue==='home'))
    && (role==='any'||r.started===(role==='starter'))
    && (!minutesRequested||r.minutes!==null&&r.minutes>=0&&(min===null||r.minutes>=min)&&(max===null||r.minutes<=max)));
  return {available:matches.length>0,reason,venue:selectedVenue,role,minMinutes:min,maxMinutes:max,minutesSupported,
    candidates:rows.length,matched:matches.length,summary:summarize(matches,numeric(options.line),options.side==='UNDER'?'UNDER':'OVER'),
    note:'Same-player historical conditions, not a forecast. Actual past minutes and starting roles are not known future conditions. Selection never uses whether a prop hit.'};
}
