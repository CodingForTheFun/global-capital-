const ENGINE='Auto Scout Adaptive';
export const ADAPTIVE_SPORTS=Object.freeze(['NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','MLS','EPL','UCL']);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
function sd(a){if(a.length<2)return 0;const m=mean(a);return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/(a.length-1));}
function slope(a){if(a.length<2)return 0;const n=a.length,mx=(n-1)/2,my=mean(a);let num=0,den=0;for(let i=0;i<n;i++){num+=(i-mx)*(a[i]-my);den+=(i-mx)**2;}return den?num/den:0;}
function normalCdf(x){const sign=x<0?-1:1,z=Math.abs(x)/Math.sqrt(2),t=1/(1+.3275911*z);const erf=sign*(1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-z*z));return .5*(1+erf);}
function solve(A,b){const n=b.length,M=A.map((r,i)=>[...r,b[i]]);for(let i=0;i<n;i++){let p=i;for(let r=i+1;r<n;r++)if(Math.abs(M[r][i])>Math.abs(M[p][i]))p=r;[M[i],M[p]]=[M[p],M[i]];if(Math.abs(M[i][i])<1e-10)return null;for(let r=i+1;r<n;r++){const f=M[r][i]/M[i][i];for(let c=i;c<=n;c++)M[r][c]-=f*M[i][c];}}const x=Array(n).fill(0);for(let i=n-1;i>=0;i--){let s=M[i][n];for(let c=i+1;c<n;c++)s-=M[i][c]*x[c];x[i]=s/M[i][i];}return x;}
function buildFeature(history){const last=history[history.length-1],m3=mean(history.slice(-3)),m10=mean(history.slice(-10)),sl=slope(history.slice(-5));return [1,last-m10,m3-m10,sl];}
function fit(rows){if(rows.length<4)return null;const k=rows[0].x.length,A=Array.from({length:k},()=>Array(k).fill(0)),b=Array(k).fill(0),last=rows[rows.length-1].i;for(const row of rows){const w=Math.pow(.5,(last-row.i)/8);for(let r=0;r<k;r++){b[r]+=w*row.x[r]*row.y;for(let c=0;c<k;c++)A[r][c]+=w*row.x[r]*row.x[c];}}const lambda=Math.max(.75,6/Math.sqrt(rows.length));for(let j=1;j<k;j++)A[j][j]+=lambda;return solve(A,b);}
function dot(a,b){return a.reduce((s,v,i)=>s+v*b[i],0);}
function cleanLogs(gameLog){const seen=new Set();return (Array.isArray(gameLog)?gameLog:[]).filter(r=>r&&finite(Number(r.value))&&Number(r.value)>=0&&Number.isFinite(Date.parse(r.date||''))).map(r=>({...r,value:Number(r.value),ts:Date.parse(r.date)})).sort((a,b)=>a.ts-b.ts).filter(r=>{const k=String(r.gameId||r.date||r.ts);if(seen.has(k))return false;seen.add(k);return true;});}
function trainingRows(values){const rows=[];for(let i=5;i<values.length;i++){const hist=values.slice(0,i),base=mean(hist.slice(-10));rows.push({i,x:buildFeature(hist),y:values[i]-base,base,target:values[i]});}return rows;}
function walkForward(values){const rows=trainingRows(values),out=[];for(let idx=Math.max(4,rows.length-8);idx<rows.length;idx++){const coeff=fit(rows.slice(0,idx));if(!coeff)continue;const r=rows[idx],pred=Math.max(0,r.base+dot(r.x,coeff));out.push({actual:r.target,pred,baseline:r.base,residual:r.target-pred});}return out;}
function integerLike(values){return values.length>0&&values.every(v=>Math.abs(v-Math.round(v))<1e-9);}
function probs(projection,line,sigma,discrete){if(!(finite(projection)&&finite(line)&&finite(sigma)&&sigma>0))return null;if(discrete&&Math.abs(line-Math.round(line))<1e-9){const low=(line-.5-projection)/sigma,high=(line+.5-projection)/sigma,under=normalCdf(low),push=Math.max(0,normalCdf(high)-under),over=Math.max(0,1-normalCdf(high));const sum=over+under+push;return {over:over/sum,under:under/sum,push:push/sum};}const z=(line-projection)/sigma,under=normalCdf(z),over=1-under;return {over,under,push:0};}
export function adaptivePrediction({research,target,now=Date.now()}={}){
 const sport=String(target?.sport||'').toUpperCase();
 if(!ADAPTIVE_SPORTS.includes(sport))return {available:false,modelled:true,engine:ENGINE,code:'SPORT_NOT_SUPPORTED',message:'No adaptive history model is configured for this sport.'};
 if(!research?.available)return {available:false,modelled:true,engine:ENGINE,code:research?.code||'NO_GAME_LOG_DATA',message:research?.message||'Verified game history is unavailable for this prop.'};
 const logs=cleanLogs(research.gameLog),values=logs.map(r=>r.value);
 if(values.length<8)return {available:false,modelled:true,engine:ENGINE,code:'MODEL_NOT_READY',message:'At least 8 verified completed games are required for the adaptive model.'};
 const rows=trainingRows(values),coeff=fit(rows);if(!coeff)return {available:false,modelled:true,engine:ENGINE,code:'MODEL_NOT_READY',message:'There is not enough stable history to fit this prop model yet.'};
 const base=mean(values.slice(-10)),raw=Math.max(0,base+dot(buildFeature(values),coeff)),recentSd=sd(values.slice(-10));
 const checks=walkForward(values),modelRmse=checks.length?Math.sqrt(mean(checks.map(r=>(r.actual-r.pred)**2))):null,baseRmse=checks.length?Math.sqrt(mean(checks.map(r=>(r.actual-r.baseline)**2))):null;
 const sampleFactor=clamp((values.length-7)/13,.35,1),qualityFactor=modelRmse&&baseRmse?clamp(baseRmse/modelRmse,.45,1.15):.65;
 let projection=base+(raw-base)*sampleFactor*Math.min(1,qualityFactor);
 const opponent=research?.matchup?.opponent||research?.opponent||null;
 if(opponent){const h2h=logs.filter(r=>String(r.opponent||'').toUpperCase()===String(opponent).toUpperCase()).map(r=>r.value);if(h2h.length>=2){const adj=(mean(h2h)-base)*(h2h.length/(h2h.length+6));projection+=clamp(adj,-Math.max(.5,recentSd*.5),Math.max(.5,recentSd*.5));}}
 projection=Math.max(0,projection);
 const residuals=checks.map(r=>r.residual),sigma=Math.max(.35,checks.length>=3?Math.sqrt(mean(residuals.map(v=>v*v))):recentSd||.35,recentSd*.35);
 const line=Number(target?.line),p=probs(projection,line,sigma,integerLike(values.slice(-20)));if(!p)return {available:false,modelled:true,engine:ENGINE,code:'TARGET_UNVERIFIED',message:'A valid current line is required for an adaptive probability estimate.'};
 const generated=new Date(now).toISOString(),start=Date.parse(target?.gameStartTime||''),expiresAt=new Date(Math.min(Number.isFinite(start)?start:now+10*60_000,now+10*60_000)).toISOString();
 const featureCutoff=new Date(logs[logs.length-1].ts).toISOString();
 return {...target,available:true,modelled:true,engine:ENGINE,code:'READY',modelVersion:'adaptive-ridge-v1',projection,
  probabilityOver:p.over,probabilityUnder:p.under,probabilityPush:p.push,generatedAt:generated,expiresAt,featureCutoff,
  validation:{method:'rolling-player-history',observations:checks.length,events:checks.length,rmse:modelRmse,baselineRmse:baseRmse},
  sampleSize:values.length,sourceKind:'verified-history-adaptive-model',
  message:'Adaptive model estimate trained only on this player’s verified completed game history. Not a guarantee or measured statistic.'};
}
