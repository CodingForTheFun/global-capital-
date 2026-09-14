// Pure, league-scoped stat semantics. Source keys are not interchangeable:
// a passing-log sack is a sack taken; a defensive-log sack is a sack made.
import { fieldsFor, marketFromProviderKey, marketKey } from '../sportsdataio/markets.mjs';

export const PUBLIC_LEAGUES = Object.freeze({
  NFL:['football','nfl'], NCAAF:['football','college-football'],
  NBA:['basketball','nba'], WNBA:['basketball','wnba'], NCAAB:['basketball','mens-college-basketball'],
  MLB:['baseball','mlb'], NHL:['hockey','nhl'],
  MLS:['soccer','usa.1'], EPL:['soccer','eng.1'], UCL:['soccer','uefa.champions'],
  // The feeds post most club football under a bare "SOCCER" tag with no
  // competition and no opponent, so La Liga, Serie A, Liga MX and the
  // Championship all arrive here. A null league is what that means: ESPN's
  // soccer game log ignores the league in its URL path and answers with the
  // athlete's own competition, so one league-agnostic lookup reaches all of
  // them. Everything that does need a real league slug checks for one.
  SOCCER:['soccer',null],
});
/** Sports whose props name no competition, so no league slug can be built. */
export const LEAGUE_AGNOSTIC = Object.freeze(new Set(['SOCCER']));
// ESPN rejects an empty path segment but ignores whichever one it is given for
// soccer, so a generic lookup needs a placeholder only to stay well-formed.
export const ANY_LEAGUE_PATH = 'all';
export const canonicalSport = value => {
  const raw=String(value||'').trim().toUpperCase();
  if(raw==='ATP'||raw==='WTA'||raw==='TENNIS'||/^(?:ATP|WTA)(?:\b|_)/.test(raw)||raw.includes('TENNIS'))return 'TENNIS';
  return ({CFB:'NCAAF',CBB:'NCAAB',NCAAM:'NCAAB',PREMIER_LEAGUE:'EPL',CHAMPIONS_LEAGUE:'UCL'}[raw] || raw);
};
export const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value
  : typeof value === 'string' && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim()) ? Number(value) : null;
