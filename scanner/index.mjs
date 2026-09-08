import { makeDemoScan } from './demo.mjs';

export async function runScan(options = {}) {
  const demoMode = String(process.env.DEMO_MODE ?? 'true').toLowerCase() === 'true';
  if (demoMode) {
    options.onProgress?.({ stage: 'demo', message: 'Generating strict demo scan', reviewed: 0, total: 0 });
    return makeDemoScan();
  }
  const { runLiveScan } = await import('./masterpiece.mjs');
  return runLiveScan(options);
}
