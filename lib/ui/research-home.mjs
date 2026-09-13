/** Presentation adapter only. Research state, APIs and calculations stay in v5. */
export function researchClient(source) {
  const shell = '<div class="as5" id="as5">';
  if (!source.includes(shell)) throw new Error('Auto Scout shell changed; review research-home integration.');
  // Retire wagering presentation, not user data. Existing server-bound Save stays intact.
  const slip = '<aside class="asSlipDrawer" id="asSlip" aria-label="Betslip"></aside>';
  const add = source.split('\n').find(line => line.includes('<button class="asBtn asSlipAdd"'));
  let client = source.replace(slip, '');
  if (add) client = client.replace(add, '');
  client = client.replace(",['Betslip',limits.slipSize+' picks']", '')
    .replace("['Ask Claude',remainingText(left.ask,limits.askPerDay)]", "['Ask Auto Scout',remainingText(left.ask,limits.askPerDay)]");
  return client;
}

export function researchLanding(html) {
  // Leave the existing form, sign-in endpoints and safe next target untouched.
  return html.replace('<body>', '<body class="asResearchGate">')
    .replace('</head>', '<link rel="stylesheet" href="/assets/autoscout-home.css"><link rel="manifest" href="/manifest.webmanifest"></head>')
    .replace('Calibrated AI projections', 'Game-log-grounded projections')
    .replace('Betslip with Kelly sizing', 'Saved research &amp; evidence briefs')
    .replace('Stake suggestions from your own bankroll, capped, with correlation warnings.', 'Keep your prop research together. Open an evidence brief with the underlying numbers and clearly labeled gaps.')
    .replace('Pushes excluded, never estimated.', 'Pushes shown separately; unavailable results are never invented.')
    .replace('Up to eighteen sportsbooks on one row, so the best number is visible instead of hunted.', 'Compare the available books for the same player and market, with the active line and source visible.');
}
