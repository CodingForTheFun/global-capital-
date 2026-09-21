import { BOARD_SPORTS, SUPPORTED_SPORTS } from './models.mjs';
import { BOARD_COVERAGE_LABELS, SCOPED_PUBLIC_SPORTS } from './board-coverage-catalog.mjs';

function replaceOnce(source, anchor, replacement, label) {
  const count = source.split(anchor).length - 1;
  if (count !== 1) throw new Error(`Board coverage patch expected one ${label}; found ${count}.`);
  return source.replace(anchor, replacement);
}

// Last-stage presentation patch for the actual Railway-served client. There
// are no fetches, timers, listeners, provider imports or changes to saved IDs.
// The same board catalog used by server validation supplies the client options.
export function patchBoardCoverageUi(source) {
  let out = String(source ?? '');
  if (out.includes('var boardCoverageSportLabels=')) return out;
  const sports = out.match(/\bvar SPORTS=\[[^\]\r\n]*\];/g) || [];
  if (sports.length !== 1) throw new Error(`Board coverage patch expected one sport list; found ${sports.length}.`);
  const helpers = `var boardCoverageSportLabels=${JSON.stringify(BOARD_COVERAGE_LABELS)};
var boardCoverageScopes=${JSON.stringify(SCOPED_PUBLIC_SPORTS)};
var boardCoverageResearchSports=${JSON.stringify(SUPPORTED_SPORTS)};
var boardCoverageFantasySports=${JSON.stringify(BOARD_SPORTS.filter(sport => !SCOPED_PUBLIC_SPORTS[sport] && !sport.endsWith('SZN')))};
function boardCoverageSportLabel(code){return boardCoverageSportLabels[code]||code;}
function groups(allBooks=false){
 return boardCoverageBaseGroups(allBooks).map(function(g){
  var scope=boardCoverageScopes[g.sport];
  if(!scope)return g;
  var display=Object.assign({},g,{market:scope.marketPrefix+' · '+g.market});
  if(scope.period)display.period=scope.period;
  return display;
 });
}
`;
  out = replaceOnce(out, 'function groups(allBooks=false){', 'function boardCoverageBaseGroups(allBooks=false){', 'base board grouping');
  out = replaceOnce(out, sports[0], `${helpers}var SPORTS=${JSON.stringify(BOARD_SPORTS)};`, 'sport list');

  const render = out.match(/function renderSports\(\)\{[\s\S]*?(?=\nfunction viewGroups\()/g) || [];
  if (render.length !== 1) throw new Error(`Board coverage patch expected one sport renderer; found ${render.length}.`);
  let labeled = replaceOnce(render[0], "'+v+'</option>'", "'+esc(boardCoverageSportLabel(v))+'</option>'", 'sport option label');
  labeled = replaceOnce(labeled, "'+s+'</button>'", "'+esc(boardCoverageSportLabel(s))+'</button>'", 'sport button label');
  out = replaceOnce(out, render[0], labeled, 'sport renderer');

  // A source-native alias is intentionally NOT translated into its base sport
  // for research. Period/season/unknown histories must not borrow game totals.
  out = replaceOnce(out, 'function lineOnlyPolicy(g){', `function lineOnlyPolicy(g){
 var coverageSport=String(g?.sport||'').trim().toUpperCase();
 var fantasyResearch=boardCoverageFantasySports.includes(coverageSport)&&/fantasy/i.test(String(g?.market||'')+' '+String(g?.marketId||''));
 if(!boardCoverageResearchSports.includes(coverageSport)&&!fantasyResearch)return {ok:true,available:false,lineOnly:true,retryable:false,code:'HISTORICAL_SOURCE_UNVERIFIED',message:'Live line available. Verified research is unavailable for this sport or market scope.'};`, 'line-only research policy');

  // Browsers encode spaces in hashes. Decode the sport as well as the prop key
  // so source-native multiword sports retain working saved/deep-linked views.
  out = replaceOnce(out, 'match&&SPORTS.includes(match[1])?{sport:match[1],', 'match&&SPORTS.includes(decodeURIComponent(match[1]))?{sport:decodeURIComponent(match[1]),', 'prop-route sport decoding');
  return out;
}
