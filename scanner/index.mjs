import { ensurePickFinderSession } from './auth-preflight.mjs';

// Production scanner: authenticated live PickFinder only. No sample-data fallback.
export async function runScan(options = {}) {
  await ensurePickFinderSession({ onProgress: options.onProgress });
  const { runLiveScan } = await import('./pickfinder-v2.mjs');
  return runLiveScan(options);
}
