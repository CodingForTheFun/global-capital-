"""Train pooled per-market research models from verified historical game logs.

The input is produced by collect-public-model-history.mjs. Feature values for each
row use only that athlete's earlier completed games. Hyperparameters are selected
before a final chronological holdout. A model is published only when event-cluster
bootstrap evidence establishes lower MSE than the same player's rolling-10 mean.
These are research stat estimates, not claims of sportsbook profitability.
"""
from __future__ import annotations
import argparse,json,math
from datetime import datetime,timezone
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

FEATURES=['priorGames','restDays','value_lag1','value_lag2','value_lag3','value_mean3','value_mean5','value_mean10','value_mean20','value_std10']

def dump(path,obj):path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(obj,indent=2,allow_nan=False)+'\n')
def frame_features(rows):
    f=rows.sort_values(['athleteId','date','gameId']).copy();g=f.groupby('athleteId',sort=False);raw=g.cumcount();f['priorGames']=raw.clip(upper=40);f['featureThrough']=g.date.shift(1);f['restDays']=(f.date-f.featureThrough).dt.total_seconds()/86400
    for lag in (1,2,3):f[f'value_lag{lag}']=g.value.shift(lag)
    for w in (3,5,10,20):f[f'value_mean{w}']=g.value.transform(lambda s,w=w:s.shift(1).rolling(w,min_periods=3).mean())
    f['value_std10']=g.value.transform(lambda s:s.shift(1).rolling(10,min_periods=3).std());f['baseline']=f.value_mean10
    return f.loc[raw.ge(5)&f.value.notna()&f.baseline.notna()&f.featureThrough.lt(f.date)].copy()
def metric(actual,pred):return float(np.sqrt(np.mean((actual-pred)**2)))
def cluster_ci(actual,pred,base,events):
    d=pd.DataFrame({'e':events,'d':(actual-pred)**2-(actual-base)**2}).groupby('e').d.agg(['sum','count']).to_numpy();
    if len(d)<40:return [float('-inf'),float('inf')]
    rng=np.random.default_rng(20260913);idx=rng.integers(0,len(d),size=(2000,len(d)));loss=d[idx,0].sum(axis=1)/d[idx,1].sum(axis=1);return np.quantile(loss,[.025,.975]).astype(float).tolist()
def fit_market(sport,market,rows):
    f=frame_features(rows);dates=np.array(sorted(f.date.dt.normalize().unique()))
    if len(dates)<120 or len(f)<900:return None,{'marketId':market,'status':'INSUFFICIENT_HISTORY','rows':len(f),'dates':len(dates)}
    sel_cut=pd.Timestamp(dates[int(len(dates)*.65)]);hold_cut=pd.Timestamp(dates[int(len(dates)*.80)])
    dev=f.loc[f.date.lt(sel_cut)];sel=f.loc[f.date.ge(sel_cut)&f.date.lt(hold_cut)];train=f.loc[f.date.lt(hold_cut)];hold=f.loc[f.date.ge(hold_cut)]
    if min(len(dev),len(sel),len(hold))<180 or hold.gameId.nunique()<50:return None,{'marketId':market,'status':'INSUFFICIENT_HOLDOUT','development':len(dev),'selection':len(sel),'heldout':len(hold),'heldoutEvents':int(hold.gameId.nunique())}
    alphas=[10.,50.,200.,800.];choices=[]
    for alpha in alphas:
        p=make_pipeline(SimpleImputer(strategy='median'),StandardScaler(),Ridge(alpha=alpha));p.fit(dev[FEATURES],dev.value);pred=p.predict(sel[FEATURES]);choices.append((metric(sel.value.to_numpy(),pred),alpha))
    alpha=min(choices)[1];pipe=make_pipeline(SimpleImputer(strategy='median'),StandardScaler(),Ridge(alpha=alpha));pipe.fit(train[FEATURES],train.value);pred=pipe.predict(hold[FEATURES]);act=hold.value.to_numpy();base=hold.baseline.to_numpy();rmse=metric(act,pred);brmse=metric(act,base);ci=cluster_ci(act,pred,base,hold.gameId.to_numpy())
    gate=rmse<brmse and ci[1]<0
    evidence={'marketId':market,'status':'PASSED' if gate else 'WITHHELD','trainingRows':len(train),'trainingEvents':int(train.gameId.nunique()),'heldoutRows':len(hold),'heldoutEvents':int(hold.gameId.nunique()),'rmse':rmse,'baselineRmse':brmse,'improvement':1-rmse/brmse,'mseDelta95':ci,'alpha':alpha,'holdoutStart':hold.date.min().isoformat(),'holdoutEnd':hold.date.max().isoformat()}
    if not gate:return None,evidence
    imp,sc,rg=pipe.named_steps['simpleimputer'],pipe.named_steps['standardscaler'],pipe.named_steps['ridge'];q=np.quantile(act-pred,np.linspace(0,1,101)).round(6).tolist()
    model={'id':f'{sport.lower()}-{market}-ridge-v1','marketId':market,'statKey':'value','features':FEATURES,'imputerMedian':np.asarray(imp.statistics_).round(10).tolist(),'mean':np.asarray(sc.mean_).round(10).tolist(),'scale':np.asarray(sc.scale_).round(10).tolist(),'coef':np.asarray(rg.coef_).round(12).tolist(),'intercept':round(float(rg.intercept_),12),'trainingRows':len(train),'trainingEvents':int(train.gameId.nunique()),'validation':{'method':'chronological-stat-holdout','observations':len(hold),'events':int(hold.gameId.nunique()),'start':hold.date.min().isoformat(),'end':hold.date.max().isoformat(),'rmse':round(rmse,6),'baselineRmse':round(brmse,6),'rmseImprovement':round(1-rmse/brmse,6),'mseDelta95':[round(x,6) for x in ci],'residualQuantiles':q}}
    return model,evidence

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--input',required=True);ap.add_argument('--output',required=True);args=ap.parse_args();src=json.loads(Path(args.input).read_text());sport=src['stats']['sport'];df=pd.DataFrame(src['records']);df['date']=pd.to_datetime(df.date,utc=True,errors='raise');df['value']=pd.to_numeric(df.value,errors='raise');models=[];evidence=[]
    for market,rows in df.groupby('marketId'):
        model,ev=fit_market(sport,market,rows.copy());evidence.append(ev)
        if model:models.append(model)
    pack={'version':1,'engine':'Auto Scout ML','sport':sport,'generatedAt':datetime.now(timezone.utc).isoformat(),'source':'verified-public-game-logs','models':models};out=Path(args.output);dump(out,pack);dump(out.with_name(out.stem+'-report.json'),{'sport':sport,'records':len(df),'marketsAttempted':len(evidence),'modelsPassed':len(models),'passedMarkets':[m['marketId'] for m in models],'evidence':evidence});print(json.dumps({'sport':sport,'records':len(df),'modelsPassed':len(models),'passedMarkets':[m['marketId'] for m in models]},indent=2))
if __name__=='__main__':main()
