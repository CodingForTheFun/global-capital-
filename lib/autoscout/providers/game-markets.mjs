// Featured game odds use the existing paid provider through its shared quota ledger.
// There is no wager settlement or customer wallet in this module.
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
const MARKETS = new Set(['h2h','spreads','totals']);
const num = x => x == null || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null;
export function normalizeGameMarkets(data, sport, fetchedAt = new Date().toISOString()) {
  if (!Array.isArray(data)) throw Object.assign(new Error('Invalid game feed'), { code: 'INVALID_GAME_FEED' });
  return data.filter(e => typeof e?.id === 'string' && e.home_team && e.away_team && Number.isFinite(Date.parse(e.commence_time))).map(event => ({
    id: event.id, sport, homeTeam: event.home_team, awayTeam: event.away_team, startTime: event.commence_time,
    // Time alone cannot distinguish delayed, in-progress and completed games.
    status: Date.parse(event.commence_time) > Date.now() ? 'SCHEDULED' : 'STARTED_UNCONFIRMED',
    books: (event.bookmakers || []).filter(b => b.key && b.title).map(book => ({
      sportsbookKey: book.key, name: book.title,
      markets: (book.markets || []).filter(m => MARKETS.has(m.key)).map(market => ({
        marketKey: market.key, updatedAt: market.last_update || book.last_update || null,
        outcomes: (market.outcomes || []).filter(o => {
          const price = num(o.price), point = num(o.point);
          return typeof o.name === 'string' && price !== null && Math.abs(price) >= 100 &&
            (market.key === 'totals' ? ['Over','Under'].includes(o.name) && point !== null :
             [event.home_team,event.away_team,...(market.key === 'h2h' ? ['Draw'] : [])].includes(o.name) && (market.key === 'h2h' || point !== null));
        }).map(o => ({ name: o.name, price: num(o.price), point: num(o.point) })),
      })).filter(m => m.outcomes.length),
    })).filter(b => b.markets.length), fetchedAt,
  })).filter(e => e.books.length);
}
export function createGameBoard({ request, scope, sportKey, remaining = () => null, directory = process.env.DATA_DIR || './data' }) {
  const cache = new Map(), inflight = new Map();
  let budgetQueue = Promise.resolve();
  async function reserve(cost) {
    const pending = budgetQueue.then(async () => {
      const file = path.join(directory,'sportsbook-credit-budget.json');
      const day = new Date().toISOString().slice(0,10);
      let ledger; try { ledger = JSON.parse(await readFile(file,'utf8')); } catch(e) { if(e.code !== 'ENOENT') throw e; }
      if (ledger?.day !== day) ledger = { day, credits: 0 };
      const configured = Number(process.env.SPORTSBOOK_DAILY_CREDITS || 120);
      const cap = Number.isFinite(configured) ? Math.max(1,Math.min(configured,1000)) : 120;
      if (!Number.isFinite(ledger.credits) || ledger.credits + cost > cap || (remaining() !== null && remaining() < cost)) throw Object.assign(new Error('Game market budget reached'), { code: 'GAME_BUDGET_LIMIT' });
      ledger.credits += cost;
      await mkdir(directory,{recursive:true}); await writeFile(file+'.tmp',JSON.stringify(ledger),{mode:0o600}); await rename(file+'.tmp',file);
    });
    budgetQueue = pending.catch(()=>{}); return pending;
  }
  return async function gameBoard(sport) {
    const key = sportKey(sport); if (!key) throw Object.assign(new Error('Unsupported sport'),{code:'UNSUPPORTED_SPORT'});
    const selection = scope(), cacheKey = JSON.stringify([sport, selection.params]);
    const cached = cache.get(cacheKey);
    if (cached?.expires > Date.now()) return { ...cached.value, cached: true };
    if (inflight.has(cacheKey)) return inflight.get(cacheKey);
    const pending = (async()=>{
      try {
        await reserve(3*selection.billedRegions);
        const raw = await request(`/sports/${key}/odds`,{...selection.params,markets:'h2h,spreads,totals',oddsFormat:'american',dateFormat:'iso'},{sport,signal:AbortSignal.timeout(20000)});
        const fetchedAt = new Date().toISOString();
        const value = {ok:true,available:true,sport,fetchedAt,games:normalizeGameMarkets(raw,sport,fetchedAt),
          coverage:{scope:selection.regions.length?'Requested regions':'Configured bookmakers',regions:selection.regions,complete:false,
            note:'All returned game odds are displayed. Availability varies by book and sport; this is not every market worldwide.'},cached:false,stale:false};
        cache.set(cacheKey,{expires:Date.now()+15*60000,value});
        while(cache.size>20)cache.delete(cache.keys().next().value);
        return value;
      } catch(e) {
        if(cached?.value?.available && cached.value.games.length)return {...cached.value,stale:true,warning:'Showing the previous game odds. Refresh was unavailable.'};
        const value={ok:true,available:false,sport,games:[],code:e.code||'GAME_FEED_UNAVAILABLE',message:e.code==='GAME_BUDGET_LIMIT'?'Game odds refresh is at capacity. Existing props and Auto Scout remain available.':'Game odds are temporarily unavailable. Try again later.'};
        cache.set(cacheKey,{expires:Date.now()+60000,value});
        return value;
      }
    })().finally(()=>inflight.delete(cacheKey));
    inflight.set(cacheKey,pending);return pending;
  };
}
