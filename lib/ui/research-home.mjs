/** Presentation adapter only. Research state, APIs and calculations stay in v5. */
export function researchClient(source) {
  const shell = '<div class="as5" id="as5">';
  if (!source.includes(shell)) throw new Error('Oblige Props shell changed; review research-home integration.');
  // Retire wagering presentation, not user data. Existing server-bound Save stays intact.
  const slip = '<aside class="asSlipDrawer" id="asSlip" aria-label="Betslip"></aside>';
  const add = source.split('\n').find(line => line.includes('<button class="asBtn asSlipAdd"'));
  let client = source.replace(slip, '');
  if (add) client = client.replace(add, '');
  client = client.replace(",[\'Betslip\',limits.slipSize+\' picks\']", '')
    .replace("['Ask Claude',remainingText(left.ask,limits.askPerDay)]", "['Ask Oblige Props',remainingText(left.ask,limits.askPerDay)]");
  const sports = "var SPORTS=['NFL','NBA','MLB','NHL','WNBA','NCAAF','NCAAB','MLS','EPL','UCL'];";
  if (client.includes(sports)) client = client.replace(sports, "var SPORTS=['NFL','NBA','MLB','NHL','WNBA','NCAAF','NCAAB','SOCCER','TENNIS'];");

  // Reuse the existing server-backed account menu, but pin it to the top-right
  // of the app instead of making it part of the horizontally constrained header.
  const oldProfile = '<details class="asProfileMenu" id="asProfileMenu"><summary aria-label="Account menu">Account</summary><div class="asProfileDropdown"><strong>Auto Scout account</strong><button class="asBtn" id="asAccount">Manage account &amp; billing</button><button class="asBtn" data-view="saved">Saved props</button><button class="asBtn" id="asSettings">Display settings</button><button class="asBtn" id="asMenuSignOut">Sign out</button></div></details>';
  const newProfile = '<details class="asProfileMenu" id="asProfileMenu"><summary aria-label="Account &amp; security menu" title="Account &amp; security"><svg class="asAccountIcon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4.5 20c.8-4.1 3.3-6.2 7.5-6.2s6.7 2.1 7.5 6.2"></path></svg><span class="asProfileText">Account</span></summary><div class="asProfileDropdown"><strong>Oblige Props account</strong><button class="asBtn" id="asAccount">Account &amp; security</button><button class="asBtn" id="asSecurity">Security &amp; devices</button><button class="asBtn" id="asMenuReset">Reset password</button><button class="asBtn" id="asMenuSaved" data-view="saved">Saved props</button><button class="asBtn" id="asSettings">Display settings</button><button class="asBtn asProfileSignOut" id="asMenuSignOut">Sign out</button></div></details>';
  if (client.includes(oldProfile)) client = client.replace(oldProfile, newProfile);

  const headerHook = " document.getElementById('asRefresh').onclick=()=>load();";
  if (!client.includes('accountRoot.appendChild(profileMenu)') && client.includes(headerHook)) {
    client = client.replace(headerHook, " var profileMenu=document.getElementById('asProfileMenu'),accountRoot=document.getElementById('as5');if(profileMenu&&accountRoot){profileMenu.classList.add('asHeaderAccount');accountRoot.appendChild(profileMenu);}\n" + headerHook);
  }

  // Staff entries are derived only from server-issued capabilities returned by
  // /api/account/me. Every protected route checks authorization again server-side.
  // Some unit fixtures intentionally exercise only presentation transforms and do
  // not include the account-nav block, so staff injection is best-effort here.
  const accountButton = " if(button){button.textContent=account.authenticated?'Account':'Sign in';button.classList.toggle('asPrimary',!account.authenticated);}";
  const ownerMarker = "control.textContent='Control';control.href='/owner';";
  if (!client.includes(ownerMarker) && client.includes(accountButton)) {
    client = client.replace(accountButton, accountButton + "\n var existingControl=document.getElementById('asOwnerControl');if(existingControl)existingControl.remove();var existingSupport=document.getElementById('asSupportControl');if(existingSupport)existingSupport.remove();\n if(account.authenticated&&me.data&&me.data.capabilities&&me.data.capabilities.viewSupportConsole===true&&button){var support=document.createElement('a');support.id='asSupportControl';support.className='asBtn';support.textContent='Support';support.href='/support';button.parentNode.insertBefore(support,button);}\n if(account.authenticated&&me.data&&me.data.capabilities&&me.data.capabilities.viewOwnerConsole===true&&button){var control=document.createElement('a');control.id='asOwnerControl';control.className='asBtn';control.textContent='Control';control.href='/owner';button.parentNode.insertBefore(control,button);}");
  }

  // Reflect authentication state in the pinned menu itself. Owner/support links
  // remain governed exclusively by server-issued capabilities above.
  const accountUxMarker = "profileText.textContent=account.authenticated?'Account':'Sign in';";
  if (!client.includes(accountUxMarker) && client.includes(accountButton)) {
    client = client.replace(accountButton, accountButton
      + "\n var profileText=document.querySelector('#asProfileMenu .asProfileText');if(profileText){profileText.textContent=account.authenticated?'Account':'Sign in';}"
      + "var profileSummary=document.querySelector('#asProfileMenu summary');if(profileSummary){profileSummary.setAttribute('aria-label',account.authenticated?'Account & security menu':'Sign in or create account');profileSummary.title=account.authenticated?'Account & security':'Sign in or create account';}"
      + "var securityButton=document.getElementById('asSecurity');if(securityButton)securityButton.hidden=!account.authenticated;"
      + "var resetButton=document.getElementById('asMenuReset');if(resetButton)resetButton.hidden=account.authenticated;"
      + "var savedButton=document.getElementById('asMenuSaved');if(savedButton)savedButton.hidden=!account.authenticated;"
      + "var signOutButton=document.getElementById('asMenuSignOut');if(signOutButton)signOutButton.hidden=!account.authenticated;"
      + "if(button)button.textContent=account.authenticated?'Account & security':'Sign in / Create account';");
  }

  const settingsHook = " document.getElementById('asSettings').onclick=settingsPanel;";
  const accountHandlersMarker = "var resetMenu=document.getElementById('asMenuReset');if(resetMenu)resetMenu.onclick=()=>authPanel('forgot','');";
  if (!client.includes(accountHandlersMarker) && client.includes(settingsHook)) {
    client = client.replace(settingsHook, settingsHook
      + "\n var securityMenu=document.getElementById('asSecurity');if(securityMenu)securityMenu.onclick=accountPanel;"
      + "\n var resetMenu=document.getElementById('asMenuReset');if(resetMenu)resetMenu.onclick=()=>authPanel('forgot','');");
  }

  // Defense in depth: the frontdoor gate is authoritative, but the client must
  // also refuse to render or fetch the prop board until /api/account/me confirms
  // an authenticated account. If account state cannot be loaded, fail closed.
  const insecureBoot = "shell();reportSigninRedirect();loadAccount();loadSaved().then(()=>{savedRouteReady=true;if(!loading){renderListLight();syncPropRoute();}});load();";
  const secureBoot = "shell();reportSigninRedirect();loadAccount().then(async()=>{if(!account.authenticated&&accountHealth?.gate?.active!==false){location.replace('/');return;}await loadSaved();savedRouteReady=true;if(!loading){renderListLight();syncPropRoute();}load();});";
  if (!client.includes(secureBoot)) {
    if (!client.includes(insecureBoot)) throw new Error('Oblige Props account boot changed; refusing to serve an unverified prop board.');
    client = client.replace(insecureBoot, secureBoot);
  }

  // A logout or any other auth transition that ends unauthenticated must remove
  // the dashboard immediately instead of leaving already-rendered props visible.
  const insecureAfterAuth = " await loadAccount();\n await loadSaved();";
  const secureAfterAuth = " await loadAccount();\n if(!account.authenticated&&accountHealth?.gate?.active!==false){location.replace('/');return;}\n await loadSaved();";
  if (!client.includes(secureAfterAuth)) {
    if (!client.includes(insecureAfterAuth)) throw new Error('Oblige Props auth-change flow changed; review the fail-closed redirect.');
    client = client.replace(insecureAfterAuth, secureAfterAuth);
  }

  // The public access-code path is member-only. Owner access is through the
  // designated owner account, so never advertise the legacy owner password here.
  client = client.replace('Access code or owner password', 'Access code');

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
    .replace('</form>', '<p style="margin:12px 0 0;text-align:center;font-size:13px"><a href="/reset-password.html" style="color:#8fb9ff;text-decoration:none">Forgot password?</a></p></form>')
    .replace('Calibrated AI projections', 'Game-log-grounded projections')
    .replace('Betslip with Kelly sizing', 'Saved research &amp; evidence briefs')
    .replace('Stake suggestions from your own bankroll, capped, with correlation warnings.', 'Keep your prop research together. Open an evidence brief with the underlying numbers and clearly labeled gaps.')
    .replace('Pushes excluded, never estimated.', 'Pushes shown separately; unavailable results are never invented.')
    .replace('Up to eighteen sportsbooks on one row, so the best number is visible instead of hunted.', 'Compare the available books for the same player and market, with the active line and source visible.')
    .split('Auto Scout').join('Oblige Props')
    .split('AUTOSCOUT').join('OBLIGE PROPS');
}
