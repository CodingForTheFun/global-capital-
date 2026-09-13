import {createHash} from 'node:crypto';
import {ML_ENGINE,ML_SOURCE_COMMIT,finite,timestamp,predictionTarget,targetKey,validatedModel,validatePrediction} from './contract.mjs';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
// Explicit full-game mappings only. Period props, ambiguous sacks and fantasy scoring cannot borrow a nearby model.
export const UPSTREAM_MARKETS=Object.freeze({
 NFL:{player_pass_yds:'passing yards',player_pass_tds:'passing tds',player_pass_attempts:'attempts',player_pass_completions:'completions',player_pass_interceptions:'interceptions',player_sacks_taken:'sacks taken',player_rush_yds:'rushing yards',player_rush_attempts:'carries',player_reception_yds:'receiving yards',player_receptions:'receptions',player_rush_tds:'rushing tds',player_reception_tds:'receiving tds',player_pass_rush_yds:'qb yards',player_rush_reception_yds:'yards'},
 NBA:{player_points:'PTS',player_rebounds:'REB',player_assists:'AST',player_threes:'FG3M',player_blocks:'BLK',player_steals:'STL',player_turnovers:'TOV',player_points_rebounds_assists:'PRA',player_points_rebounds:'PR',player_points_assists:'PA',player_rebounds_assists:'RA',player_blocks_steals:'BLST'},
 WNBA:{player_points:'PTS',player_rebounds:'REB',player_assists:'AST',player_threes:'FG3M',player_blocks:'BLK',player_steals:'STL',player_turnovers:'TOV',player_points_rebounds_assists:'PRA',player_points_rebounds:'PR',player_points_assists:'PA',player_rebounds_assists:'RA',player_blocks_steals:'BLST'},
 MLB:{batter_hits:'hits',batter_total_bases:'total bases',batter_home_runs:'home runs',batter_runs_scored:'runs',batter_rbis:'rbi',batter_hits_runs_rbis:'hits+runs+rbi',batter_strikeouts:'batter strikeouts',batter_walks:'walks',pitcher_strikeouts:'pitcher strikeouts',pitcher_hits_allowed:'hits allowed',pitcher_walks:'walks allowed',pitcher_outs:'pitching outs',pitcher_outs_recorded:'pitching outs'},
 NHL:{player_shots_on_goal:'shots',player_goals:'goals',player_points:'points',player_assists:'assists',player_saves:'saves',player_total_saves:'saves',player_goals_against:'goalsAgainst',player_blocked_shots:'blocked'},
});
const platforms={Underdog:'underdog',Sleeper:'sleeper',PrizePicks:'prizepicks',DraftKings:'draftkings',FanDuel:'fanduel',BetMGM:'betmgm',Caesars:'williamhill_us'};
const normalizeName=v=>String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
/** Convert a genuine scored snapshot; no model fitting, inferred event dates, or made-up prices. */
export function buildSportstradamusSnapshot({scoredOffers,metadata,board,models,now=Date.now()}={}) {
 if(!Array.isArray(scoredOffers)||!Array.isArray(board?.props)||!Array.isArray(models))throw Error('Scored offers, canonical board, and validated models are required.');
 const generatedAt=metadata?.generated_at,generated=timestamp(generatedAt),cutoff=timestamp(metadata?.feature_cutoff);
 if(metadata?.source_commit!==ML_SOURCE_COMMIT||![generated,cutoff].every(Number.isFinite)||cutoff>generated||generated>now+30000||now-generated>30*60000)throw Error('A fresh, version-pinned snapshot with a real feature cutoff is required.');
 const usable=models.filter(validatedModel),rows=new Map(),conflicts=new Set(),rejected={};
 const reject=reason=>{rejected[reason]=(rejected[reason]||0)+1;};
 for(const r of scoredOffers){
  const book=platforms[r.Platform],start=timestamp(r.Commence);
  if(!book||!Number.isFinite(start)||!finite(r.Line)||r['Model Version']==='book_fallback'){reject('identity-or-fallback');continue;}
  // The upstream display export clips confidence and doesn't retain both unclipped sides.
  // Only non-push half lines below that clip can be reconstructed without guessing.
  const win=r['Win Prob'];
  if(Math.abs(r.Line%1)!==.5||r['Push Prob']!==0||!finite(win)||win<.5||win>=.9||!['Over','Under'].includes(r.Bet)||!finite(r.Projection)){
    reject('probability-or-settlement-not-portable');continue;
  }
  const matchingModels=usable.filter(m=>m.sport===r.League&&m.version===r['Model Version']&&UPSTREAM_MARKETS[m.sport]?.[m.marketId]===r.Market);
  if(!matchingModels.length){reject('unvalidated-model');continue;}
  const candidates=[];
  for(const m of matchingModels)for(const q of board.props){
    const t=predictionTarget(q);
    if(!t||t.sport!==m.sport||t.marketId!==m.marketId||t.sportsbookKey!==book||t.line!==r.Line||
       timestamp(t.gameStartTime)!==start||normalizeName(t.playerName)!==normalizeName(r.Player)||
       t.entityType!=='player'||t.live||t.isAlternate||q.isPromotional||q.isGoblin||q.isDemon||q.isDiscounted||q.isBoosted)continue;
    candidates.push({model:m,target:t});
  }
  const unique=new Map(candidates.map(c=>[targetKey(c.target)+'|'+c.model.id,c]));
  if(unique.size!==1){reject(unique.size?'ambiguous-identity':'no-exact-current-line');continue;}
  const {model,target}=unique.values().next().value;
  const over=r.Bet==='Over'?win:1-win;
  const value={...target,modelId:model.id,sourceKind:'trained-model-output',sourceRecordSha256:hash(r),generatedAt,featureCutoff:metadata.feature_cutoff,
    expiresAt:new Date(Math.min(start,generated+15*60000)).toISOString(),projection:r.Projection,probabilityOver:over,probabilityUnder:1-over,probabilityPush:0};
  if(!validatePrediction(value,model,now)||timestamp(value.expiresAt)<=now){reject('expired-or-invalid');continue;}
  const key=targetKey(target),prior=rows.get(key);
  if(prior&&JSON.stringify(prior)!==JSON.stringify(value)){conflicts.add(key);reject('conflicting-forecast');}else rows.set(key,value);
 }
 for(const key of conflicts)rows.delete(key);
 return {version:1,engine:ML_ENGINE,sourceCommit:ML_SOURCE_COMMIT,generatedAt,models:usable,predictions:[...rows.values()],importReport:{accepted:rows.size,rejected}};
}
