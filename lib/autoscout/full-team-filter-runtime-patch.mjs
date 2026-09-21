function replaceOnce(source, anchor, replacement, label) {
  const count = String(source ?? '').split(anchor).length - 1;
  if (count !== 1) throw new Error(`Full team filter patch expected one ${label}; found ${count}.`);
  return String(source).replace(anchor, replacement);
}

const CITY_ALIASES = Object.freeze({
  la: ['los', 'angeles'],
  ny: ['new', 'york'],
  sf: ['san', 'francisco'],
  sd: ['san', 'diego'],
  kc: ['kansas', 'city'],
  tb: ['tampa', 'bay'],
  lv: ['las', 'vegas'],
  no: ['new', 'orleans'],
  gb: ['green', 'bay'],
  okc: ['oklahoma', 'city'],
  stl: ['saint', 'louis'],
});

const HELPERS = String.raw`
function fullTeamFilterWords(value){
 var raw=String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\buniversity\b/g,'');
 var parts=raw.match(/[a-z0-9]+/g)||[];
 var aliases=${JSON.stringify(CITY_ALIASES)};
 if(parts.length&&aliases[parts[0]])parts=[].concat(aliases[parts[0]],parts.slice(1));
 if(parts[0]==='st'&&parts.length>1)parts[0]='saint';
 for(var i=1;i<parts.length;i++)if(parts[i]==='st')parts[i]='state';
 return parts;
}
function fullTeamFilterSame(left,right){
 var a=fullTeamFilterWords(left),b=fullTeamFilterWords(right);
 var ac=a.join(''),bc=b.join('');
 if(!ac||!bc)return false;
 if(ac===bc)return true;
 var ai=a.map(x=>x[0]).join(''),bi=b.map(x=>x[0]).join('');
 function abbreviation(short,longWords,longInitials){
  return short.length>=2&&short.length<=5&&(short===longInitials||short===longWords.slice(0,short.length).map(x=>x[0]).join(''));
 }
 if(abbreviation(ac,b,bi)||abbreviation(bc,a,ai))return true;
 function prefix(shorter,longer){
  return shorter.length>=2&&shorter.length<longer.length&&shorter.every((word,index)=>word===longer[index]);
 }
 return prefix(a,b)||prefix(b,a);
}
function fullTeamFilterOpponent(g,r){
 var direct=r?.matchup?.opponent||r?.opponent||null;
 if(direct)return direct;
 var team=g?.team||r?.player?.team||r?.context?.team||null;
 var home=g?.homeTeam||r?.matchup?.homeTeam||null,away=g?.awayTeam||r?.matchup?.awayTeam||null;
 if(team&&home&&fullTeamFilterSame(team,home))return away||null;
 if(team&&away&&fullTeamFilterSame(team,away))return home||null;
 return null;
}
function fullTeamFilterOptions(gs,kind,selected){
 var observed=[];
 function addObserved(value){
  value=String(value||'').trim();
  if(value&&!observed.some(existing=>fullTeamFilterSame(existing,value)))observed.push(value);
 }
 gs.forEach(function(g){
  var r=researchFor(g);
  addObserved(kind==='team'?(g.team||r?.player?.team||r?.context?.team):fullTeamFilterOpponent(g,r));
 });
 var rows=[];
 function add(value,label){
  value=String(value||'').trim();label=String(label||value).trim();
  if(!value||!label)return;
  var existing=rows.find(row=>fullTeamFilterSame(row.value,value)||fullTeamFilterSame(row.label,label));
  if(existing)return;
  rows.push({value:value,label:label});
 }
 gs.forEach(function(g){
  var r=researchFor(g);
  (Array.isArray(r?.leagueTeams)?r.leagueTeams:[]).forEach(function(team){
   var abbreviation=String(team?.abbreviation||'').trim(),name=String(team?.name||'').trim();
   if(!abbreviation||!name)return;
   var alias=observed.find(value=>fullTeamFilterSame(value,abbreviation)||fullTeamFilterSame(value,name));
   add(alias||abbreviation,name);
  });
 });
 observed.forEach(value=>add(value,value));
 if(selected&&!rows.some(row=>row.value===selected))add(selected,selected);
 rows.sort((a,b)=>a.label.localeCompare(b.label));
 var reset=kind==='team'?'All teams':'All opponents';
 return '<option value="">'+reset+'</option>'+rows.map(row=>'<option value="'+esc(row.value)+'" '+(selected===row.value?'selected':'')+'>'+esc(row.label)+'</option>').join('');
}
`;

export function patchFullTeamFiltersUi(source) {
  let out = String(source ?? '');
  if (out.includes('function fullTeamFilterOptions(')) return out;

  out = replaceOnce(out, 'function visible(ignoreResearch=false){', `${HELPERS}
function visible(ignoreResearch=false){`, 'visible() anchor');

  out = replaceOnce(
    out,
    "   var team=g.team||r?.player?.team||r?.context?.team,opp=r?.matchup?.opponent;\n   return g.rows.filter",
    "   var team=g.team||r?.player?.team||r?.context?.team,opp=fullTeamFilterOpponent(g,r);\n   if(advanced.team&&!fullTeamFilterSame(team,advanced.team))return false;\n   if(advanced.opponent&&!fullTeamFilterSame(opp,advanced.opponent))return false;\n   return g.rows.filter",
    'semantic team/opponent filter gate',
  );

  out = replaceOnce(
    out,
    "teams:advanced.team?[advanced.team]:[],opponents:advanced.opponent?[advanced.opponent]:[],games:",
    "teams:[],opponents:[],games:",
    'legacy exact team/opponent filter arrays',
  );

  out = replaceOnce(
    out,
    "options(gs.map(g=>g.team||researchFor(g)?.player?.team),advanced.team)",
    "fullTeamFilterOptions(gs,'team',advanced.team)",
    'Team dropdown options',
  );

  out = replaceOnce(
    out,
    "options(gs.map(g=>researchFor(g)?.matchup?.opponent),advanced.opponent)",
    "fullTeamFilterOptions(gs,'opponent',advanced.opponent)",
    'Opponent dropdown options',
  );

  return out;
}
