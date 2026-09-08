import { runLiveScan } from './pickfinder-v2.mjs';

// Production scanner: authenticated live PickFinder only. No sample-data fallback.
export async function runScan(options = {}) {
  return runLiveScan(options);
}
