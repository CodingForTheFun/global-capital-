// Production compatibility bridge.
// Scans use the calibrated PickFinder v2 parser only after the newer
// unlock-aware authentication layer verifies that the saved browser session
// actually exposes the paid analytics. This prevents the legacy scanner from
// falling back into stale login selectors and leaking automation errors.
import {
  runLiveScan as runCalibratedScan,
  disconnectPickFinder as disconnectCalibrated,
} from './pickfinder-v2.mjs';
import {
  verifyPickFinderConnection,
  validateSavedPickFinderSession,
} from './auth-v3.mjs';

export { verifyPickFinderConnection };

export async function runLiveScan(options = {}) {
  const auth = await validateSavedPickFinderSession();
  if (!auth.connected || !auth.unlocked) {
    throw Object.assign(
      new Error('PickFinder needs to be reconnected before scanning. Open Manage PickFinder and connect the account again.'),
      { code: 'PICKFINDER_RECONNECT' },
    );
  }
  return runCalibratedScan(options);
}

export async function disconnectPickFinder() {
  return disconnectCalibrated();
}
