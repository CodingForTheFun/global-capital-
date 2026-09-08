// Compatibility bridge for the multi-source masterpiece scanner.
// The previous legacy file contained malformed escaped regex literals in production.
export {
  runLiveScan,
  verifyPickFinderConnection,
  disconnectPickFinder,
} from './pickfinder-v2.mjs';
