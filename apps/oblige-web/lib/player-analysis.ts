import type { GameLogRow, ResearchResponse } from './types';

export const finite = (value: unknown): number | null => value == null || typeof value === 'boolean' || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export function sportFamily(sport: string) {
  const key = sport.toUpperCase();
  if (/TENNIS|ATP|WTA/.test(key)) return 'tennis';
  if (/NBA|WNBA|NCAAB|BASKETBALL/.test(key)) return 'basketball';
  if (/NFL|NCAAF|FOOTBALL/.test(key) && !/SOCCER/.test(key)) return 'football';
  if (/MLB|BASEBALL/.test(key)) return 'baseball';
  if (/NHL|HOCKEY/.test(key)) return 'hockey';
  return 'other';
}
export function leagueKey(sport: string) {
  const aliases: Record<string,string> = {basketball_nba:'NBA',basketball_wnba:'WNBA',basketball_ncaab:'NCAAB',americanfootball_nfl:'NFL',football_nfl:'NFL',americanfootball_ncaaf:'NCAAF',football_ncaaf:'NCAAF',baseball_mlb:'MLB',icehockey_nhl:'NHL',hockey_nhl:'NHL'};
  return aliases[sport.toLowerCase()] || sport.toUpperCase();
}
export function currentSeasonGames(games: GameLogRow[], season: ResearchResponse['season']) {
  return season == null ? [] : games.filter(g => String(g.season) === String(season) && (g.seasonType == null || g.seasonType === 2));
}
export function average(games: GameLogRow[]) {
  const values = games.map(g=>finite(g.value)).filter((v):v is number=>v!==null);
  return values.length ? values.reduce((sum,v)=>sum+v,0)/values.length : null;
}
export function resultLabel(game: GameLogRow) {
  const scoreFor=finite(game.scoreFor), scoreAgainst=finite(game.scoreAgainst);
  return `${game.gameResult || 'Result not reported'}${scoreFor!==null&&scoreAgainst!==null?` · ${scoreFor}–${scoreAgainst}`:''}`;
}
export type DvpMetric = {teamId:string;position:string;metric:string;average:number;games:number;rank:number|null;leagueSize:number};
export type DvpData = {available:boolean;message?:string;positions?:string[];teams:Array<{id:string;abbreviation:string;name:string}>;rows:DvpMetric[];source?:string;sourceUrl?:string;retrievedAt?:string;basis?:string};
export type LineupPlayer = {playerId:string;playerName:string;position?:string;status?:string};
export type MatchupData = {
  available:boolean;message?:string;sport?:string;eventId?:string;gameStartTime?:string;expiresAt?:string;retrievedAt?:string;source?:string;sourceUrl?:string;
  teams?: Array<{teamId:string;side:'home'|'away';name:string;abbreviation:string;record?:string|null;injuries?:{available:boolean;rows:LineupPlayer[]};lineup?:{available:boolean;starters:LineupPlayer[];bench?:LineupPlayer[];probables?:LineupPlayer[]}}>;
  prediction?:{available:boolean;homePercent?:number;awayPercent?:number;expiresAt?:string;source?:string;message?:string};
  odds?:{available:boolean;book?:string;homeMoneyline?:number|null;awayMoneyline?:number|null;spread?:string|null;total?:number|null;expiresAt?:string;message?:string};
};
export const statLabels: Record<string,string> = {points:'PTS',rebounds:'REB',assists:'AST',threes:'3PM',steals:'STL',blocks:'BLK',turnovers:'TO',passingYards:'Pass YDS',passingTouchdowns:'Pass TD',rushingYards:'Rush YDS',receivingYards:'Rec YDS',receptions:'REC',targets:'Targets',hits:'Hits',runs:'Runs',totalBases:'Total bases',strikeouts:'Strikeouts',homeRuns:'HR',shotsOnGoal:'SOG',goals:'Goals',saves:'Saves',aces:'Aces',doubleFaults:'Double faults',gamesWon:'Games won',setsWon:'Sets won',breakPointsWon:'Breaks',fantasyScore:'Fantasy score',inningsPitched:'IP',pitchingOuts:'Outs',shots:'Shots',shotsOnTarget:'SOT',fouls:'Fouls',sixes:'Sixes',fours:'Fours',wickets:'Wickets',kills:'Kills',deaths:'Deaths',mapsWon:'Maps won'};
export function gameColumns(sport: string, games: GameLogRow[]) {
  const base: Record<string,string[]> = {basketball:['points','rebounds','assists','threes'],football:['passingYards','rushingYards','receivingYards','receptions'],baseball:['hits','runs','totalBases','strikeouts'],hockey:['goals','assists','shotsOnGoal','saves'],tennis:['aces','doubleFaults','gamesWon','setsWon','breakPointsWon']};
  const preferred=base[sportFamily(sport)] || [];
  return [...new Set([...preferred,...Object.keys(statLabels).filter(k=>games.some(g=>finite(g[k])!==null))])].slice(0,10);
}
export function compareGames(a:GameLogRow,b:GameLogRow,key:string,direction:1|-1) {
  if (['opponent','gameResult'].includes(key)) return direction*String(a[key]||'').localeCompare(String(b[key]||''));
  const x=key==='date' ? finite(Date.parse(a.date||'')) : finite(a[key]);
  const y=key==='date' ? finite(Date.parse(b.date||'')) : finite(b[key]);
  return x===null ? (y===null?0:1) : y===null ? -1 : direction*(x-y);
}
