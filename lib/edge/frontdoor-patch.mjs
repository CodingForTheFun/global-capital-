// Asserted presentation/routing integration; never replace the research engine.
export function patchEdgeFrontdoor(source) {
  const hook = '  if (await maybeServeGate(req, res)) return;';
  const server = 'const server = http.createServer(async (req, res) => {';
  const landingImport = "import { landingPage } from './lib/auth/landing.mjs';";
  const shellRead = "readFileSync('./apex-v2/scout-ui-v5.js', 'utf8')";
  const injection = 'const injection = `<script>${APEX_SHELL}</script>`;';
  const retiredFlag = 'sportsbook: true';
  const publicSurfaceHook = '  if (servePublicSurface(req, res, { origin: SITE_ORIGIN })) return;';
  for (const anchor of [hook, server, landingImport, shellRead, injection, retiredFlag, publicSurfaceHook]) {
    if (source.split(anchor).length !== 2) throw new Error('Research-home anchors changed; review frontdoor before deploying.');
  }
  let output = "import { createEdgeGateway } from './lib/edge/gateway.mjs';\nimport { researchClient, researchLanding } from './lib/ui/research-home.mjs';\nimport { rememberSigninLanding } from './lib/ui/remember-signin.mjs';\nimport { handleAccountNoticeRoutes } from './lib/auth/account-notice-routes.mjs';\nimport { handleAdminRoutes } from './lib/auth/admin-routes.mjs';\nimport { handleAdminAccessRoutes } from './lib/auth/admin-access-routes.mjs';\nimport { handleOwnerRecoveryRoutes } from './lib/auth/owner-recovery-routes.mjs';\nimport { handleSupportRoutes } from './lib/auth/support-routes.mjs';\nimport { handleBillingRoutes } from './lib/billing/paypal-routes.mjs';\nimport { createStripeBillingHandler } from './lib/billing/stripe-routes.mjs';\nlet __stripeRoutes = null;\nimport { serveSeoPage } from './lib/web/seo-pages.mjs';\n" + source;
  const seoLandingLinks = '<nav class="seoResearchLinks" aria-label="Player prop research" style="margin:24px 0 0;color:#93a9c6;font-size:13px;line-height:1.9"><a href="/player-prop-research">Player prop research</a> · <a href="/nfl-player-props">NFL player props</a> · <a href="/nba-player-props">NBA player props</a> · <a href="/sportsbook-line-comparison">Sportsbook line comparison</a></nav>';
  const landingReplacement = [
    "import { landingPage as originalLandingPage } from './lib/auth/landing.mjs';",
    "const optimizePublicLanding = html => html",
    "  .replace('<title>Oblige Props — Prop Intelligence &amp; Line Discrepancies</title>', '<title>Oblige Props — Player Prop Research & Sportsbook Line Comparison</title>')",
    "  .replace('<meta name=\"description\" content=\"Player prop research, verified game logs and sportsbook line comparisons. Free during beta.\">', '<meta name=\"description\" content=\"Research NFL, NBA, WNBA, NCAAF and MLB player props with verified game logs, hit rates and sportsbook line comparison in Oblige Props.\">')",
    `  .replace('<footer>', ${JSON.stringify(seoLandingLinks)} + '<footer>');`,
    "const landingPage = options => optimizePublicLanding(rememberSigninLanding(researchLanding(originalLandingPage(options))));",
  ].join('\n');
  output = output.replace(landingImport, landingReplacement);
  output = output.replace(shellRead, `researchClient(${shellRead})`);
  output = output.replace(server, 'const edgeGuest = createEdgeGateway({ currentAccount, sessions: accountSessions });\n' + server);
  output = output.replace(publicSurfaceHook, '  if (serveSeoPage(req, res, { origin: SITE_ORIGIN })) return;\n' + publicSurfaceHook);
  output = output.replace(
    hook,
    "  { const noticeUrl = new URL(req.url || '/', 'http://localhost'); if (await handleAccountNoticeRoutes(req, res, noticeUrl, { sessions: accountSessions, json: directJson, secret: sessionSecret, log: console })) return; }\n"
      + '  if (await edgeGuest(req, res)) return;\n'
      + "  { const recoveryUrl = new URL(req.url || '/', 'http://localhost'); if (await handleOwnerRecoveryRoutes(req, res, recoveryUrl, { sessions: accountSessions, json: directJson, secret: sessionSecret, log: console })) return; }\n"
      + "  { const billingUrl = new URL(req.url || '/', 'http://localhost'); if (await handleBillingRoutes(req, res, billingUrl, { sessions: accountSessions, json: directJson, secret: sessionSecret, log: console })) return; }\n"
      + "  { const stripeUrl = new URL(req.url || '/', 'http://localhost'); __stripeRoutes = __stripeRoutes || createStripeBillingHandler({ json: directJson, sessions: accountSessions, secret: sessionSecret, log: console }); if (await __stripeRoutes(req, res, stripeUrl)) return; }\n"
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
