export function patchReferenceAcceptanceLiveUi(source) {
  const styleAnchor = '<style id="oblige-props-pixel-target">';
  const marker = '/* oblige-reference-acceptance-live-v286 */';

  if (source.includes(marker)) return source;

  const styleStart = source.indexOf(styleAnchor);
  if (styleStart < 0) {
    throw new Error('Live reference acceptance patch could not locate the Oblige Props style anchor.');
  }

  const styleEnd = source.indexOf('</style>', styleStart);
  if (styleEnd < 0) {
    throw new Error('Live reference acceptance patch could not locate the Oblige Props style terminator.');
  }

  const css = `
${marker}
#as5{--oblige-reference-acceptance:v286;background:#07090d!important;background-image:none!important;color:#f5f7fb!important}
#as5 .asTop{padding:8px 12px 9px!important;background:rgba(7,9,13,.96)!important;border-bottom:1px solid rgba(255,255,255,.07)!important;box-shadow:none!important;backdrop-filter:blur(18px)!important;-webkit-backdrop-filter:blur(18px)!important}
#as5 .asBar{max-width:1480px!important;column-gap:12px!important;row-gap:8px!important}
#as5 .asWordmark{font-size:22px!important;letter-spacing:-.045em!important}
#as5 .asHeaderSearch{height:40px!important;padding:0 12px!important;border-radius:11px!important;border:1px solid rgba(255,255,255,.08)!important;background:#0c0f14!important;box-shadow:none!important}
#as5 .asHeaderSearch:focus-within{border-color:rgba(64,136,255,.45)!important;box-shadow:0 0 0 2px rgba(64,136,255,.08)!important}
#as5 .asSports{gap:6px!important;padding:0!important}
#as5 .asSport{height:35px!important;padding:0 12px!important;border-radius:10px!important;border-color:rgba(255,255,255,.08)!important;background:#0c0f14!important;color:#b8c0cc!important;box-shadow:none!important}
#as5 .asSport.on{background:#1d6fff!important;border-color:#2f7cff!important;color:#fff!important;box-shadow:none!important}
#as5 .asGrid{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;align-items:start!important;gap:10px!important;padding-bottom:4px!important}
#as5 .asCard{overflow:hidden!important;border-radius:14px!important;border:1px solid rgba(255,255,255,.08)!important;background:#0c0f14!important;box-shadow:none!important}
#as5 .asCard:before{display:none!important}
#as5 .asCardHead{grid-template-columns:48px minmax(0,1fr) 132px!important;gap:9px!important;padding:10px 10px 8px!important}
#as5 .asCard .asAvatar{width:46px!important;height:46px!important;border-radius:12px!important;border:1px solid rgba(255,255,255,.10)!important;box-shadow:none!important;background:#11151c!important}
#as5 .asCardName .asPlayer{font-size:16px!important;line-height:1.1!important;font-weight:760!important;letter-spacing:-.025em!important}
#as5 .asCardMarket{font-size:13px!important;line-height:1.2!important;margin-top:4px!important;font-weight:760!important;color:#f4f6fa!important}
#as5 .asCardMatch{font-size:10px!important;line-height:1.25!important;margin-top:3px!important;color:#7e8794!important}
#as5 .asMatchPills{padding:0 10px 7px!important;gap:5px!important}
#as5 .asPill{font-size:9px!important;border-color:rgba(255,255,255,.07)!important;background:rgba(255,255,255,.025)!important}
#as5 .asRing:not(.asRingEmpty){grid-template-columns:70px 54px!important;width:128px!important;min-height:70px!important;gap:4px!important}
#as5 .asRingSvg{width:70px!important;height:70px!important}
#as5 .asRingSvg circle{stroke-width:5!important}
#as5 .asHitChance{width:70px!important;height:70px!important}
#as5 .asHitChance strong{font-size:15px!important}
#as5 .asRingLegend{gap:4px!important}
#as5 .asRingLegend span{grid-template-columns:5px 1fr!important;column-gap:5px!important}
#as5 .asRingLegend i{width:5px!important;height:14px!important;border-radius:999px!important}
#as5 .asRingLegend b{font-size:10px!important}
#as5 .asRingLegend small{font-size:7px!important;margin-top:1px!important}
#as5 .asBadges{grid-template-columns:repeat(8,minmax(0,1fr))!important;border-top:1px solid rgba(255,255,255,.065)!important;border-bottom:1px solid rgba(255,255,255,.065)!important;background:#090c10!important}
#as5 .asBadge{min-height:52px!important;padding:6px 2px!important;border-right:1px solid rgba(255,255,255,.055)!important;box-shadow:none!important}
#as5 .asBadge small{font-size:8px!important;color:#77818e!important}
#as5 .asBadge b{font-size:14px!important;margin-top:2px!important}
#as5 .asBadge em,#as5 .asBadge span{font-size:7px!important}
#as5 .asBookRail{padding:8px 9px 9px!important;gap:6px!important;background:#090c10!important;border-top:0!important}
#as5 .asBookRail:before{flex:0 0 52px!important;color:#6f7885!important;font-size:9px!important}
#as5 .asBookChip{min-width:110px!important;border-radius:9px!important;padding:7px 8px!important;border-color:rgba(255,255,255,.07)!important;background:#0f1319!important;box-shadow:none!important}
#as5 .asCard .asRowActions{top:7px!important;right:7px!important}
#as5 .asCard .asSave{width:28px!important;height:28px!important;min-width:28px!important;color:#7f8996!important}
#as5 .asCard .asSave:before{font-size:21px!important}
#as5 .asNav{bottom:calc(6px + env(safe-area-inset-bottom))!important;width:min(720px,calc(100% - 20px))!important;gap:1px!important;padding:4px!important;border-radius:18px!important;background:rgba(12,15,20,.88)!important;border:1px solid rgba(255,255,255,.09)!important;box-shadow:0 14px 38px rgba(0,0,0,.34)!important;backdrop-filter:blur(22px)!important;-webkit-backdrop-filter:blur(22px)!important}
#as5 .asNav button,#as5 .asNav a{height:42px!important;border-radius:13px!important;color:#8f99a7!important}
#as5 .asNav .on{background:#1d6fff!important;border-color:#2f7cff!important;box-shadow:none!important;color:#fff!important}
#as5 .asNavBrand{height:34px!important;margin:0 3px!important;background:transparent!important;border-color:transparent!important;box-shadow:none!important;color:#d9dee6!important}
#as5{padding-bottom:calc(66px + env(safe-area-inset-bottom))!important}

@media(min-width:1280px){
 #as5 .asGrid{grid-template-columns:repeat(3,minmax(0,1fr))!important}
 #as5 .asCardHead{grid-template-columns:50px minmax(0,1fr) 136px!important}
}

@media(max-width:760px){
 #as5 .asTop{padding:6px 8px 7px!important}
 #as5 .asBar{grid-template-columns:auto minmax(0,1fr) auto!important;column-gap:7px!important;row-gap:6px!important}
 #as5 .asWordmark{font-size:18px!important}
 #as5 .asHeaderSearch{height:34px!important;padding:0 9px!important;border-radius:9px!important}
 #as5 .asHeaderSearch input{font-size:11px!important}
 #as5 .asHeaderSearchIcon{font-size:15px!important}
 #as5 .asRight{max-width:40px!important}
 #as5 .asSports{gap:5px!important}
 #as5 .asSport{height:31px!important;padding:0 10px!important;border-radius:9px!important;font-size:10px!important}
 #as5 .asGrid{grid-template-columns:1fr!important;gap:8px!important}
 #as5 .asCard{border-radius:12px!important}
 #as5 .asCardHead{grid-template-columns:42px minmax(0,1fr) 110px!important;gap:8px!important;padding:8px 8px 6px!important}
 #as5 .asCard .asAvatar{width:40px!important;height:40px!important;border-radius:10px!important}
 #as5 .asCardName .asPlayer{font-size:14px!important;padding-right:22px!important}
 #as5 .asCardMarket{font-size:12px!important;margin-top:3px!important}
 #as5 .asCardMatch{font-size:9px!important;margin-top:2px!important}
 #as5 .asMatchPills{padding:0 8px 6px!important}
 #as5 .asRing:not(.asRingEmpty){grid-template-columns:58px 46px!important;width:108px!important;min-height:58px!important;gap:3px!important}
 #as5 .asRingSvg{width:58px!important;height:58px!important}
 #as5 .asHitChance{width:58px!important;height:58px!important}
 #as5 .asHitChance strong{font-size:13px!important}
 #as5 .asRingLegend b{font-size:9px!important}
 #as5 .asRingLegend small{font-size:6px!important}
 #as5 .asBadges{overflow-x:auto!important;grid-template-columns:repeat(8,minmax(48px,1fr))!important;scrollbar-width:none!important}
 #as5 .asBadges::-webkit-scrollbar{display:none!important}
 #as5 .asBadge{min-height:46px!important;padding:5px 2px!important}
 #as5 .asBadge b{font-size:12px!important}
 #as5 .asBookRail{padding:6px 7px 7px!important;gap:5px!important;overflow-x:auto!important;scrollbar-width:none!important}
 #as5 .asBookRail::-webkit-scrollbar{display:none!important}
 #as5 .asBookRail:before{flex:0 0 44px!important;font-size:8px!important}
 #as5 .asBookChip{min-width:96px!important;padding:6px 7px!important}
 #as5 .asNav{width:calc(100% - 14px)!important;bottom:calc(4px + env(safe-area-inset-bottom))!important;padding:3px!important;border-radius:16px!important}
 #as5 .asNav button,#as5 .asNav a{height:39px!important;font-size:9px!important}
 #as5 .asNavBrand{display:none!important}
 #as5{padding-bottom:calc(58px + env(safe-area-inset-bottom))!important}
}
`;

  return `${source.slice(0, styleEnd)}${css}${source.slice(styleEnd)}`;
}
