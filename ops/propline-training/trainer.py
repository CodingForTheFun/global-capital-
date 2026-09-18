"""Chronological PropLine candidates. Never writes the production model registry."""
from __future__ import annotations
import collections, datetime as dt, hashlib, heapq, io, json, math
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor, ExtraTreesClassifier, ExtraTreesRegressor
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.metrics import log_loss, mean_absolute_error
from scipy.optimize import minimize_scalar

FEATURES = ['opening_line','no_vig_over','implied_over','days_before_start','mean5','mean20','std20','prior_games','rest_days','prior_over_at_line']
DFS = {'prizepicks','underdog','sleeper','dabble'}
GAME = {'h2h','spreads','totals','btts','double_chance','draw_no_bet','correct_score'}

def number(v):
    if v is None or isinstance(v, bool) or str(v).strip() == '': return None
    try:
        n = float(v)
        return n if math.isfinite(n) else None
    except (TypeError, ValueError): return None

def timestamp(v):
    try:
        d = dt.datetime.fromisoformat(str(v).replace('Z','+00:00'))
        return d.timestamp() if d.tzinfo else None
    except (TypeError, ValueError): return None

def implied(price):
    p = number(price)
    return p/(p-100) if p is not None and p <= -100 else 100/(100+p) if p is not None and p >= 100 else None

def samples_from_rows(rows, sport, as_of):
    """One event/player/market observation; current/closing lines never features."""
    quotes, rejects = {}, collections.Counter()
    for r in rows:
        if any(str(r.get(k,'')).startswith('(Watermark)') for k in ('player_name','home_team','away_team')):
            rejects['canary'] += 1; continue
        pid, eid, market = str(r.get('player_id') or ''), str(r.get('event_id') or ''), str(r.get('market') or '')
        if r.get('sport_key') != sport or not pid or not eid or not market or market in GAME:
            rejects['identity_or_nonplayer'] += 1; continue
        if r.get('resolution') not in ('won','lost','push'):
            rejects['unresolved_or_void'] += 1; continue
        book, side = str(r.get('bookmaker') or ''), str(r.get('outcome_name') or '').lower()
        if not book or book in DFS or side not in ('over','under') or r.get('dfs_odds_type') not in (None,'','standard'):
            rejects['unsupported_quote_type'] += 1; continue
        actual, line, price = number(r.get('actual_value')), number(r.get('opening_point')), number(r.get('opening_price'))
        opened, start, resolved = timestamp(r.get('opening_at')), timestamp(r.get('commence_time')), timestamp(r.get('resolved_at'))
        if None in (actual,line,price,opened,start,resolved) or implied(price) is None:
            rejects['missing_opening_or_result'] += 1; continue
        if not opened < start <= resolved <= as_of or start-opened > 14*86400:
            rejects['temporal_invalid'] += 1; continue
        family = market + ('@'+book if 'fantasy' in market.lower() else '')
        k=(family,eid,pid,book,line,side)
        q=dict(family=family,event=eid,player=pid,book=book,line=line,price=price,side=side,opened=opened,start=start,resolved=resolved,actual=actual)
        if k in quotes and quotes[k] != q:
            quotes[k]=None; rejects['conflicting_quote']+=1
        elif k not in quotes: quotes[k]=q
    by_player=collections.defaultdict(list)
    for k,q in quotes.items():
        if q: by_player[k[:3]].append(q)
    samples=[]
    for (family,eid,pid), pool in by_player.items():
        if len({q['actual'] for q in pool}) != 1 or len({q['start'] for q in pool}) != 1:
            rejects['conflicting_result']+=1; continue
        by_line=collections.defaultdict(dict)
        for q in pool: by_line[(q['book'],q['line'])][q['side']]=q
        candidates=[]
        for (book,line), sides in by_line.items():
            over,under=sides.get('over'),sides.get('under')
            if not over or not under or abs(over['opened']-under['opened'])>300: continue
            po,pu=implied(over['price']),implied(under['price'])
            candidates.append({**over,'cutoff':max(over['opened'],under['opened']),'resolved':max(over['resolved'],under['resolved']),'baseline':po/(po+pu),'implied':po})
        if not candidates:
            rejects['no_paired_opening_baseline']+=1; continue
        samples.append(min(candidates,key=lambda q:(q['cutoff'],q['book'],q['line'])))
    return sorted(samples,key=lambda q:(q['cutoff'],q['event'],q['player'])),dict(rejects)

