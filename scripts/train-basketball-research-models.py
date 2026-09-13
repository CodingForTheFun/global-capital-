"""Train NBA/WNBA stat-projection research models from official NBA Stats game logs.

No sportsbook lines are synthesized. Models are activated only after a chronological
holdout beats a same-player rolling-10 baseline. Output probabilities are calibrated
later against held-out residuals and remain estimates, not guaranteed outcomes.
"""
from __future__ import annotations
import argparse, json, math, time
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from nba_api.stats.endpoints import leaguegamelog

MARKETS={
 'player_points':'PTS','player_rebounds':'REB','player_assists':'AST','player_threes':'FG3M',
 'player_blocks':'BLK','player_steals':'STL','player_turnovers':'TOV',
 'player_points_rebounds_assists':'PRA','player_points_rebounds':'PR','player_points_assists':'PA','player_blocks_steals':'BS',
}
LEAGUES={'NBA':{'id':'00','seasons':['2021-22','2022-23','2023-24','2024-25','2025-26']},
         'WNBA':{'id':'10','seasons':['2021','2022','2023','2024','2025']}}

def dump(path,obj):path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(obj,indent=2,allow_nan=False)+'\n')
def fetch(league,season):
    for attempt in range(4):
        try:
            df=leaguegamelog.LeagueGameLog(player_or_team_abbreviation='P',season=season,season_type_all_star='Regular Season',league_id=league).get_data_frames()[0]
            if len(df): return df
        except Exception:
            if attempt==3: raise
            time.sleep(2**attempt)
    raise RuntimeError('empty game log')
def prepare(df):
    keep=['PLAYER_ID','PLAYER_NAME','GAME_ID','GAME_DATE','MATCHUP','MIN','PTS','REB','AST','FG3M','BLK','STL','TOV']
    miss=set(keep)-set(df)
    if miss: raise ValueError('missing columns '+','.join(sorted(miss)))
    x=df[keep].copy();x['date']=pd.to_datetime(x.GAME_DATE,utc=True,errors='raise');x['home']=(~x.MATCHUP.astype(str).str.contains('@')).astype(int)
    for c in ['MIN','PTS','REB','AST','FG3M','BLK','STL','TOV']:x[c]=pd.to_numeric(x[c],errors='coerce')
    x=x.loc[x.MIN.gt(0)&x.PLAYER_ID.notna()&x.GAME_ID.notna()].copy()
    x['PRA']=x.PTS+x.REB+x.AST;x['PR']=x.PTS+x.REB;x['PA']=x.PTS+x.AST;x['BS']=x.BLK+x.STL
    return x.sort_values(['PLAYER_ID','date','GAME_ID']).drop_duplicates(['PLAYER_ID','GAME_ID'],keep='last')
def make_features(df,col):
    f=df.copy();g=f.groupby('PLAYER_ID',sort=False);raw=g.cumcount();f['priorGames']=raw.clip(upper=40);f['featureThrough']=g.date.shift(1);f['restDays']=(f.date-f.featureThrough).dt.total_seconds()/86400
    names=['priorGames','restDays']
    for lag in (1,2,3):name=f'{col}_lag{lag}';f[name]=g[col].shift(lag);names.append(name)
    for w in (3,5,10,20):name=f'{col}_mean{w}';f[name]=g[col].transform(lambda s,w=w:s.shift(1).rolling(w,min_periods=3).mean());names.append(name)
    name=f'{col}_std10';f[name]=g[col].transform(lambda s:s.shift(1).rolling(10,min_periods=3).std());names.append(name)
    f['baseline']=f[f'{col}_mean10'];f=f.loc[raw.ge(5)&f[col].notna()&f.baseline.notna()].copy();return f,names
def fit_pack(sport,raw):
    seasons=sorted(raw.SEASON.unique()); holdout=seasons[-1]; train=raw.loc[raw.SEASON.ne(holdout)].copy(); test=raw.loc[raw.SEASON.eq(holdout)].copy()
    pack={'version':1,'engine':'Auto Scout ML','sport':sport,'generatedAt':datetime.now(timezone.utc).isoformat(),'models':[]}
    for market,col in MARKETS.items():
        allf,names=make_features(raw,col);tr=allf.loc[allf.SEASON.ne(holdout)];ho=allf.loc[allf.SEASON.eq(holdout)]
        if len(tr)<1000 or len(ho)<250 or ho.GAME_ID.nunique()<40: continue
        pipe=make_pipeline(SimpleImputer(strategy='median'),StandardScaler(),Ridge(alpha=50));pipe.fit(tr[names],tr[col]);pred=pipe.predict(ho[names]);act=ho[col].to_numpy();base=ho.baseline.to_numpy();rmse=float(np.sqrt(np.mean((act-pred)**2)));base_rmse=float(np.sqrt(np.mean((act-base)**2)))
        if not rmse < base_rmse: continue
        imp,sc,rg=pipe.named_steps['simpleimputer'],pipe.named_steps['standardscaler'],pipe.named_steps['ridge'];q=np.quantile(act-pred,np.linspace(0,1,101)).round(6).tolist()
        pack['models'].append({'id':f'{sport.lower()}-{market}-ridge-v1','marketId':market,'statKey':col,'features':names,'imputerMedian':np.asarray(imp.statistics_).round(10).tolist(),'mean':np.asarray(sc.mean_).round(10).tolist(),'scale':np.asarray(sc.scale_).round(10).tolist(),'coef':np.asarray(rg.coef_).round(12).tolist(),'intercept':round(float(rg.intercept_),12),'trainingRows':len(tr),'trainingEvents':int(tr.GAME_ID.nunique()),'validation':{'method':f'chronological-{holdout}-stat-holdout','observations':len(ho),'events':int(ho.GAME_ID.nunique()),'start':ho.date.min().isoformat(),'end':ho.date.max().isoformat(),'rmse':round(rmse,6),'baselineRmse':round(base_rmse,6),'rmseImprovement':round(1-rmse/base_rmse,6),'residualQuantiles':q}})
    return pack

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--output',required=True);args=ap.parse_args();out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    report={}
    for sport,cfg in LEAGUES.items():
        frames=[]
        for season in cfg['seasons']:
            df=fetch(cfg['id'],season);df['SEASON']=season;frames.append(df);time.sleep(.7)
        raw=prepare(pd.concat(frames,ignore_index=True));pack=fit_pack(sport,raw);dump(out/f'{sport.lower()}-ridge-v1.json',pack);report[sport]={'rows':len(raw),'events':int(raw.GAME_ID.nunique()),'models':len(pack['models']),'markets':[m['marketId'] for m in pack['models']]}
    dump(out/'basketball-training-report.json',report);print(json.dumps(report,indent=2))
if __name__=='__main__':main()
