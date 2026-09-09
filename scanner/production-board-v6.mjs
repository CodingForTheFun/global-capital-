import { runLiveScan as runProductionScan, verifyPickFinderConnection, disconnectPickFinder } from './production.mjs';

export { verifyPickFinderConnection, disconnectPickFinder };

export async function runLiveScan(options = {}) {
  const result = await runProductionScan(options);
  return {
    ...result,
    allBoard: [...(result.picks || [])],
    fullBoardPreserved: true,
    totalLoaded: Number(result.totalLoaded ?? result.boardPropCount ?? result.picks?.length ?? 0),
  };
}
