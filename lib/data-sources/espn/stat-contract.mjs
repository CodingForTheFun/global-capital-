// Pure, league-scoped stat semantics. Source keys are not interchangeable:
// a passing-log sack is a sack taken; a defensive-log sack is a sack made.
import { fieldsFor, marketFromProviderKey, marketKey } from '../sportsdataio/markets.mjs';

export const PUBLIC_LEAGUES = Object.freeze({
  NFL:['football','nfl'], NCAAF:['football','college-football'],
  NBA:['basketball','nba'], WNBA:['basketball','wnba'], NCAAB:['basketball','mens-college-basketball'],
  MLB:['baseball','mlb'], NHL:['hockey','nhl'],
  MLS:['soccer','usa.1'], EPL:['soccer','eng.1'], UCL:['soccer','uefa.champions'],
});
export const canonicalSport = value => ({CFB:'NCAAF',CBB:'NCAAB',NCAAM:'NCAAB',PREMIER_LEAGUE:'EPL',CHAMPIONS_LEAGUE:'UCL'}[String(value||'').toUpperCase()] || String(value||'').toUpperCase());
export const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value
  : typeof value === 'string' && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim()) ? Number(value) : null;
export function inningsToOuts(value) {
  const match = String(value ?? '').trim().match(/^(\d+)(?:\.([012]))?$/);
  return match ? Number(match[1])*3 + Number(match[2] || 0) : null;
}
const aliases = {
  PassingAttempts:['passingAttempts','passAttempts','passing_attempts'],
  PassingCompletions:['completions','passingCompletions','passCompletions','passing_completions'],
  PassingYards:['passingYards','passYards','passing_yds'], PassingTouchdowns:['passingTouchdowns','passTDs','passing_tds'],
  PassingInterceptions:['interceptions','passingInterceptions'],
  RushingAttempts:['rushingAttempts','rushAttempts','rushing_attempts'], RushingYards:['rushingYards','rushYards','rushing_yds'],
  RushingTouchdowns:['rushingTouchdowns','rushTDs'], Receptions:['receptions'],
  ReceivingYards:['receivingYards','recYards','receiving_yds'], ReceivingTargets:['receivingTargets','targets'],
  ReceivingTouchdowns:['receivingTouchdowns','recTDs'],
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
  Goals:['goals'], ShotsOnGoal:['shotsTotal','shotsOnGoal','sog'], Saves:['saves'], GoalsAgainst:['goalsAgainst'],
  PowerPlayPoints:['powerPlayPoints'],
  SoccerGoals:['totalGoals','goals'], SoccerAssists:['goalAssists','assists'], Shots:['totalShots','shots'],
  ShotsOnTarget:['shotsOnTarget'], PassesAttempted:['totalPass','passesAttempted','totalPasses'],
  PassesCompleted:['accuratePass','passesCompleted','accuratePasses'], Tackles:['totalTackle','totalTackles','tackles'],
};
const extra = {
  NFL:{player_sacks:['Sacks'],player_sacks_taken:['SacksTaken'],player_solo_tackles:['SoloTackles'],
    player_assists:['AssistedTackles'],player_tackles_assists:['TotalTackles'],player_field_goals:['FieldGoalsMade'],
    player_pats:['ExtraPointsMade'],player_kicking_points:['KickingPoints'],
    team_sacks:['TeamDefensiveSacks'],team_defensive_sacks:['TeamDefensiveSacks'],
    team_sacks_allowed:['TeamSacksAllowed'],team_points_allowed:['TeamPointsAllowed'],points_allowed:['TeamPointsAllowed'],
    pass_yds:['PassingYards'],pass_tds:['PassingTouchdowns'],pass_attempts:['PassingAttempts'],pass_completions:['PassingCompletions'],
    rush_yds:['RushingYards'],rush_attempts:['RushingAttempts'],rec_yds:['ReceivingYards'],receptions:['Receptions'],
    player_pass_rush_yds:['PassingYards','RushingYards']},
  MLB:{batter_runs_scored:['Runs'],batter_strikeouts:['Strikeouts'],batter_triples:['Triples'],
    pitcher_hits_allowed:['HitsAllowed'],pitcher_walks:['WalksAllowed'],pitcher_outs:['PitchingOuts']},
  NHL:{player_blocked_shots:['BlockedShots'],player_goals_against:['GoalsAgainst']},
};
const footballLabels = {sacks:['Sacks'],'sacks taken':['SacksTaken'],'times sacked':['SacksTaken'],
  'tackles+assists':['TotalTackles'],'tackles + assists':['TotalTackles'],'solo tackles':['SoloTackles'],
  'field goals':['FieldGoalsMade'],'field goals made':['FieldGoalsMade'],'kicking points':['KickingPoints'],
  'extra points made':['ExtraPointsMade'],'team sacks':['TeamDefensiveSacks'],'defensive sacks':['Sacks'],
  'team defensive sacks':['TeamDefensiveSacks'],'team sacks allowed':['TeamSacksAllowed'],'points allowed':['TeamPointsAllowed']};
