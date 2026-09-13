const number=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const selected=v=>typeof v==='string'&&v!==''&&v!=='all';
export function filterPropResearch(base,filters={}){
 if(!base)return base;
 const active=['opponent','season','team','starter','minMinutes','minOuts'].some(k=>selected(filters[k]));
 if(!active)return base;
 const rows=(base.gameLog||[]).filter(row=>{
  if(selected(filters.opponent)&&String(row.opponent||'')!==filters.opponent)return false;
  if(selected(filters.season)&&String(row.season??'')!==filters.season)return false;
  if(selected(filters.team)&&String(row.team||'')!==filters.team)return false;
  if(selected(filters.starter)&&(typeof row.started!=='boolean'||row.started!==(filters.starter==='yes')))return false;
  if(selected(filters.minMinutes)&&(number(row.minutes)===null||row.minutes<Number(filters.minMinutes)))return false;
  if(selected(filters.minOuts)&&(number(row.pitchingOuts)===null||row.pitchingOuts<Number(filters.minOuts)))return false;
  return true;
 });
 return {...base,gameLog:rows,season:selected(filters.season)?filters.season:base.season,
  context:{...base.context,seasonAverage:null,seasonStat:null,averageMinutes:null},
  coverage:{...base.coverage,seasonComplete:false},cohortFiltered:true};
}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function propFiltersHtml(base,filters={},venue='all'){
 const rows=base?.gameLog||[];
 const field=(key,label,options)=>'<label>'+label+'<select class="asControl" id="asPropFilter-'+key+'" data-prop-filter="'+key+'">'+options.map(([value,name])=>'<option value="'+esc(value)+'" '+((filters[key]||'all')===value?'selected':'')+'>'+esc(name)+'</option>').join('')+'</select></label>';
 const options=key=>[['all','All'],...[...new Set(rows.map(r=>r[key]).filter(v=>v!==null&&v!==undefined&&String(v).trim()))].map(v=>[String(v),String(v)]).sort((a,b)=>b[0].localeCompare(a[0]))];
 let html=field('opponent','Opponent',options('opponent'))+field('season','Season',options('season'));
 html+='<label>Home / Away<select class="asControl" id="asPropVenue">'+[['all','All'],['home','Home'],['away','Away'],['h2h','Upcoming opponent']].map(([v,l])=>'<option value="'+v+'" '+(venue===v?'selected':'')+'>'+l+'</option>').join('')+'</select></label>';
 html+=field('team','Team',options('team'));
 const primary=html;html='';
 if(rows.some(r=>typeof r.started==='boolean'))html+=field('starter','Starting role',[['all','All'],['yes','Started'],['no','Did not start']]);
 if(rows.some(r=>number(r.minutes)!==null))html+=field('minMinutes','Minimum minutes',[['all','Any'],...['10','15','20','25','30','35','40'].map(v=>[v,v+'+ minutes'])]);
 if(rows.some(r=>number(r.pitchingOuts)!==null))html+=field('minOuts','Minimum innings',[['all','Any'],...[1,2,3,4,5,6,7,8,9].map(v=>[String(v*3),v+' IP ('+v*3+' outs)'])]);
 return '<div class="asPropFilterGrid">'+primary+'</div>'+(html?'<details class="asMorePropFilters"><summary>More filters</summary><div class="asPropFilterGrid">'+html+'</div></details>':'')+'<button class="asBtn" id="asClearPropFilters">Reset prop filters</button><p class="asNotice asFilterHint">Recorded games only · filters exclude missing values.</p>';
}