export function inningsToOuts(value) {
  const match = String(value ?? '').trim().match(/^(\d+)(?:\.([012]))?$/);
  return match ? Number(match[1])*3 + Number(match[2] || 0) : null;
}
const aliases = {
  PassingLongestCompletion:['longPassing','longestPassCompletion'], RushingLongest:['longRushing','longestRush'], ReceivingLongest:['longReception','longReceiving','longestReception'], DefensiveInterceptions:['defensiveInterceptions'],
  PassingAttempts:['passingAttempts','passAttempts','passing_attempts'],
  PassingCompletions:['completions','passingCompletions','passCompletions','passing_completions'],
  PassingYards:['passingYards','passYards','passing_yds'], PassingTouchdowns:['passingTouchdowns','passTDs','passing_tds'],
  PassingInterceptions:['interceptions','passingInterceptions'],
  RushingAttempts:['rushingAttempts','rushAttempts','rushing_attempts'], RushingYards:['rushingYards','rushYards','rushing_yds'],
  RushingTouchdowns:['rushingTouchdowns','rushTDs'], Receptions:['receptions'],
  ReceivingYards:['receivingYards','recYards','receiving_yds'], ReceivingTargets:['receivingTargets','targets'],
  ReceivingTouchdowns:['receivingTouchdowns','recTDs'],
  Punts:['punts'], PuntsInside20:['puntsInside20','inside20'],
  Points:['points','pts'], Rebounds:['totalRebounds','rebounds','reb'], Assists:['assists','ast'],
  Steals:['steals','stl'], BlockedShots:['blocks','blockedShots','blk'], Turnovers:['turnovers','tov'],
  ThreePointersMade:['threePointFieldGoalsMade','threePointersMade','threes'],
  SoloTackles:['soloTackles','tackles'], AssistedTackles:['assistTackles','assistedTackles'],
  TotalTackles:['totalTackles','tacklesCombined'], Sacks:['sacks'], SacksTaken:['sacksTaken','timesSacked','sacks_allowed'],
  FieldGoalsMade:['fieldGoalsMade'], ExtraPointsMade:['extraPointsMade'], KickingPoints:['totalKickingPoints','kickingPoints'],
  Hits:['hits'], Runs:['runs'], RunsBattedIn:['RBIs','runsBattedIn','rbi'], Strikeouts:['strikeouts','SO'],
  Doubles:['doubles'], Triples:['triples'], HomeRuns:['homeRuns'], StolenBases:['stolenBases'], Walks:['walks'],
  EarnedRuns:['earnedRuns','earned_runs'], HitsAllowed:['hitsAllowed'], WalksAllowed:['walksAllowed'],
  TotalBases:['totalBases'], Singles:['singles'], PitchingOuts:['outs','pitchingOuts'],
  PitchesThrown:['pitches','pitchesThrown','pitchCount','numberOfPitches'], BattersFaced:['battersFaced','batters_faced'],
  Goals:['goals'], ShotsOnGoal:['shotsTotal','shotsOnGoal','sog'], Saves:['saves'], GoalsAgainst:['goalsAgainst'],
  PowerPlayPoints:['powerPlayPoints'],
  SoccerGoals:['totalGoals','goals'], SoccerAssists:['goalAssists','assists'], Shots:['totalShots','shots'],
  ShotsOnTarget:['shotsOnTarget'], Fouls:['foulsCommitted'], GoalsConceded:['goalsConceded'],
  Aces:['aces'], AcesAllowed:['acesAllowed','opponentAces','aces_allowed'],
  DoubleFaults:['doubleFaults','double_faults'], GamesWon:['gamesWon','games_won'], GamesLost:['gamesLost','games_lost'],
  SetsWon:['setsWon','sets_won'], SetsLost:['setsLost','sets_lost'],
  BreakPointsWon:['breakPointsWon','breakPointsConverted','break_points_won'],
  BreakPointsServed:['breakPointsServed','break_points_served'], BreakPointsSaved:['breakPointsSaved','break_points_saved'],
  BreakPointsGivenUp:['breakPointsGivenUp','breakPointsFaced','break_points_given_up'],
  PointsWon:['pointsWon','totalPointsWon','points_won'],
  FirstServePointsWon:['firstServePointsWon','first_serve_points_won'], SecondServePointsWon:['secondServePointsWon','second_serve_points_won'],
  FirstServePct:['firstServePct','firstServePercentage','first_serve_percentage'], SecondServePct:['secondServePct','secondServePercentage','second_serve_percentage'],
  ServiceGamesWon:['serviceGamesWon','service_games_won'], ReturnGamesWon:['returnGamesWon','return_games_won'],
  ReturnPointsWon:['returnPointsWon','receivingPointsWon','return_points_won'], ReturnPointsWonPct:['returnPointsWonPct','receivingPointsWonPct','return_points_won_percentage'],
};
const extra = {
  NFL:{player_pass_longest_completion:['PassingLongestCompletion'],player_rush_longest:['RushingLongest'],player_reception_longest:['ReceivingLongest'],player_defensive_interceptions:['DefensiveInterceptions'],player_sacks:['Sacks'],player_sacks_taken:['SacksTaken'],player_solo_tackles:['SoloTackles'],
    player_assists:['AssistedTackles'],player_tackles_assists:['TotalTackles'],player_field_goals:['FieldGoalsMade'],
    player_pats:['ExtraPointsMade'],player_kicking_points:['KickingPoints'],
    team_sacks:['TeamDefensiveSacks'],team_defensive_sacks:['TeamDefensiveSacks'],
    team_sacks_allowed:['TeamSacksAllowed'],team_points_allowed:['TeamPointsAllowed'],points_allowed:['TeamPointsAllowed'],
    pass_yds:['PassingYards'],pass_tds:['PassingTouchdowns'],pass_attempts:['PassingAttempts'],pass_completions:['PassingCompletions'],
    rush_yds:['RushingYards'],rush_attempts:['RushingAttempts'],rec_yds:['ReceivingYards'],receptions:['Receptions'],
    player_pass_rush_yds:['PassingYards','RushingYards']},
  MLB:{batter_runs_scored:['Runs'],batter_strikeouts:['Strikeouts'],batter_triples:['Triples'],
    pitcher_hits_allowed:['HitsAllowed'],pitcher_walks:['WalksAllowed'],pitcher_outs:['PitchingOuts'],
    pitcher_innings_pitched:['InningsPitched'],pitcher_pitches:['PitchesThrown'],pitcher_pitches_thrown:['PitchesThrown'],pitcher_batters_faced:['BattersFaced']},
  NHL:{player_blocked_shots:['BlockedShots'],player_goals_against:['GoalsAgainst']},
};
const footballLabels = {sacks:['Sacks'],'sacks taken':['SacksTaken'],'times sacked':['SacksTaken'],
  'tackles+assists':['TotalTackles'],'tackles+ast':['TotalTackles'],'tackles + assists':['TotalTackles'],'solo tackles':['SoloTackles'],
  'field goals':['FieldGoalsMade'],'field goals made':['FieldGoalsMade'],'fg made':['FieldGoalsMade'],'kicking points':['KickingPoints'],
  'extra points made':['ExtraPointsMade'],'team sacks':['TeamDefensiveSacks'],'defensive sacks':['Sacks'],
  'team defensive sacks':['TeamDefensiveSacks'],'team sacks allowed':['TeamSacksAllowed'],'points allowed':['TeamPointsAllowed']};
