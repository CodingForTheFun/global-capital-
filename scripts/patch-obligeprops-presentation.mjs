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

  if (source !== before) writeFileSync(file, source, 'utf8');
  return { applied: source !== before, file: TARGET };
}

const autoResult = applyObligePropsPresentationPatch();
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  console.log(`[oblige-props-presentation] applied=${autoResult.applied} file=${autoResult.file || TARGET}`);
}
