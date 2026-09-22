export type SportKey = 'nfl' | 'nba' | 'mlb' | 'nhl' | 'soccer';
export type MatchStatus = 'scheduled' | 'live' | 'finished';

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
  /** Scheduled kick-off, ISO. Drives the card's date and its pre-game time. */
  startsAt?: string;
  venue?: string;
  broadcast?: string;
}

export interface ScoreboardProps {
  events: ScoreboardEvent[];
  activeSport: SportKey;
  activeFilter: 'all' | 'live' | 'finished';
  onSportChange: (sport: SportKey) => void;
  onFilterChange: (filter: 'all' | 'live' | 'finished') => void;
  onSelectMatch?: (matchId: string) => void;
  isLoading?: boolean;
}
