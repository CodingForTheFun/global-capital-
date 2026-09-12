// Narrow, asserted integration over the CURRENT production frontdoor. Preserve
// its authentication, entitlements, data providers, routes and child services.
export function patchEdgeFrontdoor(source) {
  const hook = '  if (await maybeServeGate(req, res)) return;';
  const server = 'const server = http.createServer(async (req, res) => {';
  if (source.split(hook).length !== 2 || source.split(server).length !== 2) {
    throw new Error('Edge integration anchors changed; review frontdoor before deploying.');
  }
  let output = "import { createEdgeGateway } from './lib/edge/gateway.mjs';\n" + source;
  output = output.replace(server, 'const edgeGuest = createEdgeGateway({ currentAccount, sessions: accountSessions });\n' + server);
  output = output.replace(hook, '  if (await edgeGuest(req, res)) return;\n' + hook);
  const injection = 'const injection = `<script>${APEX_SHELL}</script>`;';
  if (!output.includes(injection)) throw new Error('Edge theme injection anchor changed.');
  output = output.replace(injection, 'const injection = `<link rel="stylesheet" href="/assets/edge-theme.css"><script>${APEX_SHELL}</script>`;');
  return output;
}
