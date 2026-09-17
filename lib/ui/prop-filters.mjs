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
 let primary=field('opponent','Opponent',options('opponent'))+field('season','Season',options('season'));
 primary+='<label>Home / Away<select class="asControl" id="asPropVenue">'+[['all','All'],['home','Home'],['away','Away'],['h2h','Upcoming opponent']].map(([v,l])=>'<option value="'+v+'" '+(venue===v?'selected':'')+'>'+l+'</option>').join('')+'</select></label>';
 primary+=field('team','Team',options('team'));
 let advanced='';
 if(rows.some(r=>typeof r.started==='boolean'))advanced+=field('starter','Starting role',[['all','All'],['yes','Started'],['no','Did not start']]);
 if(rows.some(r=>number(r.minutes)!==null))advanced+=field('minMinutes','Minimum minutes',[['all','Any'],...['10','15','20','25','30','35','40'].map(v=>[v,v+'+ minutes'])]);
 if(rows.some(r=>number(r.pitchingOuts)!==null))advanced+=field('minOuts','Minimum innings',[['all','Any'],...[1,2,3,4,5,6,7,8,9].map(v=>[String(v*3),v+' IP ('+v*3+' outs)'])]);
 const active=venue!=='all'||Object.values(filters||{}).some(selected);
 const sliders='<svg class="asFilterSliders" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6"/></svg>';
 const extra=advanced||'<span class="asNoAdvancedFilters">No additional recorded filters for this sample.</span>';
 return '<div class="asPropFilterGrid">'+primary+'<details class="asMorePropFilters asFilterMenu"><summary aria-label="Advanced prop filters" title="Advanced filters">'+sliders+'</summary><div class="asAdvancedFilterPanel">'+extra+'<button type="button" class="asCompactClearFilters" id="asClearPropFilters" '+(active?'':'disabled')+'>Clear filters</button></div></details></div>';
}
