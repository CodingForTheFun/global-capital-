import type { PropGroup } from './types';

export type MarketArbitrageQuote = {
  bookKey: string;
  bookName: string;
  side: 'OVER' | 'UNDER';
  line: number;
  price: number;
  decimal: number;
  observedAt: number;
};

export type MarketArbitrageCandidate = {
  line: number;
  over: MarketArbitrageQuote;
  under: MarketArbitrageQuote;
  impliedSum: number;
  possiblePush: boolean;
  minimumReturnPct: number;
  decidedReturnPct: number;
  maximumReturnPct: number;
  overStakePct: number;
  underStakePct: number;
  theoretical: true;
  executionVerified: false;
  note: string;
};

export const MARKET_ARB_POLICY: Readonly<{
  maxQuoteAgeMs: number;
  maxQuoteSkewMs: number;
}>;

export function marketArbitrage(
  group: PropGroup,
  options?: { now?: number },
): MarketArbitrageCandidate | null;

export function marketArbitrageLabel(
  candidate: MarketArbitrageCandidate | null | undefined,
): string | null;
