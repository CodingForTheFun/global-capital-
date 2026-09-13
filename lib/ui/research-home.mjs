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
    .replace("['Ask Claude',remainingText(left.ask,limits.askPerDay)]", "['Ask Auto Scout',remainingText(left.ask,limits.askPerDay)]")
    .replace("turn.role==='user'?'You':'Claude'", "turn.role==='user'?'You':'Auto Scout'")
    .replaceAll('Game log available', 'Stats available')
    .replaceAll('Game log', 'Historical results')
    .replace('Uses one paid request.', 'Uses the connected model only when you explicitly request it.');

  const sports = "var SPORTS=['NFL','NBA','MLB','NHL','WNBA','NCAAF','NCAAB','MLS','EPL','UCL'];";
  if (client.includes(sports)) client = client.replace(sports, "var SPORTS=['NFL','NBA','MLB','NHL','WNBA','NCAAF','NCAAB','TENNIS','MLS','EPL','UCL'];");

  // A prop card is a shareable page URL. The existing research engine still
  // owns the calculations; this changes navigation, not any API contract.
  const openNeedle = 'if(g)openDrawer(g);';
  if (!client.includes(openNeedle)) throw new Error('Auto Scout card-open anchor changed.');
  client = client.replace(openNeedle, "if(g){var propUrl='/props/'+encodeURIComponent(g.key);if(location.pathname!==propUrl)history.pushState({autoScoutProp:g.key},'',propUrl);openDrawer(g);}");

  const bindNeedle = "list.innerHTML=a.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE).map(rowHtml).join('');bindRows();}";
  if (!client.includes(bindNeedle)) throw new Error('Auto Scout list-render anchor changed.');
  client = client.replace(bindNeedle, "list.innerHTML=a.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE).map(rowHtml).join('');bindRows();maybeOpenPropRoute();}");

  const focusNeedle = 'function focusToken(element){';
  if (!client.includes(focusNeedle)) throw new Error('Auto Scout route-helper anchor changed.');
  client = client.replace(focusNeedle, `function maybeOpenPropRoute(){
 if(!location.pathname.startsWith('/props/'))return;
 var key='';try{key=decodeURIComponent(location.pathname.slice('/props/'.length));}catch{return;}
 if(!key||drawerState?.g?.key===key)return;
 var el=Array.from(document.querySelectorAll('[data-open]')).find(function(node){return node.dataset.open===key;});
 if(el)el.click();
}
window.addEventListener('popstate',function(){if(location.pathname.startsWith('/props/'))maybeOpenPropRoute();else if(drawerState)closeDrawer();});
${focusNeedle}`);

  const closeNeedle = "drawerState=null;if(lastFocus?.isConnected)lastFocus.focus();}";
  if (!client.includes(closeNeedle)) throw new Error('Auto Scout close-route anchor changed.');
  client = client.replace(closeNeedle, "drawerState=null;if(lastFocus?.isConnected)lastFocus.focus();if(location.pathname.startsWith('/props/'))history.pushState({},'', '/apex');}");
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
