// Presentation only. Never combine another event's lines or game logs.
const LABELS = Object.freeze({
 player_points:'Points',player_rebounds:'Rebounds',player_assists:'Assists',player_threes:'3-pointers made',
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
 batter_rbis:'RBIs',batter_hits_runs_rbis:'Hits + Runs + RBIs',batter_strikeouts:'Batter strikeouts',batter_walks:'Batter walks',
 pitcher_strikeouts:'Pitcher strikeouts',pitcher_hits_allowed:'Hits allowed',pitcher_earned_runs:'Earned runs allowed',
 pitcher_outs:'Pitching outs',pitcher_outs_recorded:'Pitching outs',pitcher_walks:'Walks allowed',
 player_shots_on_goal:'Shots on goal',player_goals:'Goals',player_total_saves:'Saves',player_saves:'Saves',
 player_goals_against:'Goals against',player_blocked_shots:'Blocked shots',
 player_shots:'Shots',player_shots_on_target:'Shots on target',player_passes_attempted:'Passes attempted',player_passes_completed:'Passes completed',
});
const firstTypes={NFL:'Passing yards',NCAAF:'Passing yards',NBA:'Points',WNBA:'Points',NCAAB:'Points',MLB:'Hits',NHL:'Shots on goal',MLS:'Shots',EPL:'Shots',UCL:'Shots'};
export function propType(group) {
 const key=group.marketId||group.statId||'';
 if(['NFL','NCAAF'].includes(group.sport)&&key==='player_assists')return 'Assisted tackles';
 return LABELS[key]||String(group.market||key||'Other props');
}
export function playerCardKey(group) {
 // Provider IDs disambiguate namesakes. A name-only row is not silently merged
 // into an ID-backed namesake; ambiguous identity remains a research error.
 return [group.sport,group.entityType||'player',group.playerId||('name:'+String(group.playerName).normalize('NFKC').toLowerCase().trim()),group.playerId?'':group.team||''].join('|');
}
export function categoryOptions(groups,sport) {
 const map=new Map();
 for(const g of groups){const label=propType(g);if(!map.has(label))map.set(label,new Set());map.get(label).add(playerCardKey(g));}
 return [...map].map(([label,players])=>({label,count:players.size})).sort((a,b)=>a.label===firstTypes[sport]?-1:b.label===firstTypes[sport]?1:a.label.localeCompare(b.label));
}
export function uniquePlayerCards(groups,selected=new Map()) {
 const byPlayer=new Map();
 for(const group of groups){const id=playerCardKey(group);if(!byPlayer.has(id))byPlayer.set(id,[]);byPlayer.get(id).push(group);}
 return [...byPlayer].map(([id,choices])=>{
  const preferred=choices.find(g=>g.key===selected.get(id))||choices[0];
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
