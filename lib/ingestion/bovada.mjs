import { canonicalSport, marketContract, numeric } from '../data-sources/espn/stat-contract.mjs';
const text = (value) => String(value ?? '').trim();
const list = (value) => Array.isArray(value) ? value : [];
const iso = (value) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

const sportFromPath = (path) => canonicalSport({ 'baseball/mlb':'MLB','football/nfl':'NFL','basketball/nba':'NBA','basketball/wnba':'WNBA','hockey/nhl':'NHL' }[path] || path);
function playerAndMarket(market) {
  const description = text(market?.description || market?.name);
  const clean = description.replace(/\s*[-–—:]\s*(?:total|player total|props?)\b.*$/i,'').trim();
  const explicit = text(market?.competitor?.name || market?.player?.name || market?.participant?.name);
  const player = explicit || (/^[A-Z][\p{L}'.-]+(?:\s+[A-Z][\p{L}'.-]+){1,3}\s*[-–—:]/u.test(description) ? description.split(/\s*[-–—:]\s*/)[0].trim() : clean !== description ? clean : '');
  const marketName = text(market?.statType || market?.stat_type || market?.marketType || market?.type || (clean !== description ? description.slice(clean.length).replace(/^\s*[-–—:]\s*/,'') : description));
  return { player, marketName: marketName.replace(/^total\s+/i,'').trim() || description };
}
function outcomeSide(outcome) {
  const label = text(outcome?.description || outcome?.name).toUpperCase();
  return /^(OVER|O\b)/.test(label) ? 'OVER' : /^(UNDER|U\b)/.test(label) ? 'UNDER' : null;
}
function american(outcome) {
  const value = numeric(outcome?.price?.american ?? outcome?.price?.americanDisplay ?? outcome?.american ?? outcome?.odds);
  return value !== null && Math.abs(value) >= 100 ? value : null;
}
function point(outcome, market) { return numeric(outcome?.price?.handicap ?? outcome?.handicap ?? outcome?.line ?? market?.line ?? market?.handicap); }

/** Normalize only explicit player O/U markets. Team/game markets are ignored. */
export function normalizeBovada(payload, sportPath) {
  if (!Array.isArray(payload)) throw new Error('INVALID_BOVADA_SCHEMA');
  const sport = sportFromPath(sportPath), out = [];
  for (const league of payload) for (const event of list(league?.events || league?.event)) {
    const start = iso(event?.startTime || event?.start_time || event?.scheduledAt);
    if (!start || Date.parse(start) <= Date.now() - 60_000) continue;
    const competitors = list(event?.competitors), home = competitors.find(c=>c.home===true||/home/i.test(c.designation||'')), away = competitors.find(c=>c.home===false||/away/i.test(c.designation||''));
    for (const group of list(event?.displayGroups)) for (const market of list(group?.markets)) {
      const outcomes = list(market?.outcomes), sides = outcomes.map(outcomeSide).filter(Boolean);
      if (!sides.includes('OVER') || !sides.includes('UNDER')) continue;
      const { player, marketName } = playerAndMarket(market);
      if (!player) continue;
      const over = outcomes.find(o=>outcomeSide(o)==='OVER'), under = outcomes.find(o=>outcomeSide(o)==='UNDER');
      const line = point(over,market) ?? point(under,market);
      const contract = marketContract({ sport, market: marketName });
      if (!contract || contract.entityType !== 'player' || line === null) continue;
      out.push({ sourceId:text(market.id||`${event.id}:${player}:${marketName}`),book:'bovada',nativePlayerId:text(market.playerId||market.player?.id||player),playerName:player,sport,market:marketName,line,
        team:text(market.team||market.player?.team),opponent:'',nativeEventId:text(event.id),homeTeam:text(home?.abbreviation||home?.name),awayTeam:text(away?.abbreviation||away?.name),gameStartTime:start,updatedAt:iso(event.updatedAt)||new Date().toISOString(),headshot:'',position:'',sides:['OVER','UNDER'],overOdds:american(over),underOdds:american(under),contract,isAlternate:false,promotion:null });
    }
  }
  return out;
}
