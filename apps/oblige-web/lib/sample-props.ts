import type { PropRow, ResearchResponse, LineHistoryPoint, PropGroup, Side } from './types';

export function getSamplePropRows(sport = 'NFL'): PropRow[] {
  const norm = String(sport || 'NFL').toUpperCase();

  if (norm === 'NBA') {
    return [
      ...makeRow('Nikola Jokić', 'DEN', 'LAL', 'DEN @ LAL · Tonight 10:00 PM', 'Pts+Reb+Ast', 48.5, -112, -112, 'DraftKings', 'NBA'),
      ...makeRow('Nikola Jokić', 'DEN', 'LAL', 'DEN @ LAL · Tonight 10:00 PM', 'Pts+Reb+Ast', 49.5, -110, -115, 'FanDuel', 'NBA'),
      ...makeRow('Nikola Jokić', 'DEN', 'LAL', 'DEN @ LAL · Tonight 10:00 PM', 'Pts+Reb+Ast', 48.5, -120, 102, 'BetMGM', 'NBA'),
      ...makeRow('Nikola Jokić', 'DEN', 'LAL', 'DEN @ LAL · Tonight 10:00 PM', 'Pts+Reb+Ast', 48.5, -118, -108, 'Caesars', 'NBA'),
      ...makeRow('Nikola Jokić', 'DEN', 'LAL', 'DEN @ LAL · Tonight 10:00 PM', 'Pts+Reb+Ast', 48.5, -115, -115, 'PrizePicks', 'NBA'),

      ...makeRow('Luka Dončić', 'DAL', 'PHX', 'DAL vs PHX · Tonight 8:30 PM', 'Points', 31.5, -110, -115, 'DraftKings', 'NBA'),
      ...makeRow('Luka Dončić', 'DAL', 'PHX', 'DAL vs PHX · Tonight 8:30 PM', 'Points', 32.5, -115, -110, 'FanDuel', 'NBA'),
      ...makeRow('Luka Dončić', 'DAL', 'PHX', 'DAL vs PHX · Tonight 8:30 PM', 'Points', 31.5, -112, -112, 'BetMGM', 'NBA'),
      ...makeRow('Luka Dončić', 'DAL', 'PHX', 'DAL vs PHX · Tonight 8:30 PM', 'Points', 31.5, -115, -115, 'PrizePicks', 'NBA'),

      ...makeRow('Shai Gilgeous-Alexander', 'OKC', 'GSW', 'OKC @ GSW · Tonight 9:00 PM', 'Points', 29.5, -115, -110, 'DraftKings', 'NBA'),
      ...makeRow('Shai Gilgeous-Alexander', 'OKC', 'GSW', 'OKC @ GSW · Tonight 9:00 PM', 'Points', 29.5, -112, -114, 'FanDuel', 'NBA'),
      ...makeRow('Shai Gilgeous-Alexander', 'OKC', 'GSW', 'OKC @ GSW · Tonight 9:00 PM', 'Points', 29.5, -115, -115, 'PrizePicks', 'NBA'),

      ...makeRow('Giannis Antetokounmpo', 'MIL', 'BOS', 'MIL vs BOS · Tonight 7:30 PM', 'Rebounds', 11.5, -112, -112, 'DraftKings', 'NBA'),
      ...makeRow('Giannis Antetokounmpo', 'MIL', 'BOS', 'MIL vs BOS · Tonight 7:30 PM', 'Rebounds', 12.5, 105, -135, 'FanDuel', 'NBA'),
      ...makeRow('Giannis Antetokounmpo', 'MIL', 'BOS', 'MIL vs BOS · Tonight 7:30 PM', 'Rebounds', 11.5, -115, -115, 'PrizePicks', 'NBA'),

      ...makeRow('Stephen Curry', 'GSW', 'OKC', 'GSW vs OKC · Tonight 9:00 PM', '3-Pointers Made', 4.5, -110, -115, 'DraftKings', 'NBA'),
      ...makeRow('Stephen Curry', 'GSW', 'OKC', 'GSW vs OKC · Tonight 9:00 PM', '3-Pointers Made', 4.5, -108, -118, 'FanDuel', 'NBA'),
      ...makeRow('Stephen Curry', 'GSW', 'OKC', 'GSW vs OKC · Tonight 9:00 PM', '3-Pointers Made', 4.5, -115, -115, 'PrizePicks', 'NBA'),

      ...makeRow('Anthony Davis', 'LAL', 'DEN', 'LAL vs DEN · Tonight 10:00 PM', 'Rebounds', 12.5, -108, -118, 'FanDuel', 'NBA'),
      ...makeRow('Anthony Davis', 'LAL', 'DEN', 'LAL vs DEN · Tonight 10:00 PM', 'Rebounds', 12.5, -112, -112, 'DraftKings', 'NBA'),
      ...makeRow('Anthony Davis', 'LAL', 'DEN', 'LAL vs DEN · Tonight 10:00 PM', 'Rebounds', 12.5, -115, -115, 'PrizePicks', 'NBA'),

      ...makeRow('Victor Wembanyama', 'SAS', 'HOU', 'SAS @ HOU · Tonight 8:00 PM', 'Blocks', 3.5, -125, -102, 'BetMGM', 'NBA'),
      ...makeRow('Victor Wembanyama', 'SAS', 'HOU', 'SAS @ HOU · Tonight 8:00 PM', 'Blocks', 3.5, -130, 105, 'FanDuel', 'NBA'),
      ...makeRow('Victor Wembanyama', 'SAS', 'HOU', 'SAS @ HOU · Tonight 8:00 PM', 'Blocks', 3.5, -115, -115, 'PrizePicks', 'NBA'),

      ...makeRow('Tyrese Haliburton', 'IND', 'NYK', 'IND vs NYK · Tonight 7:00 PM', 'Assists', 9.5, -118, -108, 'DraftKings', 'NBA'),
      ...makeRow('Tyrese Haliburton', 'IND', 'NYK', 'IND vs NYK · Tonight 7:00 PM', 'Assists', 9.5, -120, -105, 'FanDuel', 'NBA'),
      ...makeRow('Tyrese Haliburton', 'IND', 'NYK', 'IND vs NYK · Tonight 7:00 PM', 'Assists', 9.5, -115, -115, 'PrizePicks', 'NBA'),

      ...makeRow('Jayson Tatum', 'BOS', 'MIL', 'BOS @ MIL · Tonight 7:30 PM', 'Points', 27.5, -115, -110, 'DraftKings', 'NBA'),
      ...makeRow('Jayson Tatum', 'BOS', 'MIL', 'BOS @ MIL · Tonight 7:30 PM', 'Points', 28.5, -110, -115, 'FanDuel', 'NBA'),
      ...makeRow('Jayson Tatum', 'BOS', 'MIL', 'BOS @ MIL · Tonight 7:30 PM', 'Points', 27.5, -115, -115, 'PrizePicks', 'NBA'),

      ...makeRow('Anthony Edwards', 'MIN', 'DAL', 'MIN @ DAL · Tonight 8:30 PM', 'Points', 26.5, -112, -112, 'DraftKings', 'NBA'),
      ...makeRow('Anthony Edwards', 'MIN', 'DAL', 'MIN @ DAL · Tonight 8:30 PM', 'Points', 26.5, -114, -110, 'FanDuel', 'NBA'),
      ...makeRow('Anthony Edwards', 'MIN', 'DAL', 'MIN @ DAL · Tonight 8:30 PM', 'Points', 26.5, -115, -115, 'PrizePicks', 'NBA'),
    ];
  }

  if (norm === 'MLB') {
    return [
      ...makeRow('Shohei Ohtani', 'LAD', 'SD', 'LAD @ SD · Tomorrow 7:10 PM', 'Total Bases', 1.5, 118, -148, 'Caesars', 'MLB'),
      ...makeRow('Shohei Ohtani', 'LAD', 'SD', 'LAD @ SD · Tomorrow 7:10 PM', 'Total Bases', 1.5, 110, -140, 'DraftKings', 'MLB'),
      ...makeRow('Shohei Ohtani', 'LAD', 'SD', 'LAD @ SD · Tomorrow 7:10 PM', 'Total Bases', 1.5, 114, -145, 'FanDuel', 'MLB'),
      ...makeRow('Shohei Ohtani', 'LAD', 'SD', 'LAD @ SD · Tomorrow 7:10 PM', 'Total Bases', 1.5, -115, -115, 'PrizePicks', 'MLB'),

      ...makeRow('Aaron Judge', 'NYY', 'BAL', 'NYY vs BAL · Tomorrow 7:05 PM', 'Total Bases', 1.5, -125, -105, 'DraftKings', 'MLB'),
      ...makeRow('Aaron Judge', 'NYY', 'BAL', 'NYY vs BAL · Tomorrow 7:05 PM', 'Total Bases', 1.5, -120, -110, 'FanDuel', 'MLB'),
      ...makeRow('Aaron Judge', 'NYY', 'BAL', 'NYY vs BAL · Tomorrow 7:05 PM', 'Total Bases', 1.5, -115, -115, 'PrizePicks', 'MLB'),

      ...makeRow('Mookie Betts', 'LAD', 'SD', 'LAD @ SD · Tomorrow 7:10 PM', 'Hits', 0.5, -180, 140, 'DraftKings', 'MLB'),
      ...makeRow('Mookie Betts', 'LAD', 'SD', 'LAD @ SD · Tomorrow 7:10 PM', 'Hits', 0.5, -175, 135, 'FanDuel', 'MLB'),
      ...makeRow('Mookie Betts', 'LAD', 'SD', 'LAD @ SD · Tomorrow 7:10 PM', 'Hits', 0.5, -115, -115, 'PrizePicks', 'MLB'),

      ...makeRow('Juan Soto', 'NYY', 'BAL', 'NYY vs BAL · Tomorrow 7:05 PM', 'Hits+Runs+RBIs', 1.5, -135, 105, 'BetMGM', 'MLB'),
      ...makeRow('Juan Soto', 'NYY', 'BAL', 'NYY vs BAL · Tomorrow 7:05 PM', 'Hits+Runs+RBIs', 1.5, -140, 110, 'DraftKings', 'MLB'),
      ...makeRow('Juan Soto', 'NYY', 'BAL', 'NYY vs BAL · Tomorrow 7:05 PM', 'Hits+Runs+RBIs', 1.5, -115, -115, 'PrizePicks', 'MLB'),

      ...makeRow('Bryce Harper', 'PHI', 'ATL', 'PHI vs ATL · Tomorrow 6:40 PM', 'Total Bases', 1.5, 105, -135, 'DraftKings', 'MLB'),
      ...makeRow('Bryce Harper', 'PHI', 'ATL', 'PHI vs ATL · Tomorrow 6:40 PM', 'Total Bases', 1.5, 108, -138, 'FanDuel', 'MLB'),
      ...makeRow('Bryce Harper', 'PHI', 'ATL', 'PHI vs ATL · Tomorrow 6:40 PM', 'Total Bases', 1.5, -115, -115, 'PrizePicks', 'MLB'),
    ];
  }

  // Default: NFL
  return [
    ...makeRow('Patrick Mahomes', 'KC', 'LV', 'KC vs LV · Sunday 4:25 PM', 'Passing Yards', 265.5, -108, -118, 'FanDuel', 'NFL'),
    ...makeRow('Patrick Mahomes', 'KC', 'LV', 'KC vs LV · Sunday 4:25 PM', 'Passing Yards', 265.5, -112, -105, 'DraftKings', 'NFL'),
    ...makeRow('Patrick Mahomes', 'KC', 'LV', 'KC vs LV · Sunday 4:25 PM', 'Passing Yards', 266.5, -115, -110, 'BetMGM', 'NFL'),
    ...makeRow('Patrick Mahomes', 'KC', 'LV', 'KC vs LV · Sunday 4:25 PM', 'Passing Yards', 265.5, -114, -112, 'Caesars', 'NFL'),
    ...makeRow('Patrick Mahomes', 'KC', 'LV', 'KC vs LV · Sunday 4:25 PM', 'Passing Yards', 265.5, -115, -115, 'PrizePicks', 'NFL'),

    ...makeRow('Travis Kelce', 'KC', 'LV', 'KC vs LV · Sunday 4:25 PM', 'Receiving Yards', 58.5, -112, -114, 'DraftKings', 'NFL'),
    ...makeRow('Travis Kelce', 'KC', 'LV', 'KC vs LV · Sunday 4:25 PM', 'Receiving Yards', 57.5, -115, -110, 'FanDuel', 'NFL'),
    ...makeRow('Travis Kelce', 'KC', 'LV', 'KC vs LV · Sunday 4:25 PM', 'Receiving Yards', 58.5, -115, -115, 'PrizePicks', 'NFL'),

    ...makeRow('Josh Allen', 'BUF', 'MIA', 'BUF @ MIA · Thursday 8:15 PM', 'Passing Touchdowns', 1.5, -125, 105, 'DraftKings', 'NFL'),
    ...makeRow('Josh Allen', 'BUF', 'MIA', 'BUF @ MIA · Thursday 8:15 PM', 'Passing Touchdowns', 1.5, -128, 108, 'FanDuel', 'NFL'),
    ...makeRow('Josh Allen', 'BUF', 'MIA', 'BUF @ MIA · Thursday 8:15 PM', 'Passing Touchdowns', 1.5, -115, -115, 'PrizePicks', 'NFL'),

    ...makeRow('Tyreek Hill', 'MIA', 'BUF', 'MIA vs BUF · Thursday 8:15 PM', 'Receiving Yards', 72.5, -110, -115, 'DraftKings', 'NFL'),
    ...makeRow('Tyreek Hill', 'MIA', 'BUF', 'MIA vs BUF · Thursday 8:15 PM', 'Receiving Yards', 73.5, -112, -112, 'FanDuel', 'NFL'),
    ...makeRow('Tyreek Hill', 'MIA', 'BUF', 'MIA vs BUF · Thursday 8:15 PM', 'Receiving Yards', 72.5, -115, -115, 'PrizePicks', 'NFL'),

    ...makeRow('Christian McCaffrey', 'SF', 'LAR', 'SF @ LAR · Sunday 4:05 PM', 'Rushing Yards', 82.5, -115, -110, 'DraftKings', 'NFL'),
    ...makeRow('Christian McCaffrey', 'SF', 'LAR', 'SF @ LAR · Sunday 4:05 PM', 'Rushing Yards', 81.5, -118, -108, 'FanDuel', 'NFL'),
    ...makeRow('Christian McCaffrey', 'SF', 'LAR', 'SF @ LAR · Sunday 4:05 PM', 'Rushing Yards', 82.5, -115, -115, 'PrizePicks', 'NFL'),

    ...makeRow('CeeDee Lamb', 'DAL', 'NYG', 'DAL @ NYG · Sunday 1:00 PM', 'Receptions', 6.5, -120, -105, 'DraftKings', 'NFL'),
    ...makeRow('CeeDee Lamb', 'DAL', 'NYG', 'DAL @ NYG · Sunday 1:00 PM', 'Receptions', 6.5, -118, -108, 'FanDuel', 'NFL'),
    ...makeRow('CeeDee Lamb', 'DAL', 'NYG', 'DAL @ NYG · Sunday 1:00 PM', 'Receptions', 6.5, -115, -115, 'PrizePicks', 'NFL'),

    ...makeRow('Lamar Jackson', 'BAL', 'PIT', 'BAL @ PIT · Sunday 1:00 PM', 'Rushing Yards', 52.5, -112, -112, 'DraftKings', 'NFL'),
    ...makeRow('Lamar Jackson', 'BAL', 'PIT', 'BAL @ PIT · Sunday 1:00 PM', 'Rushing Yards', 51.5, -115, -110, 'FanDuel', 'NFL'),
    ...makeRow('Lamar Jackson', 'BAL', 'PIT', 'BAL @ PIT · Sunday 1:00 PM', 'Rushing Yards', 52.5, -115, -115, 'PrizePicks', 'NFL'),

    ...makeRow('Derrick Henry', 'BAL', 'PIT', 'BAL @ PIT · Sunday 1:00 PM', 'Rushing Yards', 75.5, -115, -110, 'DraftKings', 'NFL'),
    ...makeRow('Derrick Henry', 'BAL', 'PIT', 'BAL @ PIT · Sunday 1:00 PM', 'Rushing Yards', 76.5, -112, -114, 'FanDuel', 'NFL'),
    ...makeRow('Derrick Henry', 'BAL', 'PIT', 'BAL @ PIT · Sunday 1:00 PM', 'Rushing Yards', 75.5, -115, -115, 'PrizePicks', 'NFL'),

    ...makeRow('Amon-Ra St. Brown', 'DET', 'GB', 'DET @ GB · Sunday 4:25 PM', 'Receiving Yards', 78.5, -110, -115, 'DraftKings', 'NFL'),
    ...makeRow('Amon-Ra St. Brown', 'DET', 'GB', 'DET @ GB · Sunday 4:25 PM', 'Receiving Yards', 78.5, -108, -118, 'FanDuel', 'NFL'),
    ...makeRow('Amon-Ra St. Brown', 'DET', 'GB', 'DET @ GB · Sunday 4:25 PM', 'Receiving Yards', 78.5, -115, -115, 'PrizePicks', 'NFL'),

    ...makeRow('Justin Jefferson', 'MIN', 'CHI', 'MIN vs CHI · Sunday 1:00 PM', 'Receiving Yards', 86.5, -114, -110, 'DraftKings', 'NFL'),
    ...makeRow('Justin Jefferson', 'MIN', 'CHI', 'MIN vs CHI · Sunday 1:00 PM', 'Receiving Yards', 87.5, -110, -115, 'FanDuel', 'NFL'),
    ...makeRow('Justin Jefferson', 'MIN', 'CHI', 'MIN vs CHI · Sunday 1:00 PM', 'Receiving Yards', 86.5, -115, -115, 'PrizePicks', 'NFL'),
  ];
}

