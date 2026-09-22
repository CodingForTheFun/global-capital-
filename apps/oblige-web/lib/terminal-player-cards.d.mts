import type { PropGroup } from './types';

export declare function terminalPlayerCardKey(
  group: PropGroup,
  teamIndex?: Map<string, unknown> | null,
): string;

export declare function uniqueTerminalPlayerCards(groups?: PropGroup[]): PropGroup[];
