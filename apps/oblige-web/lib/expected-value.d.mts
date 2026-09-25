import type { PropGroup } from './types';

export type ExpectedValueSource = 'global-model' | 'model' | 'fair-odds' | 'market-consensus';

export type ExpectedValueSelection = {
  side: 'OVER' | 'UNDER';
  ev: number;
  probability: number;
  pushProbability: number;
  price: number;
  sportsbook: string;
  sportsbookKey: string;
  source: ExpectedValueSource;
};

export const EV_POLICY: Readonly<{
  maxQuoteAgeMs: number;
  maxPairSkewMs: number;
}>;

export function expectedValueFor(
  group: PropGroup,
  prediction?: {
    available?: boolean;
    probabilityOver?: number;
    probabilityUnder?: number;
    probabilityPush?: number;
    sourceKind?: string;
  },
  options?: { now?: number },
): ExpectedValueSelection | null;

export function marketOverProbability(group: PropGroup, options?: { now?: number }): number | null;

export function expectedValueSourceLabel(
  value: ExpectedValueSelection | null | undefined,
): string | null;
