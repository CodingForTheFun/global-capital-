import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET = 'lib/autoscout/oblige-props-visual-runtime-patch.mjs';

export function applyObligePropsPresentationPatch(root = process.cwd()) {
  const file = path.join(root, TARGET);
  if (!existsSync(file)) return { applied: false, reason: 'TARGET_MISSING' };

  let source = readFileSync(file, 'utf8');
  const before = source;

  function replaceOnceOrPresent(from, to, label) {
    if (source.includes(to)) return;
    const count = source.split(from).length - 1;
    if (count !== 1) throw new Error(`[oblige-props-presentation] ${label} anchor count=${count}`);
    source = source.replace(from, to);
  }

  replaceOnceOrPresent(
    '#as5 .asHeaderSearchIcon{font-size:23px!important;line-height:1!important;color:#9ebce2!important}',
    '#as5 .asHeaderSearchIcon{position:relative!important;display:inline-block!important;width:16px!important;height:16px!important;flex:0 0 16px!important;font-size:0!important;line-height:0!important;color:transparent!important}\n#as5 .asHeaderSearchIcon:before{content:""!important;position:absolute!important;left:1px!important;top:1px!important;width:10px!important;height:10px!important;box-sizing:border-box!important;border:2px solid #9ebce2!important;border-radius:50%!important}\n#as5 .asHeaderSearchIcon:after{content:""!important;position:absolute!important;left:10px!important;top:11px!important;width:6px!important;height:2px!important;border-radius:2px!important;background:#9ebce2!important;transform:rotate(45deg)!important;transform-origin:left center!important}',
    'CSS search icon',
  );

  replaceOnceOrPresent(
    ' #as5 .asHeaderSearchIcon{font-size:18px!important}',
    ' #as5 .asHeaderSearchIcon{font-size:0!important;line-height:0!important}',
    'mobile search icon',
  );

  replaceOnceOrPresent(
    "label.innerHTML='<span class=\"asHeaderSearchIcon\" aria-hidden=\"true\">⌕</span><input type=\"search\" autocomplete=\"off\" aria-label=\"Search props\" placeholder=\"Search players, teams, props...\">';",
    "label.innerHTML='<span class=\"asHeaderSearchIcon\" aria-hidden=\"true\"></span><input type=\"search\" autocomplete=\"off\" aria-label=\"Search props\" placeholder=\"Search players, teams, props...\">';",
    'search glyph markup',
  );

  if (!source.includes('#as5 .asBookRail{display:none!important}')) {
    const anchor = '/* Save becomes the small star in the card corner instead of a giant full-width row. */';
    const count = source.split(anchor).length - 1;
    if (count !== 1) throw new Error(`[oblige-props-presentation] legacy sportsbook rail anchor count=${count}`);
    source = source.replace(
      anchor,
      '/* The compact per-prop sportsbook selector is the customer-facing control.\n   Hide the old rail so it cannot duplicate book labels or consume mobile space. */\n#as5 .asBookRail{display:none!important}\n\n' + anchor,
    );
  }

  if (!source.includes('/* Oblige Props research-terminal desktop density pass.')) {
    const anchor = '/* Save becomes the small star in the card corner instead of a giant full-width row. */';
    const count = source.split(anchor).length - 1;
    if (count !== 1) throw new Error(`[oblige-props-presentation] research terminal anchor count=${count}`);
    const terminalCss = `/* Oblige Props research-terminal desktop density pass.
   Presentation only: live lines, hit rates, research samples, provider rows and
   the current per-prop sportsbook selector keep their existing data contracts. */
@media(min-width:1051px){
 #as5 .asMain{max-width:1720px!important;padding-top:18px!important}
 #as5 .asGrid,#as5 .asList{display:grid!important;grid-template-columns:1fr!important;gap:9px!important}
 #as5 .asSummary{gap:6px!important;margin-bottom:10px!important}
 #as5 .asSummaryItem{padding:8px 10px!important}
 #as5 .asSummaryItem b{font-size:18px!important}
 #as5 .asCard{border-radius:13px!important;box-shadow:0 9px 24px rgba(0,0,0,.2),inset 0 1px 0 rgba(255,255,255,.035)!important}
 #as5 .asCardHead{grid-template-columns:50px minmax(0,1fr) 160px!important;gap:10px!important;align-items:center!important;padding:11px 14px 9px!important}
 #as5 .asCard .asAvatar{width:48px!important;height:48px!important}
 #as5 .asCardName .asPlayer{font-size:18px!important;line-height:1.08!important}
 #as5 .asCardMarket{font-size:14px!important;line-height:1.2!important;margin-top:5px!important}
 #as5 .asCardMatch{font-size:11px!important;line-height:1.35!important;margin-top:3px!important}
 #as5 .asMatchPills{padding:0 14px 7px!important}
 #as5 .asRing:not(.asRingEmpty){grid-template-columns:78px 68px!important;width:154px!important;min-height:78px!important;gap:6px!important}
 #as5 .asRingSvg{width:78px!important;height:78px!important}
 #as5 .asHitChance{width:78px!important;height:78px!important}
 #as5 .asHitChance strong{font-size:16px!important}
 #as5 .asRingLegend{gap:5px!important}
 #as5 .asRingLegend b{font-size:11px!important}
 #as5 .asRingLegend small{font-size:8px!important}
 #as5 .asBadges{min-height:0!important}
 #as5 .asBadge{min-height:54px!important;padding:6px 3px!important}
 #as5 .asBadge small{font-size:9px!important}
 #as5 .asBadge b{font-size:15px!important;margin-top:3px!important}
 #as5 .asBadge em,#as5 .asBadge span{font-size:8px!important}
 #as5 .asPropBookStrip{display:grid!important;grid-template-columns:minmax(210px,300px) minmax(200px,auto) 1fr!important;align-items:center!important;gap:10px 14px!important;padding:8px 12px!important;background:linear-gradient(180deg,rgba(5,19,35,.94),rgba(3,13,27,.98))!important;border-top:1px solid rgba(63,98,139,.4)!important}
 #as5 .asPropBookPicker{min-width:0!important;max-width:none!important;width:100%!important;height:40px!important;border-radius:10px!important}
 #as5 .asPropBookSelect{font-size:13px!important}
 #as5 .asPropBookValues{min-height:40px!important;gap:14px!important}
 #as5 .asPropBookQuote b{font-size:14px!important}
 #as5 .asPropBookQuote em{font-size:11px!important}
 #as5 .asPropBookMeta{margin-left:0!important;text-align:right!important;font-size:10px!important}
 #as5 .asCardModels{padding:0 12px!important}
 #as5 .asCardModels>summary{padding:7px 0!important;font-size:10px!important}
 #as5 .asFairStrip{padding:0 12px 8px!important}
}
@media(min-width:1051px) and (max-width:1280px){
 #as5 .asCardHead{grid-template-columns:46px minmax(0,1fr) 145px!important}
 #as5 .asCard .asAvatar{width:44px!important;height:44px!important}
 #as5 .asRing:not(.asRingEmpty){grid-template-columns:72px 62px!important;width:140px!important;min-height:72px!important}
 #as5 .asRingSvg,#as5 .asHitChance{width:72px!important;height:72px!important}
 #as5 .asPropBookStrip{grid-template-columns:minmax(200px,260px) minmax(180px,auto) 1fr!important}
}`;
    source = source.replace(anchor, terminalCss + '\n\n' + anchor);
  }

  if (!source.includes('/* Oblige Props midnight-electric premium system.')) {
    const styleClose = '</style>`;';
    const count = source.split(styleClose).length - 1;
    if (count !== 1) throw new Error(`[oblige-props-presentation] premium theme style anchor count=${count}`);
    const premiumThemeCss = `/* Oblige Props midnight-electric premium system.
   Blue/violet carries navigation and product identity. Emerald is reserved for
   positive data, red for misses/warnings, and gold only for premium status. */
#as5{
 --op-bg:#040611;--op-surface:#091124;--op-surface-2:#0d1730;--op-surface-3:#111d39;
 --op-line:rgba(83,111,173,.42);--op-line-soft:rgba(83,111,173,.24);
 --op-blue:#2f7cff;--op-blue-2:#55b7ff;--op-violet:#8b5cf6;--op-violet-2:#c14cff;
 --op-green:#2ee6a6;--op-red:#ff5470;--op-gold:#f6c453;
 --green:var(--op-green);--green2:#18bd83;--blue:var(--op-blue-2);--violet:var(--op-violet);--red:var(--op-red);--amber:var(--op-gold);
 background:
  radial-gradient(980px 500px at 16% -180px,rgba(47,124,255,.16),transparent 68%),
  radial-gradient(900px 520px at 84% -170px,rgba(139,92,246,.16),transparent 70%),
  linear-gradient(180deg,#070b1a 0%,#040611 48%,#03050d 100%)!important;
 color:#f7f9ff!important;
}
#as5 .asTop{background:linear-gradient(180deg,rgba(6,10,24,.94),rgba(5,9,22,.88))!important;border-bottom:1px solid rgba(91,115,178,.25)!important;box-shadow:0 14px 36px rgba(0,0,0,.28)!important}
#as5 .asWordmark .asOblige{color:#f7f9ff!important}
#as5 .asWordmark .asPay,#as5 .asWordmark .asProps{color:#78a8ff!important;text-shadow:0 0 18px rgba(73,126,255,.18)!important}
#as5 .asHeaderSearch{border-color:rgba(82,112,177,.42)!important;background:linear-gradient(180deg,rgba(12,20,43,.90),rgba(7,13,31,.94))!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.035),0 12px 30px rgba(0,0,0,.16)!important;transition:border-color .16s ease,box-shadow .16s ease!important}
#as5 .asHeaderSearch:focus-within{border-color:rgba(93,150,255,.78)!important;box-shadow:0 0 0 3px rgba(47,124,255,.10),0 12px 32px rgba(0,0,0,.18)!important}
#as5 .asHeaderSearch input{color:#f8faff!important}
#as5 .asHeaderSearch input::placeholder{color:#7183a9!important}
#as5 .asSport,#as5 .asTypeChip,#as5 .asChip{border-color:rgba(75,100,155,.31)!important;background:linear-gradient(180deg,rgba(13,22,46,.86),rgba(8,14,31,.94))!important;color:#aebddd!important}
#as5 .asSport.on,#as5 .asTypeChip.on,#as5 .asChip.on{background:linear-gradient(135deg,rgba(47,124,255,.94),rgba(139,92,246,.92))!important;border-color:rgba(118,137,255,.86)!important;color:#fff!important;box-shadow:0 8px 24px rgba(70,90,230,.24),inset 0 1px 0 rgba(255,255,255,.15)!important}
#as5 .asBoardFilterMenu,#as5 .asFilterSheet,#as5 .asUtility,#as5 .asAdvanced{background:linear-gradient(145deg,rgba(12,21,45,.98),rgba(7,13,31,.99))!important;border-color:rgba(78,106,166,.44)!important;box-shadow:0 24px 70px rgba(0,0,0,.32),inset 0 1px 0 rgba(255,255,255,.035)!important}
#as5 .asControl,#as5 .asMarketSelect,#as5 input[type="number"],#as5 input[type="date"],#as5 input[type="datetime-local"]{background:linear-gradient(180deg,rgba(14,24,50,.96),rgba(8,15,33,.98))!important;border-color:rgba(80,108,166,.46)!important;color:#f5f8ff!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.025)!important}
#as5 .asControl:focus,#as5 .asMarketSelect:focus,#as5 input:focus{border-color:#5c8dff!important;outline:none!important;box-shadow:0 0 0 3px rgba(68,122,255,.10)!important}
#as5 .asBtn.asPrimary,#as5 .asFilterTrigger,#as5 #asResearchBatch{background:linear-gradient(135deg,#2f7cff,#7658f6)!important;border-color:rgba(105,135,255,.78)!important;color:#fff!important;box-shadow:0 9px 24px rgba(61,94,226,.20)!important}
#as5 .asSummaryItem{background:linear-gradient(145deg,rgba(13,24,49,.96),rgba(8,15,32,.98))!important;border-color:rgba(76,104,161,.34)!important}
#as5 .asSummaryItem small{color:#8394ba!important}
#as5 .asCard,#as5 .asRow{border-color:rgba(79,108,168,.42)!important;background:linear-gradient(145deg,rgba(14,25,51,.97),rgba(6,12,29,.99))!important;box-shadow:0 16px 42px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.038)!important}
#as5 .asCard:hover,#as5 .asRow:hover{border-color:rgba(98,139,230,.62)!important;box-shadow:0 18px 48px rgba(0,0,0,.34),0 0 0 1px rgba(94,82,230,.08)!important}
#as5 .asCard .asAvatar,#as5 .asDrawerAvatar{border-color:rgba(99,144,242,.62)!important;box-shadow:0 9px 24px rgba(0,0,0,.28),0 0 0 3px rgba(79,103,230,.05)!important}
#as5 .asPlayer,#as5 .asCardName .asPlayer{color:#fbfcff!important}
#as5 .asCardMatch,#as5 .asGame{color:#91a3c6!important}
#as5 .asPill{background:linear-gradient(180deg,rgba(18,31,61,.94),rgba(10,18,39,.97))!important;border-color:rgba(77,106,164,.34)!important}
#as5 .asBadge{background:linear-gradient(180deg,rgba(13,24,49,.96),rgba(7,14,31,.98))!important;border-color:rgba(77,103,159,.25)!important;box-shadow:inset 0 -16px 28px rgba(46,230,166,.03)!important}
#as5 .asBadge b{color:#f5f8ff!important}
#as5 .asBadge .good,#as5 .asBadge.good b,#as5 .good,#as5 .asHit,#as5 .asBest{color:var(--op-green)!important}
#as5 .asBadge .bad,#as5 .asBadge.bad b,#as5 .bad,#as5 .asMiss{color:var(--op-red)!important}
#as5 .asPropBookStrip{background:linear-gradient(180deg,rgba(8,17,37,.95),rgba(5,11,26,.98))!important;border-color:rgba(71,101,160,.34)!important}
#as5 .asPropBookPicker,#as5 .asOddsChip{background:linear-gradient(180deg,rgba(15,27,55,.94),rgba(8,15,34,.98))!important;border-color:rgba(80,108,166,.42)!important}
#as5 .asNav{background:linear-gradient(180deg,rgba(17,27,54,.74),rgba(6,11,27,.86))!important;border-color:rgba(95,118,186,.48)!important;box-shadow:0 20px 52px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.06),0 0 34px rgba(84,65,220,.06)!important}
#as5 .asNav .on{background:linear-gradient(135deg,#2f7cff,#7b57f6)!important;border-color:rgba(128,146,255,.86)!important;color:#fff!important;box-shadow:0 8px 24px rgba(65,93,232,.28),inset 0 1px 0 rgba(255,255,255,.17)!important}
#as5 .asNavBrand{background:linear-gradient(180deg,rgba(19,33,65,.82),rgba(9,17,38,.88))!important;border-color:rgba(91,119,184,.48)!important}
#as5 .asAnalyticsPage{max-width:1180px!important;background:radial-gradient(740px 330px at 72% -100px,rgba(139,92,246,.11),transparent 70%),radial-gradient(700px 320px at 15% -110px,rgba(47,124,255,.12),transparent 70%),linear-gradient(180deg,#080d1f,#050914 62%,#040711)!important;border-left:1px solid rgba(62,86,139,.22)!important;border-right:1px solid rgba(62,86,139,.22)!important}
#as5 .asAnalyticsPage .asDrawerHead{background:linear-gradient(180deg,rgba(9,15,35,.96),rgba(7,12,29,.91))!important;border-bottom-color:rgba(81,108,169,.33)!important;box-shadow:0 10px 30px rgba(0,0,0,.20)!important}
#as5 .asAnalyticsPage .asDrawerHead h2{font-weight:850!important;letter-spacing:-.035em!important;color:#fbfcff!important}
#as5 .asAnalyticsPage .asDrawerHead p{color:#98a8cb!important}
#as5 .asAnalyticsPage .asClose{background:linear-gradient(180deg,rgba(20,32,63,.96),rgba(10,18,40,.98))!important;border-color:rgba(83,113,174,.44)!important;color:#dce6ff!important}
#as5 .asDetailControls{padding:4px 2px 12px!important}
#as5 .asMarketQuick{border-bottom-color:rgba(74,100,156,.31)!important;gap:6px!important}
#as5 .asMarketQuickButton{color:#9cadd0!important;border-radius:10px 10px 0 0!important}
#as5 .asMarketQuickButton.on{color:#fff!important;border-bottom-color:#9b6cff!important;background:linear-gradient(135deg,rgba(47,124,255,.24),rgba(139,92,246,.26))!important;text-shadow:0 0 16px rgba(122,90,246,.18)!important}
#as5 .asDetailStatHeading h2{color:#fff!important;font-weight:850!important;letter-spacing:-.035em!important}
#as5 .asDetailLineRow{padding:2px 0 4px!important}
#as5 .asLineCtl{border-radius:12px!important;overflow:hidden!important;box-shadow:0 8px 22px rgba(0,0,0,.18)!important}
#as5 .asAnalyticsPage .asLineBtn,#as5 .asAnalyticsPage .asLineVal{background:linear-gradient(180deg,rgba(18,31,62,.98),rgba(9,17,38,.99))!important;border-color:rgba(79,108,169,.47)!important;color:#fff!important}
#as5 .asAnalyticsPage .asLineVal{font-weight:900!important}
#as5 .asDetailLineRow .asSideToggle{background:linear-gradient(180deg,rgba(16,26,52,.98),rgba(8,15,34,.99))!important;border-color:rgba(80,108,169,.48)!important}
#as5 .asDetailLineRow .asSideBtn{color:#91a0c4!important;transition:background .15s ease,color .15s ease,box-shadow .15s ease!important}
#as5 .asDetailLineRow .asSideBtn.on.over{color:#65f4c0!important;background:linear-gradient(135deg,rgba(16,118,91,.62),rgba(15,86,76,.48))!important;box-shadow:0 0 0 1px rgba(46,230,166,.42),0 0 22px rgba(46,230,166,.10)!important}
#as5 .asDetailLineRow .asSideBtn.on.under{color:#d4d9ff!important;background:linear-gradient(135deg,rgba(47,124,255,.44),rgba(139,92,246,.42))!important;box-shadow:0 0 0 1px rgba(119,124,255,.40),0 0 22px rgba(105,89,241,.10)!important}
#as5 .asDetailSave{background:linear-gradient(180deg,rgba(18,31,61,.97),rgba(9,16,36,.99))!important;border-color:rgba(84,113,174,.48)!important;color:#aebddd!important}
#as5 .asDetailSave.on{color:var(--op-gold)!important;border-color:rgba(246,196,83,.46)!important;box-shadow:0 0 18px rgba(246,196,83,.10)!important}
#as5 .asAnalyticsPage .asPropFilterGrid{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:8px!important;margin:14px 0 8px!important}
#as5 .asAnalyticsPage .asPropFilterGrid label{color:#99a9cb!important;font-weight:650!important}
#as5 .asAnalyticsPage .asPropFilterGrid select{background:linear-gradient(180deg,rgba(17,29,57,.98),rgba(8,16,35,.99))!important;border-color:rgba(79,107,167,.50)!important;color:#f6f8ff!important;border-radius:11px!important}
#as5 .asAnalyticsPage .asPropFilterGrid select:focus{border-color:#6b8fff!important;box-shadow:0 0 0 3px rgba(82,108,255,.10)!important}
#as5 .asFilterHint{display:flex!important;align-items:center!important;gap:7px!important;color:#82a7e7!important;font-weight:650!important}
#as5 .asFilterHint:before{content:"⚡";color:#67b8ff!important;text-shadow:0 0 14px rgba(73,136,255,.25)!important}
#as5 .asMorePropFilters{color:#9fb0d2!important}
#as5 .asResearchTabs{border-bottom-color:rgba(75,101,157,.32)!important;scrollbar-width:none!important}
#as5 .asResearchTabs::-webkit-scrollbar{display:none!important}
#as5 .asResearchTab{color:#93a4c6!important;border-radius:9px 9px 0 0!important}
#as5 .asResearchTab[aria-selected="true"],#as5 .asResearchTab.on{color:#fff!important;background:linear-gradient(135deg,rgba(47,124,255,.19),rgba(139,92,246,.23))!important;box-shadow:inset 0 -2px 0 #8b5cf6!important}
#as5 .asSection{background:linear-gradient(145deg,rgba(12,22,45,.96),rgba(7,14,31,.98))!important;border-color:rgba(77,105,164,.38)!important;box-shadow:0 14px 32px rgba(0,0,0,.16)!important}
#as5 .asSectionTitle{border-color:rgba(71,99,156,.30)!important}
#as5 .asSectionTitle h3{color:#c2ccef!important}
#as5 .asWindow{background:linear-gradient(180deg,rgba(15,27,54,.96),rgba(8,15,33,.99))!important;border-color:rgba(74,102,160,.40)!important}
#as5 .asWindow.on{background:linear-gradient(135deg,rgba(47,124,255,.18),rgba(139,92,246,.23))!important;border-color:rgba(118,112,246,.62)!important;box-shadow:0 0 22px rgba(91,78,225,.08)!important}
#as5 .asWindow b{color:#f6f8ff!important}
#as5 .asWindow em{color:var(--op-green)!important}
#as5 .asChart{background:linear-gradient(180deg,rgba(7,15,34,.92),rgba(4,10,23,.98))!important;border:1px solid rgba(75,102,157,.26)!important}
#as5 .asChartBar{background:linear-gradient(180deg,#44efb4,#12a976)!important;box-shadow:0 0 16px rgba(46,230,166,.10)!important}
#as5 .asChartBar.miss{background:linear-gradient(180deg,#ff7389,#a63854)!important;box-shadow:none!important}
#as5 .asChartBar.push{background:linear-gradient(180deg,#f3ce72,#9c7430)!important}
#as5 .asTable th{color:#8495ba!important}
#as5 .asTable td{border-color:rgba(70,96,148,.26)!important}
#as5 .asTable tbody tr:hover{background:rgba(46,89,171,.08)!important}
#as5 .asProfileDropdown{background:linear-gradient(145deg,rgba(12,21,44,.99),rgba(7,13,30,.995))!important;border-color:rgba(83,111,171,.46)!important}
#as5 .asToast{background:linear-gradient(135deg,rgba(38,91,183,.97),rgba(91,62,191,.97))!important;border-color:rgba(121,146,255,.58)!important;box-shadow:0 16px 40px rgba(0,0,0,.34)!important}
@media(min-width:1051px){
 #as5 .asMain{max-width:1680px!important}
 #as5 .asAnalyticsPage{max-width:1220px!important;border-radius:0 0 22px 22px!important;box-shadow:0 24px 70px rgba(0,0,0,.24)!important}
 #as5 .asAnalyticsPage .asDrawerBody{padding:18px 22px 30px!important}
 #as5 .asHeaderRow{color:#8495b8!important;border-bottom:1px solid rgba(67,94,151,.20)!important}
 #as5 .asNav{width:min(980px,calc(100% - 34px))!important}
}
@media(max-width:700px){
 #as5{background:radial-gradient(560px 330px at 82% -120px,rgba(139,92,246,.13),transparent 68%),radial-gradient(520px 300px at 12% -110px,rgba(47,124,255,.13),transparent 68%),linear-gradient(180deg,#060a18,#040611 58%,#03050d)!important}
 #as5 .asTop{background:rgba(5,9,22,.91)!important}
 #as5 .asHeaderSearch{background:rgba(10,17,37,.92)!important}
 #as5 .asAnalyticsPage{border:0!important;max-width:none!important;min-height:calc(100vh - 72px)!important}
 #as5 .asAnalyticsPage .asDrawerHead{padding:12px 11px!important}
 #as5 .asAnalyticsPage .asDrawerHead h2{font-size:19px!important}
 #as5 .asAnalyticsPage .asDrawerBody{padding:10px 10px 20px!important}
 #as5 .asDetailLineRow{display:grid!important;grid-template-columns:minmax(130px,.95fr) minmax(134px,1.05fr) 44px!important;gap:7px!important;align-items:center!important}
 #as5 .asDetailLineRow .asSideToggle{min-width:0!important}
 #as5 .asAnalyticsPage .asPropFilterGrid{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:6px!important}
 #as5 .asAnalyticsPage .asPropFilterGrid label{font-size:9px!important;min-width:0!important}
 #as5 .asAnalyticsPage .asPropFilterGrid select{font-size:11px!important;padding:0 6px!important;min-width:0!important;min-height:39px!important}
 #as5 .asFilterHint{font-size:10px!important;margin:8px 0 2px!important}
 #as5 .asResearchTabs{display:flex!important;overflow-x:auto!important;gap:3px!important}
 #as5 .asResearchTab{flex:0 0 auto!important;min-height:39px!important;padding:8px 11px!important;font-size:11px!important}
 #as5 .asTrendPills .asWindows{gap:6px!important}
 #as5 .asTrendPills .asWindow{min-width:78px!important}
 #as5 .asSection{border-radius:14px!important;margin-bottom:11px!important}
 #as5 .asSectionBody{padding:11px!important}
 #as5 .asNav{width:calc(100% - 16px)!important;border-radius:21px!important}
}
@media(max-width:430px){
 #as5 .asWordmark{font-size:18px!important}
 #as5 .asDetailLineRow{grid-template-columns:minmax(118px,.92fr) minmax(128px,1.08fr) 42px!important;gap:5px!important}
 #as5 .asDetailSave{width:42px!important;height:42px!important}
 #as5 .asAnalyticsPage .asPropFilterGrid{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:5px!important}
 #as5 .asAnalyticsPage .asPropFilterGrid label{font-size:8px!important}
 #as5 .asAnalyticsPage .asPropFilterGrid select{font-size:10px!important;padding:0 4px!important;min-height:37px!important;border-radius:9px!important}
 #as5 .asNav{grid-template-columns:repeat(3,minmax(0,1fr)) minmax(82px,1.5fr) repeat(3,minmax(0,1fr))!important}
}
@media(max-width:390px){
 #as5 .asDetailLineRow{grid-template-columns:minmax(112px,.9fr) minmax(122px,1.1fr) 40px!important}
 #as5 .asAnalyticsPage .asPropFilterGrid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:7px!important}
 #as5 .asAnalyticsPage .asPropFilterGrid label{font-size:10px!important}
 #as5 .asAnalyticsPage .asPropFilterGrid select{font-size:12px!important;min-height:39px!important}
}`;
    source = source.replace(styleClose, premiumThemeCss + '\n' + styleClose);
  }

  replaceOnceOrPresent(
    '  function decorate(){ensureHeader();tidySaveButtons();tidyRings();tidyUnavailable();}',
    `  function obligeCopy(value){
    return String(value||'')
      .split('AutoProp Scout Pro').join('Oblige Props')
      .split('AutoProp Scout').join('Oblige Props')
      .split('Auto Scout').join('Oblige Props')
      .split('AUTOSCOUT').join('OBLIGE PROPS')
      .split('ObligePay Edge').join('Oblige Props')
      .split('ObligePay').join('Oblige Props');
  }
  function normalizeBrand(){
    if(document.title)document.title=obligeCopy(document.title);
    var root=document.getElementById('as5')||document.body;if(!root)return;
    var identity=root.querySelector('.asIdentity');
    if(identity)identity.setAttribute('aria-label','Oblige Props research');
    var walker=document.createTreeWalker(root,4),node;
    while((node=walker.nextNode())){
      var parent=node.parentElement;
      if(parent&&parent.tagName!=='SCRIPT'&&parent.tagName!=='STYLE'&&parent.tagName!=='NOSCRIPT'){
        var next=obligeCopy(node.nodeValue);
        if(next!==node.nodeValue)node.nodeValue=next;
      }
    }
    var elements=[root].concat(Array.from(root.querySelectorAll('[aria-label],[title],[placeholder]')));
    elements.forEach(function(el){['aria-label','title','placeholder'].forEach(function(attr){
      if(!el.hasAttribute||!el.hasAttribute(attr))return;
      var value=el.getAttribute(attr),next=obligeCopy(value);
      if(next!==value)el.setAttribute(attr,next);
    });});
  }
  function decorate(){ensureHeader();normalizeBrand();tidySaveButtons();tidyRings();tidyUnavailable();}`,
    'final customer branding normalizer',
  );

  let applied = source !== before;
  if (applied) writeFileSync(file, source, 'utf8');

  // Give signed-out visitors the same midnight-electric identity as the app.
  // This is presentation-only; account fields, routes, verification and session
  // behavior remain untouched. Tiny test fixtures may not include the landing file.
  const landingFile = path.join(root, 'lib/auth/landing.mjs');
  if (existsSync(landingFile)) {
    let landing = readFileSync(landingFile, 'utf8');
    const landingMarker = '/* Oblige Props midnight-electric landing theme. */';
    if (!landing.includes(landingMarker)) {
      const anchor = '</style></head><body>';
      const count = landing.split(anchor).length - 1;
      if (count !== 1) throw new Error(`[oblige-props-presentation] landing style anchor count=${count}`);
      const landingTheme = `/* Oblige Props midnight-electric landing theme. */
:root{--bg:#040611;--panel:#0a1124;--line:#2c3b63;--text:#f7f9ff;--muted:#a2b0cf;--blue:#2f7cff;--green:#2ee6a6}
html,body{background:radial-gradient(900px 480px at 12% -160px,rgba(47,124,255,.18),transparent 68%),radial-gradient(850px 500px at 88% -170px,rgba(139,92,246,.18),transparent 70%),linear-gradient(180deg,#070b1a,#040611 58%,#03050d);background-attachment:fixed}
.teaser{opacity:.09}.wrap{max-width:1220px}.logo{background:linear-gradient(135deg,#2f7cff,#8b5cf6);box-shadow:0 10px 30px rgba(69,91,229,.25),inset 0 1px 0 rgba(255,255,255,.22)}
.brand{color:#f8faff}.beta{border-color:#425180;background:linear-gradient(135deg,rgba(47,124,255,.15),rgba(139,92,246,.16));color:#cad6ff}
header{border-bottom-color:rgba(82,106,165,.30)}.eyebrow{color:#88aaff}h1 em{background:linear-gradient(90deg,#62bfff,#a779ff 55%,#2ee6a6);-webkit-background-clip:text;background-clip:text;color:transparent}
.sub{color:#aab7d4}.card{background:linear-gradient(145deg,rgba(14,25,52,.97),rgba(7,13,31,.99));border-color:rgba(85,112,174,.48);box-shadow:0 30px 84px rgba(0,0,0,.42),0 0 50px rgba(85,69,222,.05),inset 0 1px 0 rgba(255,255,255,.04)}
.tabs{background:#081126;border-color:#304069}.tabs button[aria-selected=true]{background:linear-gradient(135deg,#2f7cff,#7a58f6);box-shadow:0 8px 22px rgba(67,91,229,.22)}
input[type=email],input[type=password],input[type=text]{background:#091329;border-color:#33456f}.primary{background:linear-gradient(135deg,#2f7cff,#7d58f6);box-shadow:0 10px 26px rgba(66,91,227,.24)}.primary:hover{background:linear-gradient(135deg,#428cff,#8b68ff)}
.check input{accent-color:#7a62ff}.textBtn{color:#89aaff}.feat{background:linear-gradient(145deg,rgba(12,23,48,.92),rgba(7,14,31,.96));border-color:rgba(75,101,160,.38)}.mark{background:linear-gradient(135deg,rgba(47,124,255,.20),rgba(139,92,246,.20));color:#9bb8ff;border:1px solid rgba(97,122,190,.32)}
footer{border-color:rgba(72,97,154,.28);color:#8f9fc1}
@media(max-width:900px){.wrap{padding-left:16px;padding-right:16px}.card{border-radius:18px}.features{gap:10px}}`;
      landing = landing.replace(anchor, landingTheme + '\n' + anchor);
      writeFileSync(landingFile, landing, 'utf8');
      applied = true;
    }
  }

  return { applied, file: TARGET };
}

const autoResult = applyObligePropsPresentationPatch();
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  console.log(`[oblige-props-presentation] applied=${autoResult.applied} file=${autoResult.file || TARGET}`);
}
