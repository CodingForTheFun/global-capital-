import unittest, math, datetime as dt
import numpy as np
from trainer import number,timestamp,samples_from_rows,featurize,partitions,train_family

def iso(t):return dt.datetime.fromtimestamp(t,dt.timezone.utc).isoformat()
def row(side='Over',book='draftkings',**changes):
    return dict(sport_key='football_nfl',player_id='test:1',event_id='1',market='player_rush_yds',bookmaker=book,outcome_name=side,resolution='won',actual_value='80',opening_point='50.5',opening_price='-110',opening_at='2026-09-01T00:00:00Z',commence_time='2026-09-02T00:00:00Z',resolved_at='2026-09-02T04:00:00Z',player_name='Test Player',**changes)

class TrainingTests(unittest.TestCase):
 def test_missing(self):
    for n in [None,'',True,'nan','inf']:self.assertIsNone(number(n))
    self.assertEqual(number('0'),0);self.assertIsNone(timestamp('2026-01-01'))
 def test_dedupe_and_opening(self):
    rows=[row(),row('Under'),row(book='fanduel'),row('Under','fanduel')]
    for r in rows:r['line']='200';r['closing_point']='300';r['closing_price']='5000'
    samples,counts=samples_from_rows(rows,'football_nfl',timestamp('2026-09-03T00:00:00Z'))
    self.assertEqual(len(samples),1);self.assertEqual(samples[0]['line'],50.5)
 def test_watermark_future_and_null(self):
    rows=[row(),row('Under')];rows[0]['player_name']='(Watermark) Test'
    self.assertEqual(samples_from_rows(rows,'football_nfl',timestamp('2026-09-03T00:00:00Z'))[0],[])
    rows=[row(),row('Under')];rows[0]['actual_value']=''
    self.assertEqual(samples_from_rows(rows,'football_nfl',timestamp('2026-09-03T00:00:00Z'))[0],[])
    self.assertEqual(samples_from_rows([row(),row('Under')],'football_nfl',timestamp('2026-09-01T00:00:00Z'))[0],[])
 def test_no_future_features(self):
    base=timestamp('2026-01-01T00:00:00Z')
    samples=[dict(family='rush',player='p',event=str(i),start=base+i*86400,cutoff=base+i*86400-3600,resolved=base+i*86400+7200,actual=i,line=5,baseline=.5,implied=.52) for i in range(30)]
    featured=featurize(samples)
    self.assertTrue(math.isnan(featured[0]['x'][4]));self.assertEqual(featured[1]['x'][4],0)
    self.assertEqual(featured[10]['x'][4],7)
    blocks=partitions(featured)
    self.assertEqual(len(blocks),4)
    for i in range(3):self.assertLess(max(q['resolved'] for q in blocks[i]),min(q['cutoff'] for b in blocks[i+1:] for q in b))
 def test_training_not_production(self):
    base=timestamp('2026-01-01T00:00:00Z');rng=np.random.default_rng(9)
    samples=[dict(family='test',player=f'p{i%8}',event=str(i),start=base+i*86400,cutoff=base+i*86400-3600,resolved=base+i*86400+7200,actual=int(rng.integers(0,10)),line=4.5,baseline=.5,implied=.52) for i in range(400)]
    info,artifact=train_family(featurize(samples))
    self.assertEqual(info['status'],'trained_candidate');self.assertFalse(info['productionEligible']);self.assertFalse(info['qualityGatePassed']);self.assertIsNotNone(artifact)
if __name__=='__main__':unittest.main()
