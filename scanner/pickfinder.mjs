// Production compatibility bridge.
// Live scanning stays on the calibrated PickFinder v2 scanner while account
// connection verification uses the newer unlock-aware authentication flow.
export { runLiveScan, disconnectPickFinder } from './pickfinder-v2.mjs';
export { verifyPickFinderConnection } from './auth-v3.mjs';
