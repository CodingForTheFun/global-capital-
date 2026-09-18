/** Additive wiring, composed after existing research/realtime patches. */
export function patchProplineExplorerFrontdoor(source) {
  const input = String(source ?? '');
  if (input.includes('const maybeServeMarketExplorer =')) return input;
  const handler = 'async function maybeServeResearchBatch(req, res) {';
  const chain = '  if (await maybeServePropLineInsights(req, res)) return;';
  for (const anchor of [handler, chain]) {
    if (input.split(anchor).length !== 2) throw new Error('Market explorer patch requires exactly one existing research anchor.');
  }
  const binding = `const maybeServeMarketExplorer = createExplorerHandler({
  account: (req) => currentAccount(req, accountSessions),
  rateAllowed: researchRateAllowed,
  json: (res, status, payload, headers) => directJson(res, status, sanitizePublicPayload(payload), headers),
});\n\n`;
  return "import { createExplorerHandler } from './lib/data-sources/propline/explorer-route.mjs';\n" + input
    .replace(handler, binding + handler)
    .replace(chain, '  if (await maybeServeMarketExplorer(req, res)) return;\n' + chain);
}