const soccer = {player_shots:['Shots'],player_shots_on_target:['ShotsOnTarget'],player_goals:['SoccerGoals'],
  player_assists:['SoccerAssists'],player_passes_attempted:['PassesAttempted'],player_passes_completed:['PassesCompleted'],player_tackles:['Tackles']};
const soccerLabels = {shots:['Shots'],'shots on target':['ShotsOnTarget'],sot:['ShotsOnTarget'],goals:['SoccerGoals'],
  assists:['SoccerAssists'],'passes attempted':['PassesAttempted'],'passes completed':['PassesCompleted'],tackles:['Tackles']};
export function marketContract({sport,market,providerMarketKey} = {}) {
  sport=canonicalSport(sport);const family=PUBLIC_LEAGUES[sport]?.[0];
  const key=String(providerMarketKey||'').toLowerCase(), label=marketKey(market);
  // Never derive a period/alternate/fantasy/scorer-binary prop from full-game sums.
  if (/(?:_(?:q[1-4]|h[12]|1h|2h|alternate)$)|(?:quarter|first half|second half)/i.test(key+' '+label)) return null;
  let fields=(family==='football'?extra.NFL:extra[sport])?.[key];
  if(family==='soccer') fields=key?soccer[key]:soccerLabels[label];
  else if(!fields && (!key || marketFromProviderKey(key))) fields=fieldsFor(sport,market,key);
  if(!fields&&!key) fields=family==='football'?footballLabels[label]:null;
  if(!fields&&!key&&sport==='MLB') fields=({'pitching outs':['PitchingOuts'],'outs recorded':['PitchingOuts'],
    'walks allowed':['WalksAllowed'],'hits allowed':['HitsAllowed'],'batter strikeouts':['Strikeouts']})[label];
  if(!fields&&!key&&sport==='NHL') fields=({'goals against':['GoalsAgainst'],'goals allowed':['GoalsAgainst']})[label];
  if(!fields&&!key&&family==='basketball') fields=({'blk+stl':['BlockedShots','Steals'],'pts':['Points'],'reb':['Rebounds'],'ast':['Assists']})[label];
  if(!fields?.length || fields.includes('FantasyPoints'))return null;
  const entityType=fields.some(f=>f.startsWith('Team'))?'team':'player';
  const category=sport==='MLB' ? (key.startsWith('pitcher_') || !key.startsWith('batter_') &&
    (fields.some(f=>['EarnedRuns','HitsAllowed','WalksAllowed','PitchingOuts'].includes(f)) || /pitch|^strikeouts$/.test(label))?'pitching':'batting') : null;
  return {fields,entityType,category,sport,requiredSackKind:family==='football'&&label==='defensive sacks'?'defensive_sacks':null};
}
function first(values,names){for(const name of names){const v=numeric(values[name]);if(v!==null)return v;}return null;}
function made(value){const m=String(value??'').match(/^(\d+)-(\d+)$/);return m&&Number(m[1])<=Number(m[2])?Number(m[1]):null;}
export function normalizeStatColumns(values={}, {sport,category}={}) {
  sport=canonicalSport(sport);const out={};
  for(const [field,names] of Object.entries(aliases))out[field]=first(values,[field,...names]);
  out.ThreePointersMade ??= made(values['threePointFieldGoalsMade-threePointFieldGoalsAttempted']);
  if(PUBLIC_LEAGUES[sport]?.[0]==='football') {
    const passing=['passingAttempts','completions','passingYards'].some(k=>Object.hasOwn(values,k));
    const defense=['totalTackles','soloTackles','assistTackles'].some(k=>Object.hasOwn(values,k));
    // The column GROUP verifies meaning, not a name guess or a photograph.
    if(passing&&!defense){out.SacksTaken ??= numeric(values.sacks);out.Sacks=out.SacksTaken;out.sackKind='sacks_taken';}
    else if(defense&&!passing){out.SacksTaken=null;out.sackKind='defensive_sacks';}
    else {out.Sacks=null;out.SacksTaken=null;out.sackKind=null;}
    out.TotalTackles ??= out.SoloTackles!==null&&out.AssistedTackles!==null?out.SoloTackles+out.AssistedTackles:null;
    out.FieldGoalsMade ??= made(values['fieldGoalsMade-fieldGoalAttempts']);
    out.ExtraPointsMade ??= made(values['extraPointsMade-extraPointAttempts']);
    out.KickingPoints ??= out.FieldGoalsMade!==null&&out.ExtraPointsMade!==null?3*out.FieldGoalsMade+out.ExtraPointsMade:null;
  }
  if(sport==='MLB') {
    if(category==='pitching') {
      out.HitsAllowed ??= numeric(values.hits);out.WalksAllowed ??= numeric(values.walks);
      out.PitchingOuts ??= inningsToOuts(values.innings ?? values.inningsPitched);
      out.Hits=null;out.TotalBases=null;out.Singles=null;
    }else {
      out.HitsAllowed=null;out.WalksAllowed=null;out.PitchingOuts=null;
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
