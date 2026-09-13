"""Synthetic unit fixtures verify code, never provide training evidence."""
import importlib.util
from pathlib import Path
import pandas as pd
import numpy as np

spec = importlib.util.spec_from_file_location('trainer', Path(__file__).parents[1]/'scripts/train-nfl-research-models.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def sample():
    rows=[]
    for player, start in [('one', 0), ('two', 10)]:
        for week in range(1,21):
            rows.append(dict(player_id=player, game_id=f'g-{week}', gameDate=pd.Timestamp('2025-01-01',tz='UTC')+pd.Timedelta(days=7*week), position='QB', season=2025, week=week, home=1, attempts=float(start+week), completions=float(week), passing_tds=float(week%3), receptions=0.))
    return pd.DataFrame(rows)


def test_past_only_features_and_player_isolation():
    df=sample()
    before,names=m.features_for(df,'attempts',['QB'])
    later=df.copy()
    later.loc[(later.player_id=='one') & (later.week>=12), ['attempts','completions','passing_tds']]=9999
    later.loc[later.player_id=='two', 'attempts']=8888
    after,_=m.features_for(later,'attempts',['QB'])
    mask=(before.player_id=='one') & (before.week<=12)
    pd.testing.assert_frame_equal(before.loc[mask,names],after.loc[mask,names])
    assert before.loc[(before.player_id=='one')&(before.week==12),'baseline'].iloc[0]==6.5
    assert (before.featureThrough<before.gameDate).all()
    assert before.priorGames.min()==5


def test_unknown_current_target_not_zero():
    df=sample()
    df.loc[(df.player_id=='one')&(df.week==12),'attempts']=np.nan
    frame,_=m.features_for(df,'attempts',['QB'])
    assert not ((frame.player_id=='one')&(frame.week==12)).any()


def test_exact_schedule_join_and_duplicate_rejection():
    stats=pd.DataFrame([dict(player_id='a',player_display_name='Fixture',position='QB',team='LA',season=2024,week=1,season_type='REG',attempts=32,completions=23,passing_tds=2,receptions=0)])
    schedule=pd.DataFrame([dict(game_id='x',season=2024,week=1,game_type='REG',gameday='2024-09-08',home_team='LAR',away_team='SEA',home_score=24,away_score=21)])
    frame=m.prepare_games(stats,schedule)
    assert len(frame)==1 and frame.iloc[0].game_id=='x' and frame.iloc[0].home==1
    try:
        m.prepare_games(stats,pd.concat([schedule,schedule]))
    except ValueError as exc:
        assert 'Ambiguous' in str(exc)
    else:
        raise AssertionError('duplicate schedule accepted')
