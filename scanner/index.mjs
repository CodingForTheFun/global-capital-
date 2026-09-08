// Production scanner: authenticated live PickFinder only. No sample-data fallback.
export async function runScan(options = {}) {
  const { runLiveScan } = await import('./pickfinder-v2.mjs');
  return runLiveScan(options);
}
