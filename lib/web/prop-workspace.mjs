// Provider-native identities and explicit stat mappings. No network or credentials.
// Reference: https://prop-line.com/docs (2026-09-18).
export const text = v => typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
export const number = v => v == null || typeof v === 'boolean' || text(v) === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const rows = v => Array.isArray(v) ? v : [];
const nameKey = v => text(v).normalize('NFKC').toLocaleLowerCase('en-US');
const date = v => Number.isFinite(Date.parse(text(v))) ? new Date(v).toISOString() : null;
const key = parts => JSON.stringify(parts);
const GAME_MARKETS = new Set(['h2h','spreads','totals','draw_no_bet','double_chance','btts','correct_score']);
export const sportCode = sport => ({football_nfl:'NFL',football_ncaaf:'NCAAF',basketball_nba:'NBA',basketball_wnba:'WNBA',basketball_ncaab:'NCAAB',baseball_mlb:'MLB',hockey_nhl:'NHL',tennis:'TENNIS',golf:'PGA',mma_ufc:'MMA'})[sport] || (sport.startsWith('soccer_') ? 'SOCCER' : sport.toUpperCase());
export function normalizeCatalog(value) {
  const seen = new Set();
  return rows(Array.isArray(value) ? value : value?.sports).flatMap(row => {
    const id = text(row?.key ?? row?.sport_key);
    if (!/^[a-z0-9_]{1,90}$/.test(id) || seen.has(id)) return [];
    seen.add(id); return [{key:id,title:text(row.title) || id.replaceAll('_',' '),active:row.active !== false}];
  }).sort((a,b) => a.title.localeCompare(b.title));
}
export function normalizeEvents(value, sport) {
  const seen = new Set();
  return rows(Array.isArray(value) ? value : value?.events).flatMap(row => {
    const id = text(row?.id ?? row?.event_id);
    if (!id || seen.has(id) || (row.sport_key && row.sport_key !== sport)) return [];
    seen.add(id); return [{id,sport,startsAt:date(row.commence_time),homeTeam:text(row.home_team)||null,awayTeam:text(row.away_team)||null,status:text(row.status)||null,aliases:rows(row.merged_from_event_ids).map(text)}];
  }).sort((a,b) => (Date.parse(a.startsAt)||Infinity)-(Date.parse(b.startsAt)||Infinity) || a.id.localeCompare(b.id));
}
const LABELS = {player_pass_yds:'Passing yards',player_rush_yds:'Rushing yards',player_reception_yds:'Receiving yards',player_receptions:'Receptions',pitcher_strikeouts:'Pitcher strikeouts',batter_hits_runs_rbis:'Hits + runs + RBIs',player_points_rebounds_assists:'Points + rebounds + assists'};
export function marketLabel(market, period, variant) {
  const label = LABELS[market] || market.replace(/^(player_|batter_)/,'').replaceAll('_',' ');
  return [label.charAt(0).toUpperCase()+label.slice(1), period && `Period ${period}`,variant && variant !== 'standard' && variant].filter(Boolean).join(' · ');
}
function latestQuote(previous, next) {
  if (!previous) return next;
  const a = Date.parse(previous.updatedAt), b = Date.parse(next.updatedAt);
  if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return b > a ? next : previous;
  if (previous.price === next.price && previous.multiplier === next.multiplier) return previous;
  return {...previous,price:null,multiplier:null,conflict:true};
}
export function normalizeOffers(payloads, event) {
  const people = new Map();
  let suspended = 0, ignored = 0;
  for (const payload of rows(Array.isArray(payloads) ? payloads : [payloads])) {
    const eventId = text(payload?.id) || event.id;
    if (payload?.sport_key && payload.sport_key !== event.sport) continue;
    for (const book of rows(payload?.bookmakers)) for (const market of rows(book?.markets)) {
      if (market.suspended_at) { suspended++; continue; }
      const marketKey = text(market.key), period = text(market.period) || null;
      if (!marketKey || GAME_MARKETS.has(marketKey) || market.team) { ignored++; continue; }
      for (const outcome of rows(market.outcomes)) {
        const id = text(outcome.player_id) || null;
        const name = text(outcome.description ?? outcome.player_name);
        const bookKey = text(book.key);
        if (!name || !bookKey || !text(outcome.name)) { ignored++; continue; }
        const playerKey = key([event.sport,eventId,id ? ['id',id] : ['name',nameKey(name)]]);
        let player = people.get(playerKey);
        if (!player) {
          player = {key:playerKey,playerId:id,name,position:text(outcome.player_position)||null,aliases:[name],sport:event.sport,eventId,startsAt:date(payload.commence_time)||event.startsAt,homeTeam:text(payload.home_team)||event.homeTeam,awayTeam:text(payload.away_team)||event.awayTeam,markets:new Map()};
          people.set(playerKey,player);
        } else if (!player.aliases.includes(name)) player.aliases.push(name);
        const multiplier = number(outcome.payout_multiplier);
        const flavor = text(outcome.dfs_odds_type).toLowerCase() || (bookKey === 'underdog' && multiplier !== null && multiplier > 0 && multiplier !== 1 ? multiplier > 1 ? 'boost' : 'discount' : 'standard');
        const variant = multiplier !== null && multiplier > 0 && multiplier !== 1 ? `${flavor}:${multiplier}` : flavor;
        const marketId = key([marketKey,period,variant]);
        if (!player.markets.has(marketId)) player.markets.set(marketId,{key:marketId,marketKey,period,variant,label:marketLabel(marketKey,period,flavor),offers:new Map()});
        const category = player.markets.get(marketId);
        const line = number(outcome.point), choice = text(outcome.name);
        const side = /^(over|under)$/i.test(choice) ? choice.toUpperCase() : null;
        const offerKey = key([bookKey,line,choice]);
        const price = number(outcome.price ?? outcome.price_american);
        const offer = {key:offerKey,outcomeId:text(outcome.outcome_id)||null,book:bookKey,bookName:text(book.title)||bookKey,line,choice,side,price:price === 0 ? null : price,multiplier:number(outcome.payout_multiplier),updatedAt:date(outcome.last_seen_at||outcome.last_change_at||market.last_update||book.last_update),dfs:['prizepicks','underdog','sleeper','dabble'].includes(bookKey),conflict:false,dfsOddsType:flavor,lineGap:number(outcome.line_gap),liquidity:number(outcome.liquidity),liquidityUpdatedAt:date(outcome.last_seen_at||market.last_update),lastChangeAt:date(outcome.last_change_at),bookOutcomeId:text(outcome.book_outcome_id)||null};
        category.offers.set(offerKey,latestQuote(category.offers.get(offerKey),offer));
      }
    }
  }
  return {players:[...people.values()].map(player => ({...player,markets:[...player.markets.values()].map(m => ({...m,offers:[...m.offers.values()].sort((a,b)=>a.bookName.localeCompare(b.bookName)||(a.line??Infinity)-(b.line??Infinity)||a.choice.localeCompare(b.choice))})).sort((a,b)=>Number(a.variant!=='standard')-Number(b.variant!=='standard')||a.label.localeCompare(b.label))})).sort((a,b)=>a.name.localeCompare(b.name)),suspendedMarkets:suspended,ignoredNonPlayerMarkets:ignored};
}
const FOOTBALL = {player_pass_yds:'passing_yards',player_pass_tds:'passing_tds',player_pass_attempts:'passing_attempts',player_pass_completions:'passing_completions',player_pass_interceptions:'interceptions',player_longest_completion:'longest_completion',player_rush_yds:'rushing_yards',player_rush_tds:'rushing_tds',player_rush_attempts:'rushing_attempts',player_rush_longest:'longest_rush',player_reception_yds:'receiving_yards',player_reception_tds:'receiving_tds',player_receptions:'receptions',player_reception_longest:'longest_reception',player_pass_rush_yds:'pass_rush_yds',player_rush_reception_yds:'rush_reception_yds',player_sacks:'sacks',player_fumbles_lost:'fumbles_lost',player_field_goals_made:'field_goals_made',player_extra_points_made:'extra_points_made',player_kicking_points:'kicking_points'};
const MLB = {pitcher_strikeouts:'strikeouts',pitcher_earned_runs:'earned_runs',pitcher_hits_allowed:'hits_allowed',pitcher_outs:'outs',batter_strikeouts:'batter_strikeouts',...Object.fromEntries(['hits','total_bases','singles','doubles','triples','home_runs','runs','rbis','walks','stolen_bases','hits_runs_rbis'].map(k=>['batter_'+k,k]))};
const BASKETBALL = { ...Object.fromEntries(['points','rebounds','assists','threes','steals','blocks','turnovers','points_rebounds','points_assists','rebounds_assists','points_rebounds_assists'].map(k=>['player_'+k,k])), player_offensive_rebounds:'offensive_rebounds', player_defensive_rebounds:'defensive_rebounds', player_blocked_shots:'blocks' };
const NHL = {player_goals:'goals',player_points:'points_nhl',player_shots_on_goal:'shots_on_goal',player_blocked_shots:'blocked_shots',player_power_play_points:'power_play_points',player_saves:'saves',player_total_saves:'saves',goalie_saves:'saves'};
const TENNIS = {player_aces:'aces',player_double_faults:'dblfaults',player_games:'total_games',player_games_won:'games_w',player_break_points_won:'breakpts_w',player_total_games:'total_games',tennis_total_games:'total_games',match_total_games:'total_games',player_sets_won:'sets_won'};
const SOCCER = Object.fromEntries(['goals','assists','shots','shots_on_target','yellow_cards','red_cards','cards','fouls_committed','fouls_suffered','offsides','saves','shots_faced','goals_conceded','own_goals'].map(k=>['player_'+k,k]));
const GOLF = Object.fromEntries(['strokes','score','total_score','birdies','eagles','pars','bogeys_ow','holes','rank'].map(k=>['player_'+k,k]));
const MMA = {player_significant_strikes:'significant_strikes',player_takedowns:'takedowns'};
function statFor(sport, market) {
  const map = sport.startsWith('football_') ? FOOTBALL : sport==='baseball_mlb' ? MLB : sport.startsWith('basketball_') ? BASKETBALL : sport==='hockey_nhl' ? NHL : sport==='tennis' ? TENNIS : sport.startsWith('soccer_') ? SOCCER : sport==='golf' ? GOLF : sport==='mma_ufc' ? MMA : {};
  return map[market] || market;
}
const LOG_STATS = {points:'points',rebounds:'rebounds',assists:'assists',threes:'threes',steals:'steals',blocks:'blocks',turnovers:'turnovers',passingYards:'passing_yards',passingTouchdowns:'passing_tds',rushingYards:'rushing_yards',receivingYards:'receiving_yards',receptions:'receptions',hits:'hits',runs:'runs',totalBases:'total_bases',strikeouts:'strikeouts',homeRuns:'home_runs',shotsOnGoal:'shots_on_goal',goals:'goals',saves:'saves',aces:'aces',doubleFaults:'dblfaults',gamesWon:'games_w',setsWon:'sets_won',breakPointsWon:'breakpts_w',pitchingOuts:'outs',shots:'shots',shotsOnTarget:'shots_on_target',fouls:'fouls_committed',sixes:'sixes',fours:'fours',wickets:'wickets',kills:'kills',deaths:'deaths',mapsWon:'maps_won'};
export function historyForMarket(payload, player, market, {now = Date.now()} = {}) {
  const unavailable = (code,message) => ({available:false,code,message,gameLog:[],source:'PropLine raw box scores'});
  const aliases = rows(player.aliases).map(nameKey);
  if (!payload || payload.redacted === true || !aliases.includes(nameKey(payload.player_name))) return unavailable('IDENTITY_UNVERIFIED','The historical player identity could not be verified.');
  if ((payload.sport_key && payload.sport_key!==player.sport) || (payload.player_id && player.playerId && text(payload.player_id)!==text(player.playerId))) return unavailable('IDENTITY_UNVERIFIED','The historical sport or player identifier does not match this selection.');
  if (market.period || /fantasy/i.test(market.marketKey)) return unavailable('EXACT_HISTORY_UNAVAILABLE','This market requires an exact period or source-specific scoring history. Full-game totals are not substituted.');
  const stat = statFor(player.sport,market.marketKey), games = new Map(), conflicts = new Set();
  // An upcoming event must not make future/incorrectly-finalized rows eligible.
  const clock = Number.isFinite(now) ? now : Date.now();
  const cutoff = Math.min(clock, Number.isFinite(Date.parse(player.startsAt)) ? Date.parse(player.startsAt) : clock);
  for (const row of rows(payload.games).slice(0,100)) {
    const when = date(row.commence_time), value = number(row.stats?.[stat]), id=text(row.event_id);
    if (row.status!=='final' || !when || !id || id===player.eventId || value===null || Date.parse(when)>=cutoff || row.redacted===true) continue;
    if (row.player_name && !aliases.includes(nameKey(row.player_name))) continue;
    if (row.player_id && player.playerId && text(row.player_id)!==text(player.playerId)) continue;
    if (row.did_not_play===true || row.dnp===true || row.played===false || row.walkover===true || row.retired===true) continue;
    if (player.sport.startsWith('basketball_') && number(row.stats?.minutes)===0) continue;
    const stats=Object.fromEntries(Object.entries(LOG_STATS).flatMap(([label,key])=>number(row.stats?.[key])===null?[]:[[label,number(row.stats[key])]]));
    const item={...stats,gameResult:['W','L','D','T'].includes(row.result)?row.result:null,scoreFor:number(row.score_for),scoreAgainst:number(row.score_against),seasonType:number(row.season_type),gameId:id,date:when,value,opponent:text(row.opponent)||null,isHome:typeof row.is_home==='boolean'?row.is_home:null,season:row.season??null,minutes:number(row.stats?.minutes)};
    if (games.has(id) && (games.get(id).value!==value || games.get(id).date!==when)) conflicts.add(id); else games.set(id,item);
  }
  for (const id of conflicts) games.delete(id);
  const gameLog=[...games.values()].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
  return gameLog.length ? {available:true,gameLog,season:payload.season??null,player:{playerName:player.name,position:text(payload.player_position)||player.position||null},matchup:{opponent:text(payload.next_opponent)||null},source:'PropLine raw box scores',sourceStat:stat,coverage:{returnedGames:gameLog.length,completeSeason:false,excludedConflicts:conflicts.size}} : unavailable('NO_VERIFIED_STAT_HISTORY','No completed games with this exact statistic are available.');
}
