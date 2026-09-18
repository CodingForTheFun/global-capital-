"""One bounded training pass, private checkpoints, no production polling loop."""
from __future__ import annotations
import collections, csv, datetime as dt, gzip, hashlib, io, json, os, pathlib, re, secrets, signal, time
import joblib, requests
from urllib.parse import urljoin, urlparse
from trainer import samples_from_rows, featurize, train_family, timestamp

BASE='https://api.prop-line.com'
STORE='https://irthqoecbhuasvcnsfjz.supabase.co/functions/v1/oblige-training-artifacts'
MIB=1024*1024
# The first all-book MLB export exceeded 128 MiB. A single real reference book
# avoids paying/downloading duplicate outcomes; this is not a site book filter.
# Its restricted coverage is recorded, never described as all-book history.
REFERENCE_BOOKS={'baseball_mlb':'draftkings'}
class Stopped(Exception): pass
class StoreFailure(Exception): pass

def log(event, **values): print(json.dumps({'event':event,**values},allow_nan=False),flush=True)
def digest(data): return hashlib.sha256(data).hexdigest()
def encode(value): return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()

class PrivateStore:
    def __init__(self,token): self.token=token;self.session=requests.Session()
    def request(self,method,path,data=None,authenticated=True):
        if not re.fullmatch(r'(runs|exports)/[A-Za-z0-9_./-]{1,200}',path) or '..' in path: raise StoreFailure('invalid_artifact_path')
        headers={'x-autoscout-ingest-token':self.token} if authenticated else {}
        if data is not None:
            if not 0<len(data)<=32*MIB: raise StoreFailure('artifact_size_limit')
            headers.update({'x-content-sha256':digest(data),'content-type':'application/octet-stream'})
        try:
            return self.session.request(method,STORE,params={'path':path},headers=headers,data=data,timeout=(8,60),allow_redirects=False)
        except requests.RequestException: raise StoreFailure('private_storage_network') from None
    def get(self,path):
        r=self.request('GET',path)
        if r.status_code==404:return None
        if r.status_code!=200 or len(r.content)>32*MIB:raise StoreFailure('private_storage_read')
        return r.content
    def put(self,path,data):
        r=self.request('PUT',path,data)
        if r.status_code!=200:raise StoreFailure('private_storage_write_'+str(r.status_code))
        if r.json().get('sha256')!=digest(data) or r.json().get('private') is not True:raise StoreFailure('private_storage_checksum')
    def verify(self,run):
        path=f'runs/{run}/storage-proof.bin';data=secrets.token_bytes(64)
        if self.request('GET',path,authenticated=False).status_code!=401:raise StoreFailure('private_storage_auth_guard')
        self.put(path,data)
        if self.get(path)!=data:raise StoreFailure('private_storage_roundtrip')

class Provider:
    def __init__(self,key,report,deadline): self.key=key;self.report=report;self.deadline=deadline;self.session=requests.Session();self.total_bytes=0
    def read(self,path,params=None):
        if time.monotonic()>self.deadline:raise Stopped('time_budget')
        if self.report['apiCalls']>=80:raise Stopped('request_budget')
        quota=self.report.get('quota',{})
        remaining=quota.get('x-daily-remaining');limit=quota.get('x-daily-limit')
        if remaining is not None and remaining<=max(100,(limit or 0)*.1):raise Stopped('website_quota_reserve')
        if path.endswith('resolved-props') and quota.get('x-propline-export-daily-remaining')==0:raise Stopped('export_daily_cap')
        self.report['apiCalls']+=1
        try:r=self.session.get(BASE+path,params=params,headers={'X-API-Key':self.key},timeout=(8,60),stream=True,allow_redirects=False)
        except requests.RequestException:raise Stopped('provider_network') from None
        for name in ['x-daily-limit','x-daily-used','x-daily-remaining','x-daily-reset','x-propline-export-daily-cap','x-propline-export-daily-remaining']:
            raw=r.headers.get(name)
            if raw and raw.isdigit():quota[name]=int(raw)
        self.report['quota']=quota
        if r.status_code in (401,403,429):r.close();raise Stopped('provider_http_'+str(r.status_code))
        if r.status_code!=200:r.close();raise Stopped('provider_http_'+str(r.status_code))
        return r
    def lines(self,response):
        size=0
        try:
            for chunk in response.iter_lines():
                size+=len(chunk)+1;self.total_bytes+=len(chunk)+1
                if size>128*MIB or self.total_bytes>512*MIB:raise Stopped('export_byte_budget')
                if time.monotonic()>self.deadline:raise Stopped('time_budget')
                yield chunk.decode('utf-8-sig')
        except requests.RequestException:raise Stopped('export_stream_interrupted') from None
        finally:response.close()

