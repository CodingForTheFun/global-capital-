function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Player detail reference patch could not locate ${label}.`);
  return source.replace(from, to);
}

function replaceBlock(source, start, end, replacement, label) {
  const from = source.indexOf(start);
  if (from < 0) throw new Error(`Player detail reference patch could not locate ${label} start.`);
  const to = source.indexOf(end, from);
  if (to < 0) throw new Error(`Player detail reference patch could not locate ${label} end.`);
  return source.slice(0, from) + replacement + source.slice(to + end.length);
}

const MARKER = '/* autoscout-player-detail-reference-v1 */';

const HELPERS = String.raw`
function detailRefPeriodLabel(market){
 var value=String(market||'');
 if(/\b(?:1q|1st quarter|first quarter)\b/i.test(value))return'1Q';
 if(/\b(?:2q|2nd quarter|second quarter)\b/i.test(value))return'2Q';
 if(/\b(?:3q|3rd quarter|third quarter)\b/i.test(value))return'3Q';
 if(/\b(?:4q|4th quarter|fourth quarter)\b/i.test(value))return'4Q';
 if(/\b(?:1h|1st half|first half)\b/i.test(value))return'1H';
 if(/\b(?:2h|2nd half|second half)\b/i.test(value))return'2H';
 if(/\b(?:1i|1st inning|first inning)\b/i.test(value))return'1I';
 if(/\b(?:f5|first 5|first five)\b/i.test(value))return'F5';
 return'Full Game';
}
function detailRefBaseMarket(market){
 return String(market||'')
  .replace(/\b(?:1q|2q|3q|4q|1h|2h|1i|f5|1st quarter|2nd quarter|3rd quarter|4th quarter|first quarter|second quarter|third quarter|fourth quarter|1st half|2nd half|first half|second half|1st inning|first inning|first 5|first five)\b/ig,' ')
  .replace(/\s+/g,' ').trim().toLowerCase();
}
function detailRefPeriodHtml(g){
 var all=playerMarketGroups(g),base=detailRefBaseMarket(g.market),seen=new Set();
 var items=all.filter(function(x){return detailRefBaseMarket(x.market)===base;}).filter(function(x){var p=detailRefPeriodLabel(x.market);if(seen.has(p))return false;seen.add(p);return true;});
 if(!items.length)items=[g];
 return '<div class="asPeriodPills" aria-label="Game period">'+items.map(function(x){var label=detailRefPeriodLabel(x.market);return '<button type="button" class="asPeriodPill '+(x.key===g.key?'on':'')+'" data-market-key="'+esc(x.key)+'" aria-pressed="'+(x.key===g.key)+'">'+esc(label)+'</button>';}).join('')+'</div>';
}
function detailRefDecorateDrawer(g,base,line,side){
 var head=document.querySelector('.asDrawerHead'),title=document.getElementById('asDrawerTitle'),sub=document.getElementById('asDrawerSub');
 var team=displayTeam(g.team||base?.player?.team||base?.context?.team||''),position=g.position||base?.context?.position||base?.context?.playerPosition||'';
 if(sub)sub.textContent=[team,g.awayTeam&&g.homeTeam?g.awayTeam+' @ '+g.homeTeam:'',when(g.gameStartTime)].filter(Boolean).join(' · ');
 if(title&&position){var pos=document.createElement('span');pos.id='asDrawerPosition';pos.className='asDrawerPosition';pos.textContent=position;title.appendChild(pos);}
 var avatar=document.querySelector('.asDrawerAvatar');if(avatar)avatar.setAttribute('data-team',team?team.slice(0,3).toUpperCase():'');
 var over=bestPrice(g,'OVER',line,true),under=bestPrice(g,'UNDER',line,true),sameBook=over&&under&&over.sportsbookKey===under.sportsbookKey;
 var bookName=String((sameBook&&over?.sportsbook)||(over?.sportsbook)||(under?.sportsbook)||'Best lines');
 if(head){var odds=document.getElementById('asHeaderOdds');if(!odds){odds=document.createElement('div');odds.id='asHeaderOdds';odds.className='asHeaderOdds';head.appendChild(odds);}odds.innerHTML='<span class="asHeaderBookIcon" aria-hidden="true">'+esc((initials(bookName)||'B').slice(0,1))+'</span><span class="asHeaderBook"><b>'+esc(bookName)+'</b><small><i>O '+esc(money(over?.price))+'</i><i>U '+esc(money(under?.price))+'</i></small></span>';}
 var stat=document.querySelector('.asDetailStatHeading');if(stat&&!stat.querySelector('.asPeriodPills'))stat.insertAdjacentHTML('beforeend',detailRefPeriodHtml(g));
 var marketByKey=new Map(playerMarketGroups(g).map(function(x){return[x.key,x];}));
 document.querySelectorAll('.asMarketQuickButton[data-market-key]').forEach(function(button){if(button.querySelector('.asMarketLineCount'))return;var target=marketByKey.get(button.dataset.marketKey),count=uniq((target?.rows||[]).map(function(row){return num(row.line);}).filter(function(value){return value!=null;})).length;if(!count)return;var badge=document.createElement('span');badge.className='asMarketLineCount';badge.textContent=String(count);button.appendChild(badge);});
 var sideToggle=document.querySelector('.asSideToggle');if(sideToggle){var mini=sideToggle.querySelector('.asBookMini');if(!mini){mini=document.createElement('span');mini.className='asBookMini';sideToggle.prepend(mini);}mini.innerHTML='<span class="asBookMiniIcon" aria-hidden="true">'+esc((initials(bookName)||'B').slice(0,1))+'</span><span class="asBookMiniName">'+esc(bookName)+'</span>';sideToggle.querySelectorAll('[data-side]').forEach(function(button){var pick=button.dataset.side,q=bestPrice(g,pick,line,true);button.innerHTML='<span>'+esc(pick==='OVER'?'O':'U')+'</span><b>'+esc(money(q?.price))+'</b>';});}
 document.querySelectorAll('.asSection').forEach(function(section){var label=String(section.querySelector('.asSectionTitle h3')?.textContent||'').trim().toLowerCase();if(label==='game-by-game performance')section.classList.add('asGameChartSection');if(label==='supporting stats')section.classList.add('asSupportingStatsSection');});
}
`;

const CHART = String.raw`function chartHtml(r){
 var rows=filteredGames(r).slice().reverse(),line=num(drawerState?.line);
 if(!rows.length)return'<div class="asChartEmpty">'+(drawerState?.window==='season'?'No current regular-season historical results are available.':'Historical game data is unavailable for this selection.')+'</div>';
 var numeric=rows.map(function(x){return num(x.value);}).filter(function(value){return value!=null;}),low=Math.min(0,line??0,...numeric),high=Math.max(1,line??0,...numeric),span=high-low||1;
 high+=span*.12;low-=low<0?span*.12:0;span=high-low;
 var position=value=>(value-low)/span*100;
 return'<div class="asChartWrap" tabindex="0" role="region" aria-label="Game performance chart, scroll for more games"><div class="asChart" style="min-width:'+Math.max(320,rows.length*38)+'px">'+(line!=null?'<div class="asThreshold" style="bottom:'+position(line)+'%"><span>LINE '+esc(dec(line))+'</span></div>':'')+'<div class="asZeroLine" style="bottom:'+position(0)+'%"></div>'+rows.map(function(x){var value=num(x.value),date=shortDate(x.date),opponent=x.opponent||'Opponent unavailable';if(value==null)return'<button type="button" class="asBarCol dnp" data-game-detail="'+esc(date+' · '+opponent+' · DNP')+'" aria-label="'+esc(date+' '+opponent+' did not play')+'"><span class="asChartBar dnp"><span class="asBarVal">DNP</span></span><span class="asBarLabel"><span>'+esc(date)+'</span><span>'+esc(x.isHome===false?'@'+opponent:opponent)+'</span></span></button>';var className=x.push?'push':line!=null&&value>line?'above':line!=null&&value<line?'below':'unknown';return'<button type="button" class="asBarCol" data-game-detail="'+esc(date+' · '+opponent+' · '+value+' · '+(x.push?'Push':x.hit===true?'Hit':x.hit===false?'Miss':'Result unavailable'))+'" aria-label="'+esc(date+' '+opponent+' result '+value)+'"><span class="asChartBar '+className+'" style="position:absolute;bottom:'+position(Math.min(0,value))+'%;height:'+Math.max(2,Math.abs(value)/span*100)+'%"><span class="asBarVal">'+esc(value)+'</span></span><span class="asBarLabel"><span>'+esc(date)+'</span><span>'+esc(x.isHome===false?'@'+opponent:opponent)+'</span></span></button>';}).join('')+'</div></div>';
}
function secondaryHeaders(s,marketId){`;

const CSS = String.raw`
${MARKER}
#as5 .asDetailPage:not([hidden]){background:#0B0F19!important}
#as5 .asDrawer.asAnalyticsPage{width:min(880px,100%)!important;background:#0B0F19!important;border-left:1px solid rgba(148,163,184,.12)!important;padding-bottom:calc(72px + env(safe-area-inset-bottom))!important}
#as5 .asDrawerHead{position:sticky!important;top:0!important;z-index:40!important;display:grid!important;grid-template-columns:54px minmax(0,1fr) minmax(118px,142px)!important;gap:10px!important;align-items:center!important;padding:43px 12px 10px!important;background:rgba(11,15,25,.96)!important;border-bottom:1px solid rgba(148,163,184,.10)!important;backdrop-filter:blur(20px)!important;-webkit-backdrop-filter:blur(20px)!important}
#as5 .asDrawerHead:before{content:"Auto Scout";position:absolute;top:12px;left:50%;transform:translateX(-50%);font-size:14px;font-weight:850;letter-spacing:-.02em;color:#f8fafc;white-space:nowrap}
#as5 .asClose{position:absolute!important;left:10px!important;top:6px!important;width:auto!important;height:34px!important;padding:0!important;border:0!important;background:transparent!important;border-radius:0!important;color:#9fb9dc!important;font-size:12px!important;font-weight:750!important}
#as5 .asClose .asBackText:before{content:"← ";font-size:16px;vertical-align:-1px}
#as5 .asClose>span[aria-hidden="true"]{display:none!important}
#as5 .asDrawerAvatar{position:relative!important;width:52px!important;height:52px!important;overflow:visible!important;border:1px solid rgba(113,151,206,.5)!important;background:#131B2E!important;box-shadow:none!important}
#as5 .asDrawerAvatar img{width:100%!important;height:100%!important;object-fit:cover!important;border-radius:50%!important;background:#131B2E!important}
#as5 .asDrawerAvatar:after{content:attr(data-team);position:absolute;right:-5px;bottom:-4px;display:grid;place-items:center;min-width:21px;height:21px;padding:0 3px;border:2px solid #0B0F19;border-radius:999px;background:#253659;color:#fff;font-size:6px;font-weight:900;letter-spacing:-.02em}
#as5 .asDrawerHead h2{display:flex!important;align-items:center!important;gap:7px!important;margin:0!important;font-size:18px!important;font-weight:850!important;letter-spacing:-.035em!important;line-height:1.05!important}
#as5 .asDrawerPosition{font-size:9px!important;font-weight:800!important;letter-spacing:.02em!important;color:#8e9bae!important}
#as5 .asDrawerHead p{margin:5px 0 0!important;color:#8996aa!important;font-size:9px!important;line-height:1.25!important;white-space:normal!important}
#as5 .asHeaderOdds{min-width:0;display:grid;grid-template-columns:27px minmax(0,1fr);gap:7px;align-items:center;padding:7px 8px;border:1px solid rgba(96,134,190,.28);border-radius:10px;background:#131B2E;box-shadow:none}
#as5 .asHeaderBookIcon,#as5 .asBookMiniIcon{display:grid;place-items:center;width:27px;height:27px;border-radius:50%;background:#f4f7fb;color:#111827;font-size:10px;font-weight:950}
#as5 .asHeaderBook{min-width:0;display:grid;gap:2px}.asHeaderBook b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:8px;color:#d8e1ee}.asHeaderBook small{display:flex;gap:6px;font-size:8px;font-style:normal}.asHeaderBook i{font-style:normal;font-weight:850}.asHeaderBook i:first-child{color:#45e3a1}.asHeaderBook i:last-child{color:#ff7b91}
#as5 .asDrawerBody{padding:10px 16px 28px!important}
#as5 .asDetailBooks{display:none!important}
#as5 .asDetailControls{display:grid!important;gap:9px!important;margin:0 0 9px!important;padding:0!important;border:0!important;background:transparent!important;box-shadow:none!important}
#as5 .asMarketQuick{display:flex!important;gap:4px!important;overflow-x:auto!important;padding:0 0 2px!important;scrollbar-width:none!important;-webkit-overflow-scrolling:touch}.asMarketQuick::-webkit-scrollbar{display:none}
#as5 .asMarketQuickButton{position:relative!important;flex:0 0 auto!important;display:inline-flex!important;align-items:center!important;gap:6px!important;min-height:34px!important;padding:0 11px!important;border:0!important;border-bottom:2px solid transparent!important;border-radius:8px 8px 0 0!important;background:transparent!important;color:#7e8797!important;font-size:10px!important;font-weight:800!important;white-space:nowrap!important;box-shadow:none!important}
#as5 .asMarketQuickButton.on{border-bottom-color:#4f7dff!important;background:#141b31!important;color:#fff!important}
#as5 .asMarketLineCount{display:grid;place-items:center;min-width:17px;height:17px;padding:0 4px;border-radius:999px;background:#26324a;color:#aebbd0;font-size:8px;font-weight:900}.asMarketQuickButton.on .asMarketLineCount{background:#3267df;color:#fff}
#as5 .asDetailStatHeading{display:flex!important;align-items:center!important;gap:8px!important;justify-content:space-between!important;min-width:0!important;padding:2px 0!important}
#as5 .asDetailStatHeading h2{min-width:0!important;margin:0!important;font-size:18px!important;font-weight:800!important;letter-spacing:-.03em!important;line-height:1.15!important;text-transform:none!important}
#as5 .asPeriodPills{display:flex;align-items:center;justify-content:flex-end;gap:4px;overflow-x:auto;scrollbar-width:none}.asPeriodPills::-webkit-scrollbar{display:none}.asPeriodPill{flex:0 0 auto;height:30px;padding:0 10px;border:1px solid rgba(148,163,184,.16);border-radius:999px;background:#111722;color:#8792a2;font-size:9px;font-weight:850}.asPeriodPill.on{border-color:#3776ff;background:#153a78;color:#cfe0ff}
#as5 .asDetailLineRow{display:flex!important;align-items:center!important;gap:6px!important;min-width:0!important;margin:0!important}
#as5 .asLineCtl{flex:0 0 auto!important;display:grid!important;grid-template-columns:34px 64px 34px!important;gap:0!important;height:38px!important;overflow:hidden!important;border:1px solid rgba(148,163,184,.15)!important;border-radius:10px!important;background:#111722!important}
#as5 .asLineBtn{height:36px!important;border:0!important;border-radius:0!important;background:transparent!important;color:#e8eef7!important;font-size:18px!important}.asLineBtn:hover{background:#182238!important}
#as5 .asLineVal{width:64px!important;height:36px!important;border:0!important;border-left:1px solid rgba(148,163,184,.12)!important;border-right:1px solid rgba(148,163,184,.12)!important;border-radius:0!important;background:#151d31!important;color:#fff!important;font-size:16px!important;text-align:center!important;box-shadow:none!important}
#as5 .asSideToggle{flex:1 1 210px!important;min-width:0!important;display:grid!important;grid-template-columns:minmax(74px,1.2fr) repeat(2,minmax(58px,.8fr))!important;gap:2px!important;align-items:center!important;margin:0!important;padding:3px!important;border:1px solid rgba(96,134,190,.24)!important;border-radius:10px!important;background:#111722!important;overflow:hidden!important}
#as5 .asBookMini{min-width:0;display:flex;align-items:center;gap:6px;padding:0 5px}.asBookMiniIcon{width:24px!important;height:24px!important;font-size:9px!important}.asBookMiniName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#9ba9bc;font-size:8px;font-weight:800}
#as5 .asSideBtn{display:flex!important;align-items:center!important;justify-content:center!important;gap:4px!important;height:30px!important;padding:0 5px!important;border:0!important;border-radius:7px!important;background:transparent!important;color:#8691a0!important;font-size:9px!important;font-weight:850!important}.asSideBtn b{font-size:8px!important}.asSideBtn.on.over{background:#0c4b39!important;color:#74f1bd!important;box-shadow:inset 0 0 0 1px #177154!important}.asSideBtn.on.under{background:#482330!important;color:#ff9aae!important;box-shadow:inset 0 0 0 1px #744052!important}
#as5 .asDetailSave{flex:0 0 38px!important;width:38px!important;height:38px!important;padding:0!important;border:1px solid rgba(148,163,184,.16)!important;border-radius:10px!important;background:#111722!important;color:#8290a4!important;font-size:22px!important;box-shadow:none!important}.asDetailSave.on{color:#ffd669!important}
#as5 .asPropFilterGrid{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr)) 38px!important;gap:6px!important;align-items:end!important;min-width:0!important}.asPropFilterGrid>label{min-width:0!important;display:grid!important;gap:4px!important;color:#7f8b9e!important;font-size:7px!important;font-weight:800!important}.asPropFilterGrid .asControl{width:100%!important;height:36px!important;padding:0 8px!important;border:1px solid rgba(96,134,190,.23)!important;border-radius:9px!important;background:#131B2E!important;color:#eef3fb!important;font-size:9px!important;box-shadow:none!important}
#as5 .asFilterMenu{position:relative!important;margin:0!important}.asFilterMenu>summary{list-style:none!important;display:grid!important;place-items:center!important;width:38px!important;height:36px!important;border:1px solid rgba(96,134,190,.23)!important;border-radius:9px!important;background:#131B2E!important;color:#9caac0!important;cursor:pointer!important}.asFilterMenu>summary::-webkit-details-marker{display:none}.asFilterMenu[open]>summary{border-color:#4a79c4!important;color:#d9e6fb!important}.asFilterSliders{width:16px;height:16px}.asAdvancedFilterPanel{position:absolute;right:0;top:42px;z-index:50;width:min(320px,calc(100vw - 32px));display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:10px;border:1px solid rgba(96,134,190,.3);border-radius:12px;background:#111827;box-shadow:0 18px 42px rgba(0,0,0,.45)}.asAdvancedFilterPanel label{display:grid;gap:4px;color:#8895a9;font-size:8px}.asAdvancedFilterPanel .asControl{height:34px!important}.asCompactClearFilters{grid-column:1/-1!important;height:32px!important;border:1px solid rgba(148,163,184,.12)!important;border-radius:8px!important;background:#151d2d!important;color:#96a2b5!important;font-size:8px!important;font-weight:800!important}.asCompactClearFilters:disabled{opacity:.45}
#as5 .asFilterHint,#as5 .asLegacyVenue{display:none!important}
#as5 .asResearchTabs{position:sticky!important;top:112px!important;z-index:25!important;display:flex!important;gap:3px!important;overflow-x:auto!important;margin:7px 0 8px!important;padding:3px!important;border:1px solid rgba(148,163,184,.10)!important;border-radius:10px!important;background:rgba(12,17,27,.94)!important;scrollbar-width:none!important;backdrop-filter:blur(14px)!important}.asResearchTabs::-webkit-scrollbar{display:none}.asResearchTab{flex:0 0 auto!important;height:30px!important;padding:0 10px!important;border:0!important;border-radius:7px!important;background:transparent!important;color:#7f8a9a!important;font-size:8px!important;font-weight:800!important}.asResearchTab[aria-selected="true"]{background:#19233a!important;color:#e9f0fb!important;box-shadow:inset 0 0 0 1px rgba(80,120,190,.28)!important}
#as5 .asTrendPills{margin:0 0 8px!important}.asTrendPills .asWindows,#as5 .asWindows{display:flex!important;gap:0!important;overflow-x:auto!important;padding:0!important;border:1px solid rgba(148,163,184,.10)!important;border-radius:10px!important;background:#0c111c!important;scrollbar-width:none!important}.asWindows::-webkit-scrollbar{display:none}.asWindow{flex:1 0 86px!important;min-height:62px!important;padding:7px 9px!important;border:0!important;border-right:1px solid rgba(148,163,184,.08)!important;border-radius:0!important;background:transparent!important;color:#eaf0f8!important;box-shadow:none!important}.asWindow:last-child{border-right:0!important}.asWindow.on{position:relative!important;z-index:1!important;background:#172037!important;box-shadow:inset 0 0 0 1px #4768c7!important}.asWindow small{font-size:8px!important;color:#9aa6b8!important}.asWindow b{font-size:13px!important;margin-top:3px!important}.asWindow em{font-size:8px!important;color:#55e6ad!important;margin-top:2px!important}.asWindow span{font-size:7px!important;color:#717d8f!important}
#as5 .asGameChartSection{border:0!important;border-radius:0!important;background:transparent!important;margin:0 0 10px!important;overflow:visible!important}.asGameChartSection>.asSectionTitle{display:none!important}.asGameChartSection>.asSectionBody{padding:0!important}.asChartLegend{display:none!important}
#as5 .asChartWrap{overflow-x:auto!important;border:1px solid rgba(148,163,184,.09)!important;border-radius:12px!important;background:linear-gradient(180deg,#101b20 0%,#0a1414 72%,#0B0F19 100%)!important;scrollbar-width:none!important}.asChartWrap::-webkit-scrollbar{display:none}.asChart{height:270px!important;display:flex!important;align-items:stretch!important;gap:5px!important;padding:23px 8px 42px!important;border-radius:12px!important;background:transparent!important}.asThreshold{border-top:1px solid rgba(75,210,154,.32)!important}.asThreshold span{position:absolute;right:3px;top:-17px;color:#6eaa91;font-size:7px;font-weight:800}.asBarCol{min-width:26px!important}.asChartBar{width:100%!important;max-width:42px!important;border:1px solid rgba(41,190,134,.34)!important;border-radius:7px 7px 2px 2px!important;background:linear-gradient(180deg,#34e7a1,#16a973)!important;box-shadow:0 0 16px rgba(33,210,146,.12)!important}.asChartBar.above{background:linear-gradient(180deg,#39efaa,#14c081)!important;border-color:#2be09b!important}.asChartBar.below{background:linear-gradient(180deg,#21674f,#133b30)!important;border-color:#285c4a!important;box-shadow:none!important}.asChartBar.push{background:linear-gradient(180deg,#2f8a68,#1c5945)!important;border-color:#397b62!important;box-shadow:none!important}.asChartBar.unknown{background:#1d3a31!important;border-color:#31564a!important;box-shadow:none!important}.asChartBar.dnp{position:absolute!important;bottom:0!important;height:66px!important;min-height:66px!important;border:2px dashed #566176!important;background:transparent!important;box-shadow:none!important}.asBarVal{top:-18px!important;color:#eef7f3!important;font-size:8px!important;font-weight:900!important}.asChartBar.dnp .asBarVal{top:50%!important;transform:translate(-50%,-50%)!important;color:#7d8798!important;font-size:7px!important}.asBarLabel{bottom:-35px!important;display:grid!important;gap:2px!important;width:52px!important;color:#7d8795!important;font-size:7px!important;line-height:1.05!important;text-align:center!important}.asBarLabel span:first-child{color:#9aa5b3!important}.asBarLabel span:last-child{color:#687486!important}
#as5 .asSupportingStatsSection{border:1px solid rgba(148,163,184,.10)!important;border-radius:12px!important;background:#131B2E!important;margin:10px 0!important}.asSupportingStatsSection>.asSectionTitle{padding:9px 12px!important;border-bottom:1px solid rgba(148,163,184,.08)!important}.asSupportingStatsSection>.asSectionTitle h3{font-size:9px!important;text-transform:none!important;letter-spacing:.01em!important;color:#dbe4f0!important}.asSupportingStatsSection>.asSectionBody{padding:10px 12px!important}.asSupportingStatsSection .asSupportingStats,.asSupportingStatsSection .asContext,.asSupportingStatsSection .asSecondaryStats{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:0!important}.asSupportingStatsSection .asCtx,.asSupportingStatsSection .asProjectedStat{min-width:0!important;padding:7px 9px!important;border:0!important;border-right:1px solid rgba(148,163,184,.08)!important;border-radius:0!important;background:transparent!important;text-align:center!important}.asSupportingStatsSection .asCtx:nth-child(3n),.asSupportingStatsSection .asProjectedStat:nth-child(3n){border-right:0!important}
#as5 .asDetailModels{margin-top:8px!important;border:1px solid rgba(148,163,184,.08)!important;border-radius:10px!important;background:#0d131e!important}.asDetailModels>summary{padding:9px 11px!important;color:#8190a4!important;font-size:8px!important;font-weight:800!important}
@media(max-width:650px){
 #as5 .asDrawer.asAnalyticsPage{border-left:0!important}
 #as5 .asDrawerHead{grid-template-columns:48px minmax(0,1fr)!important;padding:42px 10px 9px!important}
 #as5 .asHeaderOdds{grid-column:1/-1!important;margin-top:3px!important;grid-template-columns:26px minmax(0,1fr)!important;padding:6px 8px!important}
 #as5 .asHeaderBook small{justify-content:flex-start!important}
 #as5 .asDrawerAvatar{width:46px!important;height:46px!important}
 #as5 .asDrawerHead h2{font-size:16px!important}
 #as5 .asDrawerBody{padding:8px 12px 18px!important}
 #as5 .asDetailStatHeading{align-items:flex-start!important}.asDetailStatHeading h2{font-size:16px!important}
 #as5 .asPeriodPills{max-width:54%!important}
 #as5 .asDetailLineRow{gap:5px!important}
 #as5 .asLineCtl{grid-template-columns:31px 55px 31px!important;height:36px!important}.asLineVal{width:55px!important;height:34px!important;font-size:15px!important}.asLineBtn{height:34px!important}
 #as5 .asSideToggle{flex-basis:168px!important;grid-template-columns:minmax(54px,1.1fr) repeat(2,minmax(45px,.8fr))!important}.asBookMiniName{display:none!important}.asBookMini{padding:0 2px!important;justify-content:center!important}.asBookMiniIcon{width:22px!important;height:22px!important}.asSideBtn{height:28px!important;padding:0 3px!important}.asSideBtn b{font-size:7px!important}
 #as5 .asDetailSave{flex-basis:36px!important;width:36px!important;height:36px!important}
 #as5 .asPropFilterGrid{display:flex!important;gap:5px!important;overflow-x:auto!important;align-items:flex-end!important;scrollbar-width:none!important}.asPropFilterGrid::-webkit-scrollbar{display:none}.asPropFilterGrid>label{flex:0 0 91px!important}.asPropFilterGrid .asControl{height:34px!important}.asFilterMenu{flex:0 0 36px!important}.asFilterMenu>summary{width:36px!important;height:34px!important}
 #as5 .asResearchTabs{top:145px!important;margin:6px 0 7px!important}
 #as5 .asResearchTab{height:28px!important;padding:0 9px!important}
 #as5 .asWindow{flex-basis:78px!important;min-height:58px!important;padding:6px 8px!important}.asWindow b{font-size:12px!important}
 #as5 .asChart{height:245px!important;padding-top:22px!important;padding-bottom:39px!important;gap:4px!important}.asBarCol{min-width:23px!important}.asChartBar{max-width:38px!important}.asBarLabel{font-size:6px!important;width:44px!important}
 #as5 .asSupportingStatsSection .asCtx,#as5 .asSupportingStatsSection .asProjectedStat{padding:6px 4px!important}
}
`;

export function patchPlayerDetailReferenceUi(source) {
  let out = String(source || '');
  if (out.includes(MARKER)) return out;

  out = replaceOnce(out, 'function renderDrawer(){', `${HELPERS}\nfunction renderDrawer(){`, 'drawer renderer');
  out = replaceBlock(out, 'function chartHtml(r){', '\nfunction secondaryHeaders(s,marketId){', CHART, 'chart renderer');
  out = replaceOnce(
    out,
    "\n keepOpen.forEach(selector=>document.querySelector(selector)?.setAttribute('open',''));",
    "\n detailRefDecorateDrawer(g,base,line,side);\n keepOpen.forEach(selector=>document.querySelector(selector)?.setAttribute('open',''));",
    'drawer decoration hook',
  );

  const styleAnchor = '<style id="oblige-props-pixel-target">';
  const styleStart = out.indexOf(styleAnchor);
  if (styleStart < 0) throw new Error('Player detail reference patch could not locate visual style anchor.');
  const styleEnd = out.indexOf('</style>', styleStart);
  if (styleEnd < 0) throw new Error('Player detail reference patch could not locate visual style terminator.');
  out = out.slice(0, styleEnd) + CSS + out.slice(styleEnd);
  return out;
}