def featurize(samples):
    prior=collections.defaultdict(list)
    results=sorted(enumerate(samples),key=lambda t:t[1]['resolved'])
    cursor=0; records=[]
    for q in sorted(samples,key=lambda r:r['cutoff']):
        while cursor<len(results) and results[cursor][1]['resolved']<q['cutoff']:
            previous=results[cursor][1];prior[(previous['family'],previous['player'])].append(previous);cursor+=1
        history=sorted(prior[(q['family'],q['player'])],key=lambda r:r['start'])[-20:]
        values=np.array([r['actual'] for r in history],dtype=float)
        n=len(values)
        x=[q['line'],q['baseline'],q['implied'],(q['start']-q['cutoff'])/86400,
           float(values[-5:].mean()) if n else np.nan,float(values.mean()) if n else np.nan,
           float(values.std()) if n else np.nan,n,(q['start']-history[-1]['start'])/86400 if n else np.nan,
           float((values>q['line']).mean()) if n else np.nan]
        records.append({**q,'x':x,'y':0 if q['actual']<q['line'] else 2 if q['actual']>q['line'] else 1})
    return records

def partitions(records):
    """Event/day blocks, plus label-availability purges before every next block."""
    days=sorted({int(q['start']//86400) for q in records})
    if len(days)<16: return []
    cuts=[days[int(len(days)*f)]*86400 for f in (.55,.70,.85)]
    blocks=[[],[],[],[]]
    for q in records: blocks[sum(q['start']>=c for c in cuts)].append(q)
    if any(not block for block in blocks): return []
    for i in range(3):
        earliest=min(q['cutoff'] for later in blocks[i+1:] for q in later)
        blocks[i]=[q for q in blocks[i] if q['resolved']<earliest]
    return blocks

def probs(model, x):
    raw=model.predict_proba(x); out=np.zeros((len(x),3))
    for i,c in enumerate(model.classes_): out[:,int(c)]=raw[:,i]
    return out

def temper(p,t):
    z=np.log(np.clip(p,1e-9,1))/t; z-=z.max(axis=1,keepdims=True)
    a=np.exp(z);return a/a.sum(axis=1,keepdims=True)

def ece(p,y):
    ids=np.minimum(9,(p*10).astype(int));result=0.
    for i in range(10):
        mask=ids==i
        if mask.any(): result+=mask.mean()*abs(p[mask].mean()-y[mask].mean())
    return float(result)

def train_family(records):
    blocks=partitions(records)
    info={'observations':len(records),'events':len({q['event'] for q in records}),'status':'insufficient_history','candidateOnly':True}
    if not blocks or any(len(b)<20 for b in blocks) or len(blocks[0])<60: return info,None
    if any(len({q['y'] for q in b})<2 for b in blocks[:3]): info['status']='insufficient_class_diversity';return info,None
    data=[(np.asarray([q['x'] for q in b]),np.asarray([q['y'] for q in b]),np.asarray([q['actual'] for q in b])) for b in blocks]
    xt,yt,vt=data[0]; xv,yv,vv=data[1]; xc,yc,vc=data[2]; xe,ye,ve=data[3]
    classifiers={
        'regularized_logistic':make_pipeline(SimpleImputer(add_indicator=True,keep_empty_features=True),StandardScaler(),LogisticRegression(C=.5,max_iter=500)),
        'hist_gradient_boosting':make_pipeline(SimpleImputer(add_indicator=True,keep_empty_features=True),HistGradientBoostingClassifier(max_iter=120,max_leaf_nodes=15,l2_regularization=5,learning_rate=.05,early_stopping=False,random_state=37)),
        'extra_trees':make_pipeline(SimpleImputer(add_indicator=True,keep_empty_features=True),ExtraTreesClassifier(n_estimators=120,min_samples_leaf=10,max_depth=12,n_jobs=2,random_state=37)),
    }
    regressors={
        'ridge':make_pipeline(SimpleImputer(add_indicator=True,keep_empty_features=True),StandardScaler(),Ridge(alpha=10)),
        'hist_gradient_boosting':make_pipeline(SimpleImputer(add_indicator=True,keep_empty_features=True),HistGradientBoostingRegressor(max_iter=120,max_leaf_nodes=15,l2_regularization=5,learning_rate=.05,early_stopping=False,random_state=37)),
        'extra_trees':make_pipeline(SimpleImputer(add_indicator=True,keep_empty_features=True),ExtraTreesRegressor(n_estimators=120,min_samples_leaf=10,max_depth=12,n_jobs=2,random_state=37)),
    }
    scores={}; fitted={}
    for name,model in classifiers.items():
        model.fit(xt,yt);scores[name]=float(log_loss(yv,np.clip(probs(model,xv),1e-9,1),labels=[0,1,2]));fitted[name]=model
    champion=min(scores,key=scores.get);clf=fitted[champion]
    reg_scores={}
    for name,model in regressors.items(): model.fit(xt,vt);reg_scores[name]=float(mean_absolute_error(vv,model.predict(xv)))
    reg_name=min(reg_scores,key=reg_scores.get);reg=regressors[reg_name]
    pc=probs(clf,xc)
    temperature=float(minimize_scalar(lambda t:log_loss(yc,temper(pc,t),labels=[0,1,2]),bounds=(.5,5),method='bounded').x)
    predicted=temper(probs(clf,xe),temperature)
    mask=ye!=1; conditional=predicted[mask,2]/(predicted[mask,0]+predicted[mask,2]); binary=(ye[mask]==2).astype(float)
    book=np.asarray([q['baseline'] for q in blocks[3]])[mask]
    brier=float(np.mean((conditional-binary)**2)) if len(binary) else 1.
    book_brier=float(np.mean((book-binary)**2)) if len(binary) else 1.
    events=np.asarray([q['event'] for q in blocks[3]])[mask]
    delta=(conditional-binary)**2-(book-binary)**2
    buckets=collections.defaultdict(list)
    for e,d in zip(events,delta): buckets[e].append(float(d))
    sums=np.array([sum(v) for v in buckets.values()]);counts=np.array([len(v) for v in buckets.values()])
    rng=np.random.default_rng(37);bootstrap=[]
    if len(sums):
        for _ in range(500):
            idx=rng.integers(0,len(sums),len(sums));bootstrap.append(float(sums[idx].sum()/counts[idx].sum()))
    upper=float(np.quantile(bootstrap,.975)) if bootstrap else 1.
    calibration=ece(conditional,binary) if len(binary) else 1.
    gates={'testObservations':len(binary)>=300,'testEvents':len(buckets)>=50,'brier':brier<.25,'beatsBook':brier<=book_brier,'calibration':calibration<=.075,'eventBootstrap':upper<.005}
    quality=all(gates.values())
    info.update(status='trained_candidate',classifier=champion,regressor=reg_name,candidateScores={'validationLogLoss':scores,'validationProjectionMAE':reg_scores},splitCounts=[len(b) for b in blocks],temperature=temperature,test={'observations':len(binary),'events':len(buckets),'pushes':int((ye==1).sum()),'brier':brier,'bookBrier':book_brier,'calibrationError':calibration,'brierDeltaUpper95':upper,'multiclassLogLoss':float(log_loss(ye,predicted,labels=[0,1,2])),'projectionMAE':float(mean_absolute_error(ve,reg.predict(xe)))},gates=gates,qualityGatePassed=quality,productionEligible=False,withheldReason='Separate model registry/inference integration and live feature parity verification required; never impersonate the legacy engine.',validationMethod='chronological-event-day-blocked-purged-real-opening-lines',bookComparison='conditional-on-non-push outcomes; event-cluster bootstrap',trainedThrough=max(q['resolved'] for q in blocks[0]),testedFrom=min(q['cutoff'] for q in blocks[3]),testedThrough=max(q['resolved'] for q in blocks[3]))
    artifact={'schema':'oblige-propline-candidate-v1','features':FEATURES,'classifier':clf,'temperature':temperature,'regressor':reg,'metadata':info}
    return info,artifact
