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
