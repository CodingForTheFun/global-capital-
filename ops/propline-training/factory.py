"""Scheduled, bounded model factory. Resumes bootstrap, then weekly verified cohorts."""
from __future__ import annotations
import datetime as dt
import json, os, re
import run as runtime
import resume

BOOTSTRAP_RE = re.compile(r'^[A-Za-z0-9_-]{1,60}$')
LOOKBACK_DAYS = 180

def utc_week(now=None):
    now = (now or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc)
    monday = (now - dt.timedelta(days=now.weekday())).replace(hour=0,minute=0,second=0,microsecond=0)
    until = monday - dt.timedelta(seconds=1)
    since = (monday - dt.timedelta(days=LOOKBACK_DAYS)).replace(hour=0,minute=0,second=0,microsecond=0)
    iso = now.isocalendar()
    return {
        'run': f'factory-{iso.year}-W{iso.week:02d}',
        'since': since.isoformat().replace('+00:00','Z'),
        'until': until.isoformat().replace('+00:00','Z'),
    }

def report(store, run):
    raw = store.get(f'runs/{run}/report.json')
    return json.loads(raw) if raw else None

def select_run(store, env=os.environ, now=None):
    bootstrap = str(env.get('TRAINING_RUN_ID','')).strip()
    if bootstrap and BOOTSTRAP_RE.fullmatch(bootstrap) and not bootstrap.startswith('factory-'):
        saved = report(store, bootstrap)
        if saved is None or saved.get('status') != 'COMPLETE':
            return {'run':bootstrap,'since':env.get('TRAINING_SINCE','2026-04-01T00:00:00Z'),
                    'until':env.get('TRAINING_UNTIL','2026-09-17T23:59:59Z'),'mode':'bootstrap-resume'}
    weekly = utc_week(now)
    return {**weekly,'mode':'weekly-refresh'}

def main():
    key=os.getenv('PROPLINE_API_KEY',''); token=os.getenv('TRAINING_STORE_TOKEN','')
    if not key or not token or '${{' in key+token:
        runtime.log('FACTORY_WAITING_FOR_SECURE_CONFIGURATION',providerCalls=0); return
    store=runtime.PrivateStore(token)
    chosen=select_run(store)
    os.environ['TRAINING_RUN_ID']=chosen['run']
    os.environ['TRAINING_SINCE']=chosen['since']
    os.environ['TRAINING_UNTIL']=chosen['until']
    runtime.log('FACTORY_COHORT_SELECTED',run=chosen['run'],mode=chosen['mode'],
                since=chosen['since'],until=chosen['until'],lookbackDays=LOOKBACK_DAYS)
    resume.main()

if __name__=='__main__':
    try: main()
    except runtime.StoreFailure as error: runtime.log('FACTORY_RETRYABLE_STORAGE_STOP',reason=str(error))
    except runtime.Stopped as error: runtime.log('FACTORY_BOUNDED_STOP',reason=str(error))
    except Exception as error: runtime.log('FACTORY_UNEXPECTED_STOP',errorType=type(error).__name__)
