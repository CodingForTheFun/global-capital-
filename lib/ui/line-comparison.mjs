// Presentation of already-normalized offers. No provider calls or repricing.
const number = value => (typeof value === 'number' || typeof value === 'string') && String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const price = value => { const n = number(value); return n !== null && Math.abs(n) >= 100 ? n : null; };
const payout = american => american > 0 ? 1 + american/100 : 1 + 100/-american;
const keyOf = row => String(row.sportsbookKey || row.sportsbook || '').trim().toLowerCase();
const median = values => { const a = values.slice().sort((x,y)=>x-y); return a.length < 2 ? null : (a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2; };

export function compareResearchQuotes(group, {line, side = 'OVER', now = Date.now()} = {}) {
  const buckets = new Map(), omitted = [];
  const scoped = row => {
    if (!group.sport || !group.eventId || !(group.marketId || group.market)) return false;
    if (row.sport !== group.sport || row.eventId !== group.eventId || (row.marketId || row.market) !== (group.marketId || group.market)) return false;
    if (group.playerId ? row.playerId !== group.playerId : !group.playerName || row.playerName !== group.playerName || (group.team && row.team !== group.team)) return false;
    if ((row.entityType || 'player') !== (group.entityType || 'player')) return false;
    if ((row.period || 'game') !== (group.period || 'game')) return false;
    return !(typeof row.live === 'boolean' && typeof group.live === 'boolean' && row.live !== group.live);
  };
  for (const row of group.rows || []) {
    if (!scoped(row) || !['OVER','UNDER'].includes(row.side) || number(row.line) === null || !keyOf(row)) continue;
    if (['isAlternate','isPromotional','isBoosted','isDiscounted','isGoblin','isDemon','archived','completed'].some(k=>row[k] === true)) continue;
    const at = stamp(row.providerUpdatedAt || row.updatedAt);
    const key = JSON.stringify([keyOf(row),row.side]);
    const offer = {...row, bookKey:keyOf(row), line:number(row.line), price:price(row.price), at};
    if (!buckets.has(key)) buckets.set(key,[]);
    buckets.get(key).push(offer);
  }
  const offers = [];
  for (const [key, candidates] of buckets) {
    // A future timestamp cannot win; an undated conflicting record cannot
    // silently be assumed older than a dated record.
    if (candidates.some(q=>q.at !== null && q.at > now)) { omitted.push(key); continue; }
    const dated = candidates.filter(q=>q.at !== null);
    const latest = dated.length ? Math.max(...dated.map(q=>q.at)) : null;
    const current = candidates.filter(q=>q.at === null || q.at === latest);
    if (new Set(current.map(q=>JSON.stringify([q.line,q.price]))).size !== 1) { omitted.push(key); continue; }
    const q = current.find(q=>q.at === latest) || current[0];
    offers.push({...q, fresh:q.at !== null && now-q.at <= 30*60000 && q.stale !== true && group.archived !== true});
  }
  offers.sort((a,b)=>a.bookKey.localeCompare(b.bookKey)||a.line-b.line||a.side.localeCompare(b.side));
  const selected = number(line);
  const fresh = offers.filter(q=>q.fresh);
  const bestPrices = {};
  const bestLines = {};
  for (const direction of ['OVER','UNDER']) {
    const quotes = fresh.filter(q=>q.side === direction);
    const sameLine = quotes.filter(q=>q.line === selected && q.price !== null);
    const best = sameLine.length ? Math.max(...sameLine.map(q=>payout(q.price))) : null;
    // A highlight means comparison across at least two books, including ties.
    bestPrices[direction] = sameLine.length >= 2 ? sameLine.filter(q=>payout(q.price) === best) : [];
    bestLines[direction] = quotes.length ? (direction === 'OVER' ? Math.min(...quotes.map(q=>q.line)) : Math.max(...quotes.map(q=>q.line))) : null;
  }
  const rows = new Map();
  for (const q of offers) {
    const key = JSON.stringify([q.bookKey,q.line]);
    if (!rows.has(key)) rows.set(key,{bookKey:q.bookKey,name:q.sportsbook||q.sportsbookKey,line:q.line,OVER:null,UNDER:null});
    rows.get(key)[q.side] = q;
  }
  return {rows:[...rows.values()],offers,omitted,selectedLine:selected,side,
    bestPrices,bestLines,consensus:median(fresh.filter(q=>q.side === side).map(q=>q.line))};
}
