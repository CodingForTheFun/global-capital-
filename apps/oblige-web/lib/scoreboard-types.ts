export type SportKey = 'nfl' | 'nba' | 'mlb' | 'nhl' | 'soccer';
export type MatchStatus = 'scheduled' | 'live' | 'finished';
export type ScoreboardFilter = 'all' | 'live' | 'finished';

export interface Competitor {
  id: string;
  name: string;
  shortName: string;
  logoUrl?: string;
  score?: number | string;
  isWinner?: boolean;
}

export interface ScoreboardEvent {
  id: string;
  sport: SportKey;
  status: MatchStatus;
  statusDetail: string;
  homeTeam: Competitor;
  awayTeam: Competitor;
  venue?: string;
  broadcast?: string;
}

export interface ScoreboardProps {
  events: ScoreboardEvent[];
  activeSport: SportKey;
  activeFilter: ScoreboardFilter;
  onSportChange: (sport: SportKey) => void;
  onFilterChange: (filter: ScoreboardFilter) => void;
  onSelectMatch?: (matchId: string) => void;
  isLoading?: boolean;
}
