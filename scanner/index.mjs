// Production scanner: authenticated live PickFinder only. No sample-data fallback.
export async function runScan(options = {}) {
  const { runLiveScan } = await import('./production.mjs');
  return runLiveScan(options);
}