def export_sport(provider,store,sport,since,until):
    reference_book=REFERENCE_BOOKS.get(sport)
    scope=[sport,since,until]+([reference_book] if reference_book else [])
    window=digest(encode(scope))[:24]
    path=f'exports/{sport}/{window}.csv.gz';metadata_path=f'exports/{sport}/{window}.json'
    metadata=store.get(metadata_path)
    if metadata:
        info=json.loads(metadata);payload=store.get(path)
        if payload is None or digest(payload)!=info['dataSha256']:raise StoreFailure('cached_export_checksum')
        return payload,{**info,'cacheHit':True}
    params={'sport':sport,'since':since,'until':until}
    if reference_book:params['bookmaker']=reference_book
    response=provider.read('/v1/exports/resolved-props',params)
    if 'csv' not in response.headers.get('content-type','').lower():response.close();raise Stopped('export_schema_unavailable')
    headers={k:response.headers.get(k) for k in ['x-propline-export-window-start','x-propline-archive-starts']}
    reader=csv.DictReader(provider.lines(response));fields=[k for k in reader.fieldnames or [] if k!='customer_token']
    required={'event_id','sport_key','market','player_name','resolution','actual_value'}
    if reference_book:required.add('bookmaker')
    if not required.issubset(fields):response.close();raise Stopped('export_schema_mismatch')
    output=io.BytesIO();counts=collections.Counter();events=set();players=set();earliest=None;latest=None;canaries=0;missing=collections.Counter()
    with gzip.GzipFile(fileobj=output,mode='wb',mtime=0) as gz:
        with io.TextIOWrapper(gz,encoding='utf-8',newline='') as out:
            writer=csv.DictWriter(out,fieldnames=fields,extrasaction='ignore');writer.writeheader()
            for row in reader:
                if any(str(row.get(k,'')).startswith('(Watermark)') for k in ('player_name','home_team','away_team')):canaries+=1;continue
                if row.get('sport_key')!=sport:continue
                if reference_book and row.get('bookmaker')!=reference_book:raise Stopped('export_book_scope_mismatch')
                writer.writerow({k:row.get(k,'') for k in fields})
                counts[row.get('market','unknown')]+=1;events.add(row.get('event_id'));players.add(row.get('player_id') or row.get('player_name'))
                when=timestamp(row.get('commence_time'))
                if when is not None:earliest=when if earliest is None else min(earliest,when);latest=when if latest is None else max(latest,when)
                for k in ['player_id','opening_at','opening_price','opening_point','actual_value']:
                    if row.get(k) in (None,''):missing[k]+=1
    payload=output.getvalue()
    info={'rows':sum(counts.values()),'events':len(events),'players':len(players),'markets':dict(counts),'earliestGame':earliest,'latestGame':latest,'missing':dict(missing),'excludedCanaries':canaries,'archiveHeaders':headers,'dataSha256':digest(payload),'cacheHit':False,'customerTokenRemoved':True,'referenceBook':reference_book,'bookScope':'single-reference-book' if reference_book else 'all-returned-books'}
    store.put(path,payload);store.put(metadata_path,encode(info))
    if store.get(metadata_path)!=encode(info):raise StoreFailure('export_checkpoint_roundtrip')
    return payload,info

def website_preflight():
    origin='https://www.obligeprops.com'
    try:
        response=requests.get(origin+'/api/oblige-workspace?action=catalog',timeout=(8,20),allow_redirects=False)
        if response.status_code!=401 or response.json().get('code')!='AUTH_REQUIRED':raise Stopped('website_auth_verification_failed')
        page=requests.get(origin+'/board',timeout=(8,20))
        if page.status_code!=200:raise Stopped('website_board_unavailable')
        scripts=re.findall(r'<script[^>]+src="([^"]+)"',page.text)
        found=False;asset=None
        for script in scripts[:16]:
            target=urljoin(origin,script)
            if urlparse(target).netloc!=urlparse(origin).netloc:continue
            source=requests.get(target,timeout=(8,20))
            if source.status_code==200 and 'canonical-workspace-v1' in source.text:
                found=True;asset=digest(source.content);break
        if not found:raise Stopped('website_new_workspace_not_served')
        return {'accountGate':401,'boardHTTP':200,'canonicalWorkspaceAssetSha256':asset}
    except requests.RequestException:raise Stopped('website_smoke_network') from None

