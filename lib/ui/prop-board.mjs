// Presentation only. Never combine another event's lines or game logs.
const LABELS = Object.freeze({
 player_points:'Points',player_rebounds:'Rebounds',player_offensive_rebounds:'Offensive rebounds',player_defensive_rebounds:'Defensive rebounds',player_assists:'Assists',player_threes:'3-pointers made',
 player_fg_made:'FG made',player_field_goals_made:'FG made',player_fg_attempted:'FG attempted',player_field_goals_attempted:'FG attempted',
 player_free_throws_made:'Free throws made',player_free_throws_attempted:'Free throws attempted',player_ft_made:'Free throws made',player_ft_attempted:'Free throws attempted',player_three_pointers_attempted:'3-pointers attempted',player_personal_fouls:'Personal fouls',
 player_blocks:'Blocks',player_steals:'Steals',player_turnovers:'Turnovers',
 player_points_rebounds_assists:'Points + Rebounds + Assists',player_points_rebounds:'Points + Rebounds',
 player_points_assists:'Points + Assists',player_rebounds_assists:'Rebounds + Assists',player_blocks_steals:'Blocks + Steals',
 player_pass_yds:'Passing yards',player_pass_tds:'Passing touchdowns',player_pass_attempts:'Passing attempts',
 player_pass_completions:'Passing completions',player_pass_interceptions:'Passing interceptions',
 player_pass_longest_completion:'Longest completion',player_pass_rush_yds:'Passing + Rushing yards',
 player_rush_yds:'Rushing yards',player_rush_attempts:'Rushing attempts',player_rush_tds:'Rushing touchdowns',
 player_rush_longest:'Longest rush',player_reception_yds:'Receiving yards',player_receptions:'Receptions',
 player_reception_tds:'Receiving touchdowns',player_reception_longest:'Longest reception',
 player_rush_reception_yds:'Rushing + Receiving yards',player_sacks:'Sacks',player_sacks_taken:'Sacks taken',
 player_solo_tackles:'Solo tackles',player_tackles_assists:'Tackles + Assists',player_defensive_interceptions:'Defensive interceptions',
 player_field_goals:'Field goals made',player_pats:'Extra points made',player_kicking_points:'Kicking points',
 team_sacks:'Team defensive sacks',team_sacks_allowed:'Team sacks allowed',team_points_allowed:'Team points allowed',
 batter_hits:'Hits',batter_total_bases:'Total bases',batter_home_runs:'Home runs',batter_runs_scored:'Runs',batter_runs:'Runs',
 batter_rbis:'RBIs',batter_hits_runs_rbis:'Hits + Runs + RBIs',batter_strikeouts:'Batter strikeouts',batter_walks:'Batter walks',batter_triples:'Triples',
 pitcher_strikeouts:'Pitcher strikeouts',pitcher_hits_allowed:'Hits allowed',pitcher_earned_runs:'Earned runs allowed',
 pitcher_outs:'Pitching outs',pitcher_outs_recorded:'Pitching outs',pitcher_walks:'Walks allowed',
 pitcher_innings_pitched:'Innings pitched',pitcher_pitches:'Pitches',pitcher_pitches_thrown:'Pitches',pitcher_batters_faced:'Batters faced',
 player_shots_on_goal:'Shots on goal',player_goals:'Goals',player_total_saves:'Saves',player_saves:'Saves',
 player_goals_against:'Goals against',player_blocked_shots:'Blocked shots',
 player_shots:'Shots',player_shots_on_target:'Shots on target',player_passes_attempted:'Passes attempted',player_passes_completed:'Passes completed',
 player_aces:'Aces',player_ace:'Aces',player_aces_allowed:'Aces allowed',player_double_faults:'Double faults',
 player_games:'Games',player_games_won:'Games won',player_games_lost:'Games lost',
 player_sets_won:'Sets won',player_sets_lost:'Sets lost',player_total_sets:'Total sets',
 player_break_points_won:'Break points won',player_break_points_served:'Break points served',player_break_points_saved:'Break points saved',player_break_points_given_up:'Break points given up',
 player_points_won:'Points won',player_total_points_won:'Points won',
 player_first_serve_points_won:'1st serve points won',player_second_serve_points_won:'2nd serve points won',
 player_first_serve_percentage:'1st serve %',player_second_serve_percentage:'2nd serve %',
 player_service_games_won:'Service games won',player_return_games_won:'Return games won',
 player_return_points_won:'Return points won',player_return_points_won_percentage:'Return points won %',
});
const firstTypes={NFL:'Passing yards',NCAAF:'Passing yards',NBA:'Points',WNBA:'Points',NCAAB:'Points',MLB:'Hits',NHL:'Shots on goal',TENNIS:'Games',MLS:'Shots',EPL:'Shots',UCL:'Shots'};
function norm(value){
 return String(value||'').normalize('NFKC').toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').trim();
}
function eventChoiceKey(group){
 const at=Date.parse(group.gameStartTime||'');
 // Across public feeds the same game can carry different provider event IDs.
 // A start-minute plus the semantic market is stable enough for presentation,
 // while missing-time rows fall back to the source event/matchup identity.
 const event=Number.isFinite(at)
  ? `t:${Math.floor(at/60000)}`
  : `e:${norm(group.eventId)}:${norm(group.awayTeam)}:${norm(group.homeTeam)}`;
 return [event,norm(propType(group))].join('|');
}
function normalizedMarketKey(value) {
 const raw=String(value||'').trim().toLowerCase();
 if(!raw)return '';
 const key=raw.split(':').pop()||raw;
 return key.replace(/^market[_:-]?/,'');
}
function escapeMarketPattern(value) {
 return String(value||'').replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&');
}
function labelFromMarketKey(key) {
 const bare=String(key||'').replace(/^(?:player|batter|pitcher|team)_/,'');
 if(!bare||!/^[a-z0-9_]+$/.test(bare))return '';
 const tokenLabels={yds:'Yards',tds:'Touchdowns',rbi:'RBI',rbis:'RBIs',fg:'FG',ft:'FT',qb:'QB',hr:'HR',hrs:'HRs',pra:'PRA'};
 return bare.split('_').filter(Boolean).map(function(token){
  if(tokenLabels[token])return tokenLabels[token];
  if(/^\d+(?:st|nd|rd|th)$/.test(token))return token;
  return token.charAt(0).toUpperCase()+token.slice(1);
 }).join(' ');
}
/**
 * Presentation-only market label. Provider identity, raw market text, line,
 * side and market id stay untouched; this removes player/side/line noise only
 * from what the customer sees.
 */