// Every soccer game log ESPN serves carries the same nine columns, whichever
// competition it is for: goals, assists, shots, shots on target, fouls for and
// against, offsides and cards for an outfielder, and clean sheets, saves and
// goals conceded for a keeper. Passes, tackles, clearances, dribbles and
// crosses are not among them at any league, so a market asking for one cannot
// be answered from this source and is refused here rather than after three
// round trips that were always going to come back empty.
const soccer = {player_shots:['Shots'],player_shots_on_target:['ShotsOnTarget'],player_goals:['SoccerGoals'],
  player_assists:['SoccerAssists'],player_goalie_saves:['Saves'],player_fouls:['Fouls'],
  player_fouls_committed:['Fouls'],player_goals_conceded:['GoalsConceded'],player_goals_against:['GoalsConceded']};
const soccerLabels = {shots:['Shots'],'shots on target':['ShotsOnTarget'],sot:['ShotsOnTarget'],goals:['SoccerGoals'],
  assists:['SoccerAssists'],'goalie saves':['Saves'],saves:['Saves'],fouls:['Fouls'],'fouls committed':['Fouls'],
  'goals conceded':['GoalsConceded'],'goals against':['GoalsConceded']};
function fallbackProviderKey(value){
  const slug=String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,72);
  return slug?`player_${slug}`:'';
}
export function marketContract({sport,market,providerMarketKey} = {}) {
  sport=canonicalSport(sport);const family=PUBLIC_LEAGUES[sport]?.[0];
  const key=String(providerMarketKey||'').toLowerCase(), label=marketKey(market), fallbackKey=fallbackProviderKey(market);
  const labelSafe=!key||key===fallbackKey;
  // Never derive a period/alternate/scorer-binary prop from full-game sums. Fantasy
  // markets are allowed to exist on the live board, but fieldsFor marks them as
  // FantasyPoints and the historical contract below still rejects them.
  if (/(?:_(?:q[1-4]|h[12]|1h|2h|alternate)$)|(?:quarter|first half|second half|first inning|1st inning)/i.test(key+' '+label)) return null;
  let fields=(family==='football'?extra.NFL:extra[sport])?.[key];
  if(family==='soccer') fields=soccer[key]||(labelSafe?soccerLabels[label]:null);
  else if(!fields && (labelSafe || marketFromProviderKey(key))) fields=fieldsFor(sport,market,key);
  if(!fields&&labelSafe) fields=family==='football'?footballLabels[label]:null;
  if(!fields&&labelSafe&&sport==='MLB') fields=({'pitching outs':['PitchingOuts'],'outs recorded':['PitchingOuts'],
    'innings pitched':['InningsPitched'],'ip':['InningsPitched'],'pitches':['PitchesThrown'],'total pitches':['PitchesThrown'],'pitches thrown':['PitchesThrown'],
    'batters faced':['BattersFaced'],'bf':['BattersFaced'],'walks allowed':['WalksAllowed'],'hits allowed':['HitsAllowed'],'batter strikeouts':['Strikeouts']})[label];
  if(!fields&&labelSafe&&sport==='NHL') fields=({'goals against':['GoalsAgainst'],'goals allowed':['GoalsAgainst']})[label];
  if(!fields&&labelSafe&&family==='basketball') fields=({'blk+stl':['BlockedShots','Steals'],'pts':['Points'],'reb':['Rebounds'],'ast':['Assists']})[label];
  if(!fields?.length || fields.includes('FantasyPoints'))return null;
  fields=fields.map(field=>({TacklesAssists:'TotalTackles',PitchingHits:'HitsAllowed',PitchingWalks:'WalksAllowed'}[field]||field));
  const entityType=fields.some(f=>f.startsWith('Team'))?'team':'player';
  const category=sport==='MLB' ? (key.startsWith('pitcher_') || !key.startsWith('batter_') &&
    (fields.some(f=>['EarnedRuns','HitsAllowed','WalksAllowed','PitchingOuts','InningsPitched','PitchesThrown','BattersFaced'].includes(f)) || /pitch|^strikeouts$|batters faced|^bf$/.test(label))?'pitching':'batting') : null;
  return {fields,entityType,category,sport,requiredSackKind:family==='football'&&label==='defensive sacks'?'defensive_sacks':null};
}
function first(values,names){for(const name of names){const v=numeric(values[name]);if(v!==null)return v;}return null;}
function pairPart(value,index){const m=String(value??'').trim().match(/^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/);return m?Number(m[index+1]):null;}
function made(value){const m=String(value??'').match(/^(\d+)-(\d+)$/);return m&&Number(m[1])<=Number(m[2])?Number(m[1]):null;}
export function normalizeStatColumns(values={}, {sport,category}={}) {
  sport=canonicalSport(sport);const out={};
  for(const [field,names] of Object.entries(aliases))out[field]=first(values,[field,...names]);
  out.ThreePointersMade ??= made(values['threePointFieldGoalsMade-threePointFieldGoalsAttempted']);
  if(PUBLIC_LEAGUES[sport]?.[0]==='football') {
    out.PassingCompletions ??= pairPart(values['completions-passingAttempts'],0);
    out.PassingAttempts ??= pairPart(values['completions-passingAttempts'],1);
    const passing=['passingAttempts','completions','passingYards','completions-passingAttempts'].some(k=>Object.hasOwn(values,k));
    const defense=['totalTackles','soloTackles','assistTackles'].some(k=>Object.hasOwn(values,k));
    // The column GROUP verifies meaning, not a name guess or a photograph.
    if(passing&&!defense){out.SacksTaken ??= numeric(values.sacks) ?? pairPart(values['sacks-sackYardsLost'],0);out.Sacks=out.SacksTaken;out.sackKind='sacks_taken';}
    else if(defense&&!passing){out.DefensiveInterceptions ??= numeric(values.interceptions);out.PassingInterceptions=null;out.SacksTaken=null;out.sackKind='defensive_sacks';}
    else {out.Sacks=null;out.SacksTaken=null;out.sackKind=null;}
    out.TotalTackles ??= out.SoloTackles!==null&&out.AssistedTackles!==null?out.SoloTackles+out.AssistedTackles:null;
    out.FieldGoalsMade ??= made(values['fieldGoalsMade-fieldGoalAttempts']);
    out.ExtraPointsMade ??= made(values['extraPointsMade-extraPointAttempts']);
    out.KickingPoints ??= out.FieldGoalsMade!==null&&out.ExtraPointsMade!==null?3*out.FieldGoalsMade+out.ExtraPointsMade:null;
    out.CompletionPercentage ??= out.PassingAttempts!==null&&out.PassingAttempts>0&&out.PassingCompletions!==null?Number((100*out.PassingCompletions/out.PassingAttempts).toFixed(3)):null;
    out.RushingYardsPerCarry ??= out.RushingAttempts!==null&&out.RushingAttempts>0&&out.RushingYards!==null?Number((out.RushingYards/out.RushingAttempts).toFixed(3)):null;
  }
  if(sport==='MLB') {
    if(category==='pitching') {
      out.HitsAllowed ??= numeric(values.hits);out.WalksAllowed ??= numeric(values.walks);
      out.PitchingOuts ??= inningsToOuts(values.innings ?? values.inningsPitched);
      out.InningsPitched=out.PitchingOuts===null?null:Number((out.PitchingOuts/3).toFixed(3));
      out.Hits=null;out.TotalBases=null;out.Singles=null;
    }else {
      out.HitsAllowed=null;out.WalksAllowed=null;out.PitchingOuts=null;out.InningsPitched=null;out.PitchesThrown=null;out.BattersFaced=null;
      if(['Hits','Doubles','Triples','HomeRuns'].every(k=>out[k]!==null&&out[k]>=0)&&out.Hits>=out.Doubles+out.Triples+out.HomeRuns){
        out.TotalBases=out.Hits+out.Doubles+2*out.Triples+3*out.HomeRuns;
        out.Singles=out.Hits-out.Doubles-out.Triples-out.HomeRuns;
      }
    }
  }
  if(sport==='NHL') {
    const g=numeric(values.powerPlayGoals),a=numeric(values.powerPlayAssists);
    out.PowerPlayPoints ??= g!==null&&a!==null?g+a:null;
  }
  return out;
}
export function statValue(values,contract) {
  const mapped=normalizeStatColumns(values,contract);
  if(!contract?.fields?.length||contract.fields.some(f=>numeric(mapped[f])===null))return null;
  return contract.fields.reduce((sum,f)=>sum+mapped[f],0);
}
