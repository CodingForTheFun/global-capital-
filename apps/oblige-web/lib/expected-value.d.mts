import type { PropGroup } from './types';

export type ExpectedValueSource = 'model' | 'fair-odds' | 'market-consensus';

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
  },
  options?: { now?: number },
): ExpectedValueSelection | null;

export function expectedValueSourceLabel(
  value: ExpectedValueSelection | null | undefined,
): string | null;