// Keep stat-category text consistent across the legacy board, drawer, and selectors.
export function cleanMarketLabel(value,{playerName='',marketId='',statId='',sport=''}={}) {
 const key=normalizedMarketKey(marketId||statId);
 if(['NFL','NCAAF'].includes(String(sport||'').toUpperCase())&&key==='player_assists')return 'Assisted tackles';
 if(LABELS[key])return LABELS[key];

 let label=String(value||'').trim();
 if(label&&playerName){
  const playerPattern=escapeMarketPattern(String(playerName).trim());
  if(playerPattern)label=label.replace(new RegExp(playerPattern,'ig'),' ');
 }
 label=label
  .replace(/^\s*(?:player|batter|pitcher)\s+/i,'')
  .replace(/\b(?:alternate|alt|main line|over|under|higher|lower)\b/gi,' ')
  .replace(/\b(?:full[- ]game|first half|1st half|second half|2nd half|1q|2q|3q|4q|1h|2h)\b/gi,' ')
  .replace(/\b(?:o|u)\s*[+-]?\d+(?:\.\d+)?\b/gi,' ')
  .replace(/\s+[+-]?\d+(?:\.\d+)?\s*$/,' ')
  .replace(/[|·:–—]+/g,' ')
  .replace(/\s+/g,' ')
  .trim();

 return label||labelFromMarketKey(key)||'Other props';
}
export function propType(group) {
 return cleanMarketLabel(group.market,{
  playerName:group.playerName,
  marketId:group.marketId,
  statId:group.statId,
  sport:group.sport,
 });
}
/**
 * Teams that actually appear for each name, so a card key can tell a namesake
 * from the same athlete.
 *
 * This has to be resolved across the whole row set: a row that arrives without
 * a team cannot know which team it belongs to, and keying it on the empty
 * string would split an athlete away from his own other rows. On a live board
 * that mistake cost 17 false splits and prevented none.
 */
