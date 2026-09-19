import datetime as dt
import unittest
from factory import utc_week, select_run

class Store:
    def __init__(self, reports=None): self.reports=reports or {}
    def get(self,path):
        import json
        run=path.split('/')[1]
        value=self.reports.get(run)
        return json.dumps(value).encode() if value is not None else None

class FactoryTests(unittest.TestCase):
    def test_week_is_stable_and_uses_completed_days(self):
        a=utc_week(dt.datetime(2026,9,19,12,tzinfo=dt.timezone.utc))
        b=utc_week(dt.datetime(2026,9,20,23,tzinfo=dt.timezone.utc))
        self.assertEqual(a,b)
        self.assertEqual(a['run'],'factory-2026-W38')
        self.assertEqual(a['until'],'2026-09-13T23:59:59Z')
    def test_incomplete_bootstrap_resumes_exact_scope(self):
        env={'TRAINING_RUN_ID':'20260918-initial','TRAINING_SINCE':'2026-04-01T00:00:00Z','TRAINING_UNTIL':'2026-09-17T23:59:59Z'}
        picked=select_run(Store({'20260918-initial':{'status':'PAUSED'}}),env,dt.datetime(2026,9,19,tzinfo=dt.timezone.utc))
        self.assertEqual(picked['mode'],'bootstrap-resume')
        self.assertEqual(picked['run'],'20260918-initial')
    def test_completed_bootstrap_advances_to_weekly(self):
        env={'TRAINING_RUN_ID':'20260918-initial'}
        picked=select_run(Store({'20260918-initial':{'status':'COMPLETE'}}),env,dt.datetime(2026,9,19,tzinfo=dt.timezone.utc))
        self.assertEqual(picked['mode'],'weekly-refresh')
        self.assertEqual(picked['run'],'factory-2026-W38')
    def test_missing_bootstrap_report_resumes_instead_of_skipping(self):
        picked=select_run(Store(),{'TRAINING_RUN_ID':'20260918-initial'},dt.datetime(2026,9,19,tzinfo=dt.timezone.utc))
        self.assertEqual(picked['mode'],'bootstrap-resume')
    def test_invalid_bootstrap_id_is_ignored(self):
        picked=select_run(Store(),{'TRAINING_RUN_ID':'../../bad'},dt.datetime(2026,9,19,tzinfo=dt.timezone.utc))
        self.assertEqual(picked['mode'],'weekly-refresh')

if __name__=='__main__': unittest.main()
