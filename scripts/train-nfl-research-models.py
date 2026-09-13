"""Fit reproducible NFL point-estimate research candidates, never publish them.

Data: nflverse player game statistics and schedules, 2020--2025 regular seasons.
Hyperparameters: selected on 2023, after fitting only 2020--2022.
Evaluation artifact: refit 2020--2024, then evaluated once on untouched 2025.
Features for each game use ONLY earlier games for that player. These are
retrospective backtests, not claimed archived pregame forecasts or real odds.
No sportsbook probabilities, fake lines, credentials or production writes.
This is Auto Scout research training, NOT the original Sportstradamus pipeline.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import lightgbm as lgb

SEASONS = list(range(2020, 2026))
MARKETS = {
    'player_pass_attempts': ('attempts', ['QB']),
    'player_pass_completions': ('completions', ['QB']),
    'player_pass_tds': ('passing_tds', ['QB']),
    'player_receptions': ('receptions', ['WR', 'RB', 'TE']),
}
TEAM_ALIASES = {'LA': 'LAR', 'WSH': 'WAS', 'OAK': 'LV', 'JAC': 'JAX', 'SD': 'LAC', 'STL': 'LAR'}


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare_games(stats: pd.DataFrame, schedule: pd.DataFrame) -> pd.DataFrame:
    """Join exact season/week/team to one completed regular-season game."""
    stats = stats.copy()
    schedule = schedule.copy()
    if 'team' not in stats and 'recent_team' in stats:
        stats = stats.rename(columns={'recent_team': 'team'})
    position = 'position' if 'position' in stats else 'position_group'
    statcols = ['player_id', 'player_display_name', position, 'season', 'week', 'season_type', 'team',
                'attempts', 'completions', 'passing_tds', 'receptions']
    missing = set(statcols) - set(stats)
    if missing:
        raise ValueError('Missing true player-stat columns: ' + ', '.join(sorted(missing)))
    needed = {'game_id', 'season', 'week', 'game_type', 'gameday', 'home_team', 'away_team', 'home_score', 'away_score'}
    if needed - set(schedule):
        raise ValueError('Missing schedule columns: ' + ', '.join(sorted(needed - set(schedule))))
    schedule = schedule.loc[schedule.game_type.eq('REG') & schedule.home_score.notna() & schedule.away_score.notna()].copy()
    schedule['gameDate'] = pd.to_datetime(schedule.gameday, utc=True, errors='raise')
    if schedule.gameDate.max() >= pd.Timestamp.now(tz='UTC'):
        raise ValueError('Schedule contains future or incomplete outcomes')
    home = schedule[['game_id', 'season', 'week', 'gameDate', 'home_team']].rename(columns={'home_team': 'team'})
    away = schedule[['game_id', 'season', 'week', 'gameDate', 'away_team']].rename(columns={'away_team': 'team'})
    home['home'] = 1
    away['home'] = 0
    games = pd.concat([home, away], ignore_index=True)
    games.team = games.team.replace(TEAM_ALIASES)
    if games.duplicated(['season', 'week', 'team']).any():
        raise ValueError('Ambiguous season/week/team schedule identity')
    stats = stats.loc[stats.season_type.eq('REG'), statcols].rename(columns={position: 'position'})
    stats.team = stats.team.replace(TEAM_ALIASES)
    result = stats.merge(games, on=['season', 'week', 'team'], how='inner', validate='many_to_one')
    if result.empty or result[['player_id', 'game_id', 'gameDate', 'position']].isna().any().any():
        raise ValueError('No complete player/game identities')
    if result.duplicated(['player_id', 'game_id']).any():
        raise ValueError('Duplicate player/game rows; refusing arbitrary resolution')
    for column, _ in MARKETS.values():
        result[column] = pd.to_numeric(result[column], errors='raise')
        valid = result[column].dropna()
        if ((valid < 0) | (valid % 1 != 0)).any():
            raise ValueError('Invalid nonnegative integer stat: ' + column)
    return result.sort_values(['player_id', 'gameDate', 'game_id']).reset_index(drop=True)


def features_for(games: pd.DataFrame, column: str, positions: list[str]) -> tuple[pd.DataFrame, list[str]]:
    """Lag before rolling, keep missing values missing, never use a target game."""
    frame = games.loc[games.position.isin(positions)].copy()
    group = frame.groupby('player_id', sort=False)
    frame['priorGames'] = group.cumcount()
    frame['featureThrough'] = group.gameDate.shift(1)
    frame['restDays'] = (frame.gameDate - frame.featureThrough).dt.total_seconds() / 86400
    names = ['week', 'home', 'priorGames', 'restDays']
    for stat in sorted(set([column, 'attempts' if positions == ['QB'] else 'receptions'])):
        for lag in (1, 2, 3):
            name = f'{stat}_lag{lag}'
            frame[name] = group[stat].shift(lag)
            names.append(name)
        for window in (3, 5, 10, 20):
            name = f'{stat}_mean{window}'
            frame[name] = group[stat].transform(lambda s, w=window: s.shift(1).rolling(w, min_periods=3).mean())
            names.append(name)
        name = f'{stat}_std10'
        frame[name] = group[stat].transform(lambda s: s.shift(1).rolling(10, min_periods=3).std())
        names.append(name)
    for pos in positions:
        name = 'position_' + pos
        frame[name] = frame.position.eq(pos).astype(int)
        names.append(name)
    frame['baseline'] = frame[column + '_mean10']
    frame = frame.loc[frame.priorGames.ge(5) & frame[column].notna() & frame.baseline.notna()].copy()
    if not (frame.featureThrough < frame.gameDate).all():
        raise ValueError('Temporal leakage in player features')
    return frame, names


def errors(actual: np.ndarray, prediction: np.ndarray) -> dict:
    return {'rmse': float(np.sqrt(np.mean((actual - prediction) ** 2))),
            'mae': float(np.mean(np.abs(actual - prediction))),
            'bias': float(np.mean(prediction - actual))}


def clustered_interval(actual, predicted, baseline, events) -> list[float]:
    """95% event-cluster bootstrap interval for MSE(model)-MSE(baseline)."""
    samples = pd.DataFrame({'event': events, 'diff': (actual-predicted)**2 - (actual-baseline)**2})
    by_event = samples.groupby('event')['diff'].agg(['sum', 'count']).to_numpy()
    rng = np.random.default_rng(20260913)
    draws = rng.integers(0, len(by_event), size=(2000, len(by_event)))
    loss = by_event[draws, 0].sum(axis=1) / by_event[draws, 1].sum(axis=1)
    return np.quantile(loss, [0.025, 0.975]).astype(float).tolist()


def train_cell(frame: pd.DataFrame, names: list[str], column: str, market: str, output: Path) -> dict:
    development = frame.loc[frame.season.le(2022)]
    selection = frame.loc[frame.season.eq(2023)]
    train = frame.loc[frame.season.le(2024)]
    heldout = frame.loc[frame.season.eq(2025)]
    if min(len(development), len(selection), len(heldout)) < 100:
        return {'marketId': market, 'status': 'INSUFFICIENT_DATA', 'trained': False}
    if train.gameDate.max() >= heldout.gameDate.min():
        raise ValueError('Train/test calendar overlap')
    grid = [dict(num_leaves=7, n_estimators=120), dict(num_leaves=15, n_estimators=200), dict(num_leaves=15, n_estimators=320)]
    common = dict(objective='poisson', learning_rate=0.025, min_child_samples=40,
                  reg_lambda=10, random_state=20260913, n_jobs=2, verbosity=-1,
                  deterministic=True, force_col_wise=True)
    scores = []
    for params in grid:
        model = lgb.LGBMRegressor(**common, **params)
        model.fit(development[names], development[column])
        score = errors(selection[column].to_numpy(), model.predict(selection[names]))
        scores.append({'parameters': params, 'validation': score})
    selected = min(scores, key=lambda entry: entry['validation']['rmse'])['parameters']
    model = lgb.LGBMRegressor(**common, **selected)
    model.fit(train[names], train[column])
    estimate = model.predict(heldout[names])
    actual = heldout[column].to_numpy()
    baseline = heldout.baseline.to_numpy()
    if not np.isfinite(estimate).all() or (estimate < 0).any():
        raise ValueError('Invalid fitted model predictions')
    metrics = errors(actual, estimate)
    baseline_metrics = errors(actual, baseline)
    ci = clustered_interval(actual, estimate, baseline, heldout.game_id.to_numpy())
    dest = output / 'candidates' / market
    dest.mkdir(parents=True, exist_ok=True)
    model_path = dest / 'model.txt'
    model.booster_.save_model(str(model_path))
    loaded = lgb.Booster(model_file=str(model_path))
    np.testing.assert_allclose(loaded.predict(heldout[names]), estimate, rtol=1e-12, atol=1e-12)
    evidence = heldout[['game_id', 'player_id', 'player_display_name', 'season', 'week', 'gameDate', 'featureThrough']].copy()
    evidence['actual'] = actual
    evidence['projection'] = estimate
    evidence['historicalMean10'] = baseline
    evidence['evaluationType'] = 'retrospective-point-estimate-backtest'
    evidence.to_csv(dest / 'heldout.csv', index=False)
    metadata = {'engine': 'AutoScout NFL research candidate', 'version': 'nfl-poisson-gbdt-20260913-v1',
        'marketId': market, 'statColumn': column, 'sport': 'NFL', 'features': names,
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'source': 'nflverse completed regular-season player game statistics',
        'sourceCommit': os.environ.get('GITHUB_SHA'), 'artifactSha256': sha(model_path),
        'trainingRows': len(train), 'trainingEvents': int(train.game_id.nunique()),
        'trainingStart': train.gameDate.min().isoformat(), 'trainingEnd': train.gameDate.max().isoformat(),
        'heldoutRows': len(heldout), 'heldoutEvents': int(heldout.game_id.nunique()),
        'heldoutStart': heldout.gameDate.min().isoformat(), 'heldoutEnd': heldout.gameDate.max().isoformat(),
        'hyperparameterSelectionSeason': 2023, 'selectionResults': scores, 'selectedParameters': selected,
        'heldout': metrics, 'historicalMean10Baseline': baseline_metrics,
        'clusterBootstrapMseDifference95': ci,
        'beatsHistoricalBaseline': metrics['rmse'] < baseline_metrics['rmse'],
        'pointEstimateImprovementEstablished': ci[1] < 0,
        'status': 'RESEARCH_ONLY', 'trained': True, 'productionEnabled': False,
        'bettingProbabilityValidated': False, 'sportstradamusCompatible': False,
        'limitations': ['Not the original Sportstradamus feature/model pipeline.',
          'Retrospective point-estimate validation; no real archived sportsbook lines/prices used.',
          'No over/under probability, betting edge, hit-rate or profitability claim.',
          'Observed players only; no model for whether a player will participate.',
          'No injury, lineup, opponent or depth-chart feature feed.',
          'Does not pass or bypass the existing real-lines production gate.']}
    write_json(dest / 'metadata.json', metadata)
    print(json.dumps({key: metadata[key] for key in ['marketId', 'trainingRows', 'heldoutRows', 'heldout', 'historicalMean10Baseline', 'beatsHistoricalBaseline', 'productionEnabled']}), flush=True)
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    report = {'status': 'STARTED', 'trainedModels': 0, 'enabledModels': 0, 'cells': []}
    write_json(output / 'report.json', report)
    import nflreadpy as nfl
    print('Downloading actual completed NFL seasons:', SEASONS, flush=True)
    stats = nfl.load_player_stats(SEASONS, summary_level='week').to_pandas()
    schedules = nfl.load_schedules(SEASONS).to_pandas()
    data = output / 'data'
    data.mkdir(exist_ok=True)
    stats.to_parquet(data / 'player_stats.parquet', index=False)
    schedules.to_parquet(data / 'schedules.parquet', index=False)
    write_json(output / 'sources.json', {
        'retrievedAt': datetime.now(timezone.utc).isoformat(),
        'provider': 'nflverse', 'seasons': SEASONS,
        'documentation': 'https://nflreadpy.nflverse.com/api/load_functions/',
        'playerStatsSha256': sha(data / 'player_stats.parquet'), 'scheduleSha256': sha(data / 'schedules.parquet'),
        'packages': {name: importlib.metadata.version(name) for name in ['nflreadpy', 'lightgbm', 'pandas', 'numpy']},
        'rawPlayerRows': len(stats), 'rawScheduleRows': len(schedules),
        'playerColumns': list(stats.columns), 'scheduleColumns': list(schedules.columns)})
    games = prepare_games(stats, schedules)
    report['canonicalGameRows'] = len(games)
    report['canonicalEvents'] = int(games.game_id.nunique())
    for market, (column, positions) in MARKETS.items():
        frame, features = features_for(games, column, positions)
        cell = train_cell(frame, features, column, market, output)
        report['cells'].append(cell)
        report['trainedModels'] += int(cell.get('trained', False))
        write_json(output / 'report.json', report)
    report['status'] = 'RESEARCH_TRAINING_COMPLETE'
    report['generatedAt'] = datetime.now(timezone.utc).isoformat()
    report['productionEnabled'] = False
    write_json(output / 'report.json', report)


if __name__ == '__main__':
    main()