def main():
    key=os.getenv('PROPLINE_API_KEY','');token=os.getenv('TRAINING_STORE_TOKEN','')
    if not key or not token or '${{' in key+token:
        log('WAITING_FOR_SECURE_CONFIGURATION',providerCalls=0);return
    run=os.getenv('TRAINING_RUN_ID','20260918-initial')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,60}',run):raise Stopped('invalid_run_id')
    since=os.getenv('TRAINING_SINCE','2026-04-01T00:00:00Z');until=os.getenv('TRAINING_UNTIL','2026-09-17T23:59:59Z')
    as_of=timestamp(until)
    if as_of is None or timestamp(since) is None or timestamp(since)>=as_of or as_of>time.time():raise Stopped('invalid_window')
    deadline=time.monotonic()+3600
    smoke=website_preflight();log('WEBSITE_SMOKE_PASSED',**smoke)
    store=PrivateStore(token);store.verify(run);log('PRIVATE_STORAGE_VERIFIED',authenticated=True,roundtrip=True)
    report_path=f'runs/{run}/report.json'
    saved=store.get(report_path)
    report=json.loads(saved) if saved else {'run':run,'source':'PropLine resolved-props export','since':since,'until':until,'apiCalls':0,'sports':{},'startedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'existingInventory':{'source':'ESPN persisted history inventory, not re-downloaded','rows':49089,'bySport':{'MLB':38344,'NBA':506,'NCAAF':805,'NFL':6595,'WNBA':2839}},'trainedCandidates':0,'productionModelsPublished':0}
    if report.get('status')=='COMPLETE':log('ALREADY_COMPLETE',run=run,trainedCandidates=report.get('trainedCandidates',0));return
    report.pop('pauseReason',None)
    report['websiteSmoke']=smoke
    report['referenceBooks']=REFERENCE_BOOKS
    report['status']='RUNNING';report['sourceCommit']=os.getenv('RAILWAY_GIT_COMMIT_SHA','unknown');report['trainerSha256']=digest(pathlib.Path(__file__).with_name('trainer.py').read_bytes())
    provider=Provider(key,report,deadline)
    def checkpoint():store.put(report_path,encode(report))
    checkpoint()
    try:
        response=provider.read('/v1/sports');body=response.json();response.close()
        catalog=body if isinstance(body,list) else body.get('sports',[])
        sports=sorted({s['key'] for s in catalog if isinstance(s,dict) and re.fullmatch('[a-z0-9_]{1,90}',str(s.get('key','')))})
        if not sports or len(sports)>150:raise Stopped('catalog_invalid')
        report['catalogSports']=len(sports)
        for sport in sports:report['sports'].setdefault(sport,{'status':'PENDING'})
        checkpoint();log('TRAINING_STARTED',run=run,catalogSports=len(sports),quota=report.get('quota'),scope='all-catalog-sports')
        for sport in sports:
            if report['sports'][sport].get('status')=='COMPLETE':continue
            if time.monotonic()>deadline:raise Stopped('time_budget')
            log('SPORT_EXPORT_STARTED',sport=sport,referenceBook=REFERENCE_BOOKS.get(sport))
            payload,inventory=export_sport(provider,store,sport,since,until)
            item={'status':'TRAINING','inventory':inventory,'models':{}}
            report['sports'][sport]=item;checkpoint()
            log('SPORT_DATA_VERIFIED',sport=sport,rows=inventory['rows'],events=inventory['events'],cacheHit=inventory['cacheHit'],referenceBook=inventory.get('referenceBook'),quota=report.get('quota'))
            with gzip.open(io.BytesIO(payload),'rt',encoding='utf-8',newline='') as file:
                samples,rejected=samples_from_rows(csv.DictReader(file),sport,as_of)
            del payload
            records=featurize(samples);families=collections.defaultdict(list)
            for record in records:families[record['family']].append(record)
            item['eligibleSamples']=len(records);item['excludedForTraining']=rejected;checkpoint()
            for family in sorted(families):
                if time.monotonic()>deadline:raise Stopped('time_budget')
                try:info,artifact=train_family(families[family])
                except Exception as error:
                    info={'status':'training_failed','observations':len(families[family]),'events':len({q['event'] for q in families[family]}),'errorType':type(error).__name__,'productionEligible':False};artifact=None
                info['sport']=sport;info['market']=family;info['dataSha256']=inventory['dataSha256'];info['trainerSha256']=report['trainerSha256']
                if artifact is not None:
                    blob=io.BytesIO();joblib.dump(artifact,blob,compress=3);data=blob.getvalue()
                    artifact_path=f'runs/{run}/{sport}/{digest(family.encode())[:20]}.joblib'
                    store.put(artifact_path,data)
                    if digest(store.get(artifact_path) or b'')!=digest(data):raise StoreFailure('model_roundtrip_checksum')
                    info['artifactSha256']=digest(data);info['artifactPath']=artifact_path
                item['models'][family]=info
                report['trainedCandidates']=sum(sum(m.get('status')=='trained_candidate' for m in s.get('models',{}).values()) for s in report['sports'].values())
                checkpoint();log('MARKET_TRAINING_RESULT',sport=sport,market=family,status=info['status'],observations=info['observations'],events=info['events'],qualityGatePassed=info.get('qualityGatePassed',False),productionEligible=False)
            item['status']='COMPLETE';checkpoint()
        report['status']='COMPLETE';report['finishedAt']=dt.datetime.now(dt.timezone.utc).isoformat();checkpoint()
        log('TRAINING_COMPLETE',run=run,sports=len(sports),trainedCandidates=report['trainedCandidates'],apiCalls=report['apiCalls'],productionModelsPublished=0)
    except Stopped as error:
        report['status']='PAUSED';report['pauseReason']=str(error);checkpoint()
        log('TRAINING_PAUSED',run=run,reason=str(error),trainedCandidates=report['trainedCandidates'],apiCalls=report['apiCalls'],remainingSports=sum(s['status']!='COMPLETE' for s in report['sports'].values()))

if __name__=='__main__':
    try:main()
    except StoreFailure as e:log('STOPPED_PRIVATE_PERSISTENCE',reason=str(e))
    except Stopped as e:log('STOPPED_PREFLIGHT',reason=str(e))
    except Exception as e:log('STOPPED_UNEXPECTED',errorType=type(e).__name__)
