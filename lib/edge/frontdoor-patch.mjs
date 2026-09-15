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
  let output = "import { createEdgeGateway } from './lib/edge/gateway.mjs';\nimport { researchClient, researchLanding } from './lib/ui/research-home.mjs';\nimport { handleAdminRoutes } from './lib/auth/admin-routes.mjs';\nimport { handleAdminAccessRoutes } from './lib/auth/admin-access-routes.mjs';\nimport { handleOwnerRecoveryRoutes } from './lib/auth/owner-recovery-routes.mjs';\nimport { handleSupportRoutes } from './lib/auth/support-routes.mjs';\nimport { handleBillingRoutes } from './lib/billing/paypal-routes.mjs';\n" + source;
  output = output.replace(landingImport, "import { landingPage as originalLandingPage } from './lib/auth/landing.mjs';\nconst landingPage = options => researchLanding(originalLandingPage(options));");
  output = output.replace(shellRead, `researchClient(${shellRead})`);
  output = output.replace(server, 'const edgeGuest = createEdgeGateway({ currentAccount, sessions: accountSessions });\n' + server);
  output = output.replace(
    hook,
    '  if (await edgeGuest(req, res)) return;\n'
      + "  { const recoveryUrl = new URL(req.url || '/', 'http://localhost'); if (await handleOwnerRecoveryRoutes(req, res, recoveryUrl, { sessions: accountSessions, json: directJson, secret: sessionSecret, log: console })) return; }\n"
      + "  { const billingUrl = new URL(req.url || '/', 'http://localhost'); if (await handleBillingRoutes(req, res, billingUrl, { sessions: accountSessions, json: directJson, secret: sessionSecret, log: console })) return; }\n"
      + hook
      + "\n  { const staffUrl = new URL(req.url || '/', 'http://localhost');"
      + " if (await handleAdminAccessRoutes(req, res, staffUrl, { sessions: accountSessions, json: directJson, secret: sessionSecret, log: console })) return;"
      + " if (await handleAdminRoutes(req, res, staffUrl, { sessions: accountSessions, json: directJson, secret: sessionSecret, log: console })) return;"
      + " if (await handleSupportRoutes(req, res, staffUrl, { sessions: accountSessions, json: directJson, secret: sessionSecret, log: console })) return; }",
  );
  output = output.replace(injection, `const appHead = '<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Oblige Props"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icon.svg">';
      if (body.includes('</head>')) body = body.replace('</head>', () => appHead + '</head>');
      body = body.replace('<title>Auto Scout</title>', '<title>Oblige Props</title>');
      const injection = \`<link rel="stylesheet" href="/assets/autoscout-home.css"><link rel="stylesheet" href="/assets/autoscout-reference-ui.css?v=20260913b"><link rel="stylesheet" href="/assets/autoscout-reference-ui-fixes.css?v=20260913b"><script>if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(function(){});});}</script><script>\${APEX_SHELL}</script><script src="/assets/autoscout-home.js" defer></script><script src="/assets/autoscout-tacos.js" defer></script>\`;`);
  output = output.replace(retiredFlag, 'sportsbook: false');
  return output;
}
