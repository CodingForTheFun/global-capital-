export type PropCardData = {
  id: string;
  sport: 'NBA' | 'NFL' | 'MLB';
  player: string;
  team: string;
  opponent: string;
  stat: string;
  line: number;
  l5: number;
  recent: number[];
  locked?: boolean;
};

export const sampleProps: PropCardData[] = [
  { id: 'tatum-pts', sport: 'NBA', player: 'Jayson Tatum', team: 'BOS', opponent: 'NYK', stat: 'Points', line: 26.5, l5: 80, recent: [31, 29, 24, 35, 28] },
  { id: 'edwards-pts', sport: 'NBA', player: 'Anthony Edwards', team: 'MIN', opponent: 'DEN', stat: 'Points', line: 25.5, l5: 60, recent: [27, 22, 31, 26, 23] },
  { id: 'sabonis-reb', sport: 'NBA', player: 'Domantas Sabonis', team: 'SAC', opponent: 'LAL', stat: 'Rebounds', line: 12.5, l5: 80, recent: [14, 15, 11, 13, 16] },
  { id: 'allen-pass', sport: 'NFL', player: 'Josh Allen', team: 'BUF', opponent: 'MIA', stat: 'Pass Yards', line: 252.5, l5: 60, recent: [281, 247, 301, 218, 264] },
  { id: 'locked-1', sport: 'NBA', player: 'Premium Player', team: '—', opponent: '—', stat: 'Advanced Market', line: 0, l5: 0, recent: [], locked: true },
  { id: 'locked-2', sport: 'NFL', player: 'Premium Player', team: '—', opponent: '—', stat: 'Advanced Market', line: 0, l5: 0, recent: [], locked: true },
  { id: 'locked-3', sport: 'MLB', player: 'Premium Player', team: '—', opponent: '—', stat: 'Advanced Market', line: 0, l5: 0, recent: [], locked: true },
];