function makeRow(
  player: string,
  team: string,
  opp: string,
  matchup: string,
  market: string,
  line: number,
  overPrice: number,
  underPrice: number,
  book: string,
  sport: string
): [PropRow, PropRow] {
  const eventId = `${team}-${opp}`;
  const common = {
    playerName: player,
    team,
    opponent: opp,
    market,
    line,
    sportsbook: book,
    sportsbookKey: book.toLowerCase(),
    eventId,
    gameStartTime: new Date(Date.now() + 86400000).toISOString(),
    live: false,
    sport,
  };

  return [
    { ...common, id: `${player}-${market}-${line}-${book}-over`, side: 'OVER', price: overPrice },
    { ...common, id: `${player}-${market}-${line}-${book}-under`, side: 'UNDER', price: underPrice },
  ];
}

export function getSampleResearch(group: PropGroup, side: Side): ResearchResponse {
  const line = group.line;
  const isOver = side === 'OVER';
  const opponents = ['DEN', 'KC', 'BUF', 'MIA', 'DAL', 'PHI', 'SF', 'BAL', 'DET', 'GB'];

  const gameLog = opponents.map((opp, idx) => {
    // 75% hit rate
    const hit = idx % 4 !== 1;
    const value = hit
      ? isOver
        ? Number((line + (idx + 1) * 3.5).toFixed(1))
        : Number(Math.max(0, line - (idx + 1) * 2.5).toFixed(1))
      : isOver
      ? Number(Math.max(0, line - 4.5).toFixed(1))
      : Number((line + 5.5).toFixed(1));

    return {
      gameId: `game-${idx}`,
      date: `2026-09-${(15 - idx).toString().padStart(2, '0')}`,
      opponent: opp,
      isHome: idx % 2 === 0,
      value,
      line,
      result: hit ? 'HIT' : 'MISS',
    };
  });

  return {
    ok: true,
    available: true,
    player: { playerName: group.player, team: group.team },
    matchup: {
      opponent: group.opponent,
      isHome: true,
      homeTeam: group.homeTeam,
      awayTeam: group.awayTeam,
    },
    market: group.market,
    line: group.line,
    side,
    windows: {
      l5: { sampleSize: 5, hits: 4, hitRate: 0.8, average: line + 4.2 },
      l10: { sampleSize: 10, hits: 8, hitRate: 0.8, average: line + 3.8 },
      l20: { sampleSize: 20, hits: 14, hitRate: 0.7, average: line + 2.5 },
      season: { sampleSize: 20, hits: 14, hitRate: 0.7, average: line + 2.5 },
    },
    splits: {
      home: { sampleSize: 10, hits: 8, hitRate: 0.8, average: line + 4.0 },
      away: { sampleSize: 10, hits: 6, hitRate: 0.6, average: line + 1.8 },
    },
    streak: { count: 3, type: isOver ? 'OVER' : 'UNDER' },
    diff: 4.2,
    gameLog,
  };
}

export function getSampleLineHistory(propId: string): LineHistoryPoint[] {
  const now = Date.now();
  return [
    { recordedAt: new Date(now - 7200000).toISOString(), line: 260.5, price: -110, bookmakerKey: 'draftkings', side: 'OVER' },
    { recordedAt: new Date(now - 5400000).toISOString(), line: 262.5, price: -115, bookmakerKey: 'draftkings', side: 'OVER' },
    { recordedAt: new Date(now - 3600000).toISOString(), line: 264.5, price: -112, bookmakerKey: 'draftkings', side: 'OVER' },
    { recordedAt: new Date(now - 1800000).toISOString(), line: 265.5, price: -108, bookmakerKey: 'draftkings', side: 'OVER' },
    { recordedAt: new Date(now - 300000).toISOString(), line: 265.5, price: -108, bookmakerKey: 'draftkings', side: 'OVER' },
  ];
}
