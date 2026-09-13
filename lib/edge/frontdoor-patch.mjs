// Asserted presentation/routing integration; never replace the research engine.
export function patchEdgeFrontdoor(source) {
  const hook = '  if (await maybeServeGate(req, res)) return;';
  const server = 'const server = http.createServer(async (req, res) => {';
  const landingImport = "import { landingPage } from './lib/auth/landing.mjs';";
  const shellRead = "readFileSync('./apex-v2/scout-ui-v5.js', 'utf8')";
  const injection = 'const injection = `<script>${APEX_SHELL}</script>`;';
  const retiredFlag = 'sportsbook: true';
  for (const anchor of [hook, server, landingImport, shellRead, injection, retiredFlag]) {
    if (source.split(anchor).length !== 2) throw new Error('Research-home anchors changed; review frontdoor before deploying.');
  }
  let output = "import { createEdgeGateway } from './lib/edge/gateway.mjs';\nimport { researchClient, researchLanding } from './lib/ui/research-home.mjs';\n" + source;
  output = output.replace(landingImport, "import { landingPage as originalLandingPage } from './lib/auth/landing.mjs';\nconst landingPage = options => researchLanding(originalLandingPage(options));");
  output = output.replace(shellRead, `researchClient(${shellRead})`);
  output = output.replace(server, 'const edgeGuest = createEdgeGateway({ currentAccount, sessions: accountSessions });\n' + server);
  output = output.replace(hook, '  if (await edgeGuest(req, res)) return;\n' + hook);
  output = output.replace(injection, 'const injection = `<link rel="stylesheet" href="/assets/autoscout-home.css"><link rel="stylesheet" href="/assets/autoscout-reference-ui.css?v=20260913b"><link rel="stylesheet" href="/assets/autoscout-reference-ui-fixes.css?v=20260913b"><link rel="manifest" href="/manifest.webmanifest"><script>${APEX_SHELL}</script><script src="/assets/autoscout-home.js" defer></script><script src="/assets/autoscout-tacos.js" defer></script>`;');
  // Retired routes must not advertise a working sportsbook to API consumers.
  output = output.replace(retiredFlag, 'sportsbook: false');
  return output;
}
