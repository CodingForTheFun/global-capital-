const HEADLINE_ANCHOR = `function headlineWindow(r){
 if(!r||!r.available||!r.windows)return null;
 var ids=['season','l20','l15','l10','l5'];
 for(var i=0;i<ids.length;i++){var w=r.windows[ids[i]];if(w&&researchRate(w)!=null)return{id:ids[i],w:w};}
 return null;
}`;

const ROW_FUNCTION_ANCHOR = 'function rowHtml(g){';
const ROW_STATE_ANCHOR = ` var team=g.team||(r&&r.player?r.player.team:null)||c.team,position=g.position||c.position||c.playerPosition;`;
const TEAM_BADGE_ANCHOR = `    +(displayTeam(team)?'<span class="asTeamBadge">'+esc(displayTeam(team))+'</span>':'')`;

function replaceOnce(source, anchor, replacement, label) {
  const count = source.split(anchor).length - 1;
  if (count !== 1) throw new Error(`NFL/opponent UI patch expected one ${label} anchor; found ${count}.`);
  return source.replace(anchor, replacement);
}

const OPPONENT_HELPER = String.raw`
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
`;

const OPPONENT_CSS = String.raw`
#as5 .asOpponentBadge{display:inline-flex;align-items:center;gap:3px;margin-left:2px;padding:3px 6px;border:1px solid rgba(106,139,188,.34);border-radius:999px;background:rgba(20,35,59,.72);color:#b9cce4;font-size:9px;font-weight:850;white-space:nowrap}
#as5 .asOpponentBadge:before{content:"vs";color:#6f88a8;font-size:7px;font-weight:900;text-transform:uppercase;letter-spacing:.04em}
@media(max-width:540px){#as5 .asOpponentBadge{padding:2px 5px;font-size:8px}}
`;

export function patchNflPercentAndOpponentUi(source) {
  let out = String(source ?? '');

  // The headline donut used Season first. In week one that makes every NFL
  // prop read as either 0% or 100% even though verified prior-season games are
  // already present for rolling research. Lead with the same L5 sample users
  // see in the recent-form chart, then expand only when L5 is unavailable.
  out = replaceOnce(
    out,
    HEADLINE_ANCHOR,
    `function headlineWindow(r){
 if(!r||!r.available||!r.windows)return null;
 var ids=['l5','l10','l15','l20','season'];
 for(var i=0;i<ids.length;i++){var w=r.windows[ids[i]];if(w&&researchRate(w)!=null)return{id:ids[i],w:w};}
 return null;
}`,
    'headline research window',
  );

  out = replaceOnce(out, ROW_FUNCTION_ANCHOR, `${OPPONENT_HELPER}\n${ROW_FUNCTION_ANCHOR}`, 'row renderer');
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

  const styleRuntime = `\n;(function installOpponentStyle(){if(typeof document==='undefined')return;if(document.getElementById('oblige-opponent-style'))return;var style=document.createElement('style');style.id='oblige-opponent-style';style.textContent=${JSON.stringify(OPPONENT_CSS)};(document.head||document.documentElement).appendChild(style);})();\n`;
  return out + styleRuntime;
}
