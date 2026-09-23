export const RESEARCH_REASONS: Readonly<Record<string, string>>;

export function reasonText(code: string | null | undefined, message?: string | null): string;

export function isTransientError(error: unknown): boolean;

export type ResearchSettled<G, R> = {
  group: G;
  row: R | null;
  code: string | null;
  message: string | null;
};

export type ResearchQueue<G extends { key: string }> = {
  want(groups: G[]): void;
  cancel(): void;
  stats(): { requests: number; pending: number; inFlight: number; settled: number; running: boolean };
};

export function createResearchQueue<G extends { key: string }, R>(options: {
  fetchBatch: (groups: G[], signal: AbortSignal) => Promise<Record<string, R>>;
  onSettled: (settled: Array<ResearchSettled<G, R>>) => void;
  onAuthLost?: () => void;
  batchSize?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  gapMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}): ResearchQueue<G>;
