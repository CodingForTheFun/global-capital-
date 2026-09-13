/** Presentation adapter only. Research state, APIs and calculations stay in v5. */
export function researchClient(source) {
  const shell = '<div class="as5" id="as5">';
  if (!source.includes(shell)) throw new Error('Oblige Props shell changed; review research-home integration.');
  // Retire wagering presentation, not user data. Existing server-bound Save stays intact.
  const slip = '<aside class="asSlipDrawer" id="asSlip" aria-label="Betslip"></aside>';
  const add = source.split('\n').find(line => line.includes('<button class="asBtn asSlipAdd"'));
  let client = source.replace(slip, '');
  if (add) client = client.replace(add, '');
  client = client.replace(",['Betslip',limits.slipSize+' picks']", '')
    .replace("['Ask Claude',remainingText(left.ask,limits.askPerDay)]", "['Ask Oblige Props',remainingText(left.ask,limits.askPerDay)]");
  const sports = "var SPORTS=['NFL','NBA','MLB','NHL','WNBA','NCAAF','NCAAB','MLS','EPL','UCL'];";
  if (client.includes(sports)) client = client.replace(sports, "var SPORTS=['NFL','NBA','MLB','NHL','WNBA','NCAAF','NCAAB','TENNIS','MLS','EPL','UCL'];");
  // Customer-facing rename only. Internal route names, storage keys and service
  // identifiers stay untouched so this cannot break existing accounts or data.
  client = client.split('Auto Scout').join('Oblige Props')
    .split('AUTOSCOUT').join('OBLIGE PROPS');
  return client;
}

const IOS_WEB_APP_HEAD = '<meta name="mobile-web-app-capable" content="yes">'
  + '<meta name="apple-mobile-web-app-capable" content="yes">'
  + '<meta name="apple-mobile-web-app-title" content="Oblige Props">'
  + '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">'
  + '<link rel="apple-touch-icon" href="/icon.svg">';

export function researchLanding(html) {
  // Leave the existing form, sign-in endpoints and safe next target untouched.
  return html.replace('<body>', '<body class="asResearchGate">')
    .replace('</head>', `${IOS_WEB_APP_HEAD}<link rel="stylesheet" href="/assets/autoscout-home.css"><link rel="manifest" href="/manifest.webmanifest"></head>`)
    .replace('Calibrated AI projections', 'Game-log-grounded projections')
    .replace('Betslip with Kelly sizing', 'Saved research &amp; evidence briefs')
    .replace('Stake suggestions from your own bankroll, capped, with correlation warnings.', 'Keep your prop research together. Open an evidence brief with the underlying numbers and clearly labeled gaps.')
    .replace('Pushes excluded, never estimated.', 'Pushes shown separately; unavailable results are never invented.')
    .replace('Up to eighteen sportsbooks on one row, so the best number is visible instead of hunted.', 'Compare the available books for the same player and market, with the active line and source visible.')
    .split('Auto Scout').join('Oblige Props')
    .split('AUTOSCOUT').join('OBLIGE PROPS');
}
