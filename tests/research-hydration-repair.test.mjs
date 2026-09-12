import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../apex-v2/scout-ui-v5.js',import.meta.url),'utf8');
function functionText(name,next){
 const start=source.indexOf(`function ${name}(`);
 assert.ok(start>=0,name);
 return source.slice(start,source.indexOf(`function ${next}(`,start));
}
function harness({missing=false,never=false}={}){
 const calls=[],renders=[],timers=[];
 const ctx={AbortController,Date,JSON,Map,Set,Promise,
  loadGeneration:1,sport:'NFL',loading:false,hydrating:false,hydrateFailed:false,hydrateController:null,
  hydrated:new Set(),researchCache:new Map(),researchInflight:new Map(),
  setTimeout(fn,ms){const t={fn,ms,cleared:false};timers.push(t);return t;},
  clearTimeout(t){t.cleared=true;},
  researchKey:(g,l,s)=>`${g.sport}:${g.key}:${l}:${s}`,
  boardLine:g=>g.line,defaultSide:()=> 'OVER',renderBatchControl(){},
  hydrateTargets(){const g={key:'a',sport:ctx.sport,playerName:'Test Player',market:'Points',line:10};
   return ctx.hydrated.has(ctx.hydrateKeyFor(g))?[]:[g];},
  nativeFetch(url,options){calls.push({url,options});
   return new Promise((resolve,reject)=>{
    options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});
    if(never||calls.length===1)return;
    const props=JSON.parse(options.body).props;
    resolve({ok:true,json:async()=>({results:missing?{}:Object.fromEntries(props.map(p=>[p.key,{available:true,marker:p.sport}]))})});
   });
  },
  renderListLight(){renders.push({sport:ctx.sport,failed:ctx.hydrateFailed});if(!ctx.hydrateFailed)ctx.next=ctx.hydrateBoard();}
 };
 vm.createContext(ctx);
 vm.runInContext(functionText('hydrateKeyFor','hydrateTargets'),ctx);
 vm.runInContext('async '+functionText('hydrateBoard','renderBatchControl'),ctx);
 return {ctx,calls,renders,timers};
}
test('a sport switch aborts obsolete research and automatically resumes the newly visible board',async()=>{
 const {ctx,calls,renders,timers}=harness();
 const old=ctx.hydrateBoard();
 assert.equal(calls.length,1);assert.equal(ctx.hydrating,true);
 ctx.loadGeneration++;ctx.sport='NBA';ctx.hydrated.clear();ctx.hydrateFailed=false;
 ctx.hydrateController.abort();
 await ctx.hydrateBoard(); // The new board rendered while the old request held the lock.
 await old;await ctx.next;
 assert.equal(calls.length,2);assert.equal(ctx.hydrating,false);assert.equal(ctx.hydrateFailed,false);
 assert.ok(renders.every(r=>r.sport==='NBA'&&!r.failed));
 assert.ok([...ctx.researchCache.values()].every(r=>r.value.marker==='NBA'));
 assert.ok(timers.every(t=>t.cleared));
 assert.match(functionText('load','toast'),/hydrateController\?\.abort\(\)/);
});
test('a stuck research batch times out, releases the lock and offers a retry without automatic loops',async()=>{
 const {ctx,calls,renders,timers}=harness({never:true});
 const result=ctx.hydrateBoard();
 assert.equal(timers[0].ms,90000);timers[0].fn();await result;
 assert.equal(ctx.hydrating,false);assert.equal(ctx.hydrateFailed,true);
 assert.equal(ctx.hydrateController,null);assert.equal(calls.length,1);assert.equal(renders.length,1);
});
test('a partial batch response exposes retry rather than silently marking the missing row loaded',async()=>{
 const {ctx,calls}=harness({missing:true});
 const old=ctx.hydrateBoard();ctx.loadGeneration++;ctx.sport='NBA';ctx.hydrated.clear();ctx.hydrateController.abort();
 await old;await ctx.next;
 assert.equal(calls.length,2);assert.equal(ctx.hydrating,false);assert.equal(ctx.hydrateFailed,true);assert.equal(ctx.researchCache.size,0);
});
test('research presentation separates missing, unsupported, unmatched and push-only samples',()=>{
 const ctx={hydrateFailed:false,esc:v=>String(v),num:v=>v==null?null:Number(v),rateTone:()=>'',badge:(...v)=>v};
 vm.createContext(ctx);
 vm.runInContext(functionText('researchEmptyLabel','ringGauge'),ctx);
 vm.runInContext(functionText('windowBadge','h2hBadge'),ctx);
 assert.equal(ctx.researchEmptyLabel(null),'Loading research');ctx.hydrateFailed=true;
 assert.equal(ctx.researchEmptyLabel(null),'Retry research');
 assert.equal(ctx.researchEmptyLabel({code:'UNSUPPORTED_MARKET'}),'Unsupported stat');
 assert.equal(ctx.researchEmptyLabel({code:'PLAYER_NOT_FOUND'}),'Player unmatched');
 assert.equal(ctx.researchEmptyLabel({code:'NO_GAME_LOG_DATA'}),'No completed games');
 assert.equal(ctx.researchEmptyLabel({available:true,gameLog:[{value:0}]}),'No decided games');
 const result=ctx.windowBadge({available:true,season:'2026',windows:{season:{games:2,hitRate:50}}},'season','SZN','season');
 assert.equal(result[2],'50%');assert.match(result[4],/2026/);
 assert.match(source,/ringGauge\(gaugeRates\(r,side\),r\)/);
});
