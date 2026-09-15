const ROW_FUNCTION_ANCHOR = 'function rowHtml(g){';
const ROW_STATE_ANCHOR = ` var team=g.team||(r&&r.player?r.player.team:null)||c.team,position=g.position||c.position||c.playerPosition;`;
const TEAM_BADGE_ANCHOR = `    +(displayTeam(team)?'<span class="asTeamBadge">'+esc(displayTeam(team))+'</span>':'')`;
const RING_ANCHOR = `   +'<div class="asCardGauge">'+ringGauge(gaugeRates(r,side),r)+'</div>'`;

function replaceOnce(source, anchor, replacement, label) {
  const count = source.split(anchor).length - 1;
  if (count !== 1) throw new Error(`NFL/opponent UI patch expected one ${label} anchor; found ${count}.`);
  return source.replace(anchor, replacement);
}

const CARD_HELPERS = String.raw`
// The opponent belongs to the event, not the sportsbook quote. Prefer verified
// research context, then infer it directly from the player's team and the
// event's home/away teams so the label is present before hydration finishes.
function cardOpponent(g,r){
 var direct=r?.matchup?.opponent||r?.opponent||null;
 if(direct)return displayTeam(direct);
 var team=g?.team||r?.player?.team||r?.context?.team||null;
 var home=g?.homeTeam||r?.matchup?.homeTeam||null,away=g?.awayTeam||r?.matchup?.awayTeam||null;
 if(team&&home&&researchTeamMatches(team,home))return displayTeam(away);
 if(team&&away&&researchTeamMatches(team,away))return displayTeam(home);
 return '';
}
// The general product ring intentionally prefers season. Early NFL cards can
// therefore show 0/100 after a single current-season game even though their
// verified rolling history already contains prior regular-season games. For
// NFL only, feed the ring a view where L5 is the first eligible headline window.
// The underlying research object and every L5/L10/L15/L20/SZN badge stay intact.
function ringResearchForSport(r,sport){
 if(String(sport||'').toUpperCase()!=='NFL'||!r?.available||!r.windows)return r;
 var l5=r.windows.l5;
 if(!l5||researchRate(l5)==null)return r;
 return {...r,windows:{...r.windows,season:null,l20:null,l15:null,l10:null}};
}
`;

const OPPONENT_CSS = String.raw`
#as5 .asOpponentBadge{display:inline-flex;align-items:center;gap:3px;margin-left:2px;padding:3px 6px;border:1px solid rgba(106,139,188,.34);border-radius:999px;background:rgba(20,35,59,.72);color:#b9cce4;font-size:9px;font-weight:850;white-space:nowrap}
#as5 .asOpponentBadge:before{content:"vs";color:#6f88a8;font-size:7px;font-weight:900;text-transform:uppercase;letter-spacing:.04em}
@media(max-width:540px){#as5 .asOpponentBadge{padding:2px 5px;font-size:8px}}
`;

export function patchNflPercentAndOpponentUi(source) {
  let out = String(source ?? '');

  out = replaceOnce(out, ROW_FUNCTION_ANCHOR, `${CARD_HELPERS}\n${ROW_FUNCTION_ANCHOR}`, 'row renderer');
  out = replaceOnce(
    out,
    ROW_STATE_ANCHOR,
    ` var team=g.team||(r&&r.player?r.player.team:null)||c.team,position=g.position||c.position||c.playerPosition,opponent=cardOpponent(g,r);`,
    'row opponent state',
  );
  out = replaceOnce(
    out,
    TEAM_BADGE_ANCHOR,
    `${TEAM_BADGE_ANCHOR}\n    +(opponent?'<span class="asOpponentBadge">'+esc(opponent)+'</span>':'')`,
    'team badge',
  );
  out = replaceOnce(
    out,
    RING_ANCHOR,
    `   +'<div class="asCardGauge">'+ringGauge(gaugeRates(ringResearchForSport(r,g.sport),side),r)+'</div>'`,
    'NFL ring research basis',
  );

  const styleRuntime = `\n;(function installOpponentStyle(){if(typeof document==='undefined')return;if(document.getElementById('oblige-opponent-style'))return;var style=document.createElement('style');style.id='oblige-opponent-style';style.textContent=${JSON.stringify(OPPONENT_CSS)};(document.head||document.documentElement).appendChild(style);})();\n`;
  return out + styleRuntime;
}
