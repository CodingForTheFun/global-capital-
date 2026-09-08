import { runLiveScan } from './masterpiece.mjs';

// Production scanner: authenticated live PickFinder only. No sample-data fallback.
export async function runScan(options = {}) {
  return runLiveScan(options);
}