export function teamIndex(groups=[]) {
 const index=new Map();
 for(const group of groups){
  const name=norm(group?.playerName);
  if(!name)continue;
  const team=norm(group?.team);
  if(!team)continue;
  const bucket=index.get(name)||new Set();
  bucket.add(team);
  index.set(name,bucket);
 }
 return index;
}
export function playerCardKey(group,index=null) {
 // Book/DFS feeds often assign different internal IDs to the same athlete, so
 // provider IDs cannot key a card: on a live board 32% of names carried more
 // than one ID, every one of them a single athlete quoted by several books.
 // Grouping on the name alone fixes that but merges genuine namesakes — two
 // athletes called Josh Allen would share one card, mixing a quarterback's
 // passing props with a linebacker's tackles.
 //
 // So the name groups by default, and the team is added to the key only for a
 // name that genuinely appears with more than one team. That splits the
 // namesakes and leaves every single-team athlete collapsed exactly as before,
 // including his rows that carry no team at all.
 //
 // A name seen with two teams but a row missing its own team stays on the
 // name-only key: which of the two he is cannot be known, and guessing would
 // attach a stranger's props to a card.
 const name=norm(group.playerName);
 const sport=String(group.sport||'').toUpperCase();
 const entity=group.entityType||'player';
 if(name){
  const team=norm(group.team);
  const contested=index instanceof Map&&(index.get(name)?.size||0)>1;
  return [sport,entity,'name:'+name,contested&&team?'team:'+team:''].join('|');
 }
 return [sport,entity,'id:'+String(group.playerId||group.providerPlayerId||'unknown')].join('|');
}
export function categoryOptions(groups,sport) {
 const map=new Map();
 const index=teamIndex(groups);
 for(const g of groups){const label=propType(g);if(!map.has(label))map.set(label,new Set());map.get(label).add(playerCardKey(g,index));}
 return [...map].map(([label,players])=>({label,count:players.size})).sort((a,b)=>a.label===firstTypes[sport]?-1:b.label===firstTypes[sport]?1:a.label.localeCompare(b.label));
}
export function uniquePlayerCards(groups,selected=new Map()) {
 const byPlayer=new Map();
 const index=teamIndex(groups);
 for(const group of groups){const id=playerCardKey(group,index);if(!byPlayer.has(id))byPlayer.set(id,[]);byPlayer.get(id).push(group);}
 return [...byPlayer].map(([id,rawChoices])=>{
  // Collapse the same semantic prop/game coming from different providers into
  // one selector choice and combine its sportsbook offers. This removes exact
  // duplicate props without merging different games or different stat markets.
  const choiceMap=new Map();
  for(const group of rawChoices){
   const key=eventChoiceKey(group);
   const prior=choiceMap.get(key);
   if(!prior){
    choiceMap.set(key,{...group,rows:dedupeOffers(group.rows||[]),comparisonOffers:dedupeOffers(group.comparisonOffers||group.rows||[]),sourceChoiceKeys:[group.key]});
    continue;
   }
   prior.rows=dedupeOffers([...(prior.rows||[]),...(group.rows||[])]);
   prior.comparisonOffers=dedupeOffers([...(prior.comparisonOffers||[]),...(group.comparisonOffers||group.rows||[])]);
   prior.sourceChoiceKeys.push(group.key);
   for(const field of ['team','position','homeTeam','awayTeam','gameStartTime','providerPlayerId'])if(!prior[field]&&group[field])prior[field]=group[field];
  }
  const choices=[...choiceMap.values()];
  const wanted=selected.get(id);
  const preferred=choices.find(g=>g.key===wanted||g.sourceChoiceKeys?.includes(wanted))||choices[0];
  return {...preferred,playerChoices:choices};
 });
}
export function dedupeOffers(rows) {
 const seen=new Map();
 for(const row of rows){
  const key=[row.sportsbookKey||row.sportsbook,row.side,row.line].join('|');
  const prior=seen.get(key),time=v=>Date.parse(v.providerUpdatedAt||v.updatedAt||v.ingestedAt)||0;
  if(!prior||time(row)>time(prior))seen.set(key,row);
 }
 return [...seen.values()];
}
