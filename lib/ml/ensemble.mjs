// Dependency-free ensemble trainer for ObligeProps structured prop data.
// Components: regularized linear ridge + nonlinear boosted decision stumps.
// The neural component is deliberately not enabled until persistent training
// infrastructure can version and validate its artifacts; no fake NN label.

const finite=v=>typeof v==='number'&&Number.isFinite(v);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const sigmoid=z=>1/(1+Math.exp(-clamp(z,-30,30)));
const FEATURE_NAMES=Object.freeze(['l5Mean','l10Mean','l20Mean','seasonMean','l5OverRate','l10OverRate','l20OverRate','h2hMean','h2hOverRate','h2hGames','historyGames','isHome','restDays','opponentDefenseRank','marketOverProbability']);
function vector(row){return FEATURE_NAMES.map(k=>finite(row?.features?.[k])?row.features[k]:0);}
function solve(A,b){const n=b.length,M=A.map((r,i)=>[...r,b[i]]);for(let i=0;i<n;i++){let p=i;for(let r=i+1;r<n;r++)if(Math.abs(M[r][i])>Math.abs(M[p][i]))p=r;[M[i],M[p]]=[M[p],M[i]];if(Math.abs(M[i][i])<1e-10)return null;for(let r=i+1;r<n;r++){const f=M[r][i]/M[i][i];for(let c=i;c<=n;c++)M[r][c]-=f*M[i][c];}}const x=Array(n).fill(0);for(let i=n-1;i>=0;i--){let s=M[i][n];for(let c=i+1;c<n;c++)s-=M[i][c]*x[c];x[i]=s/M[i][i];}return x;}
function fitRidge(rows,lambda=3){const xs=rows.map(vector),ys=rows.map(r=>r.actual),k=FEATURE_NAMES.length+1,A=Array.from({length:k},()=>Array(k).fill(0)),b=Array(k).fill(0);for(let i=0;i<rows.length;i++){const x=[1,...xs[i]];for(let a=0;a<k;a++){b[a]+=x[a]*ys[i];for(let c=0;c<k;c++)A[a][c]+=x[a]*x[c];}}for(let i=1;i<k;i++)A[i][i]+=lambda;return solve(A,b);}
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
function ridgePredict(weights,row){return Math.max(0,dot(weights,[1,...vector(row)]));}
function fitStumps(rows,basePred,{rounds=24,learningRate=.08}={}){let pred=rows.map((r,i)=>basePred[i]),trees=[];for(let round=0;round<rounds;round++){let best=null;for(let f=0;f<FEATURE_NAMES.length;f++){const vals=rows.map(r=>vector(r)[f]).sort((a,b)=>a-b),threshold=vals[Math.floor(vals.length/2)];let l=[],rr=[];for(let i=0;i<rows.length;i++)(vector(rows[i])[f]<=threshold?l:rr).push(rows[i].actual-pred[i]);if(!l.length||!rr.length)continue;const lm=l.reduce((a,b)=>a+b,0)/l.length,rm=rr.reduce((a,b)=>a+b,0)/rr.length,error=rows.reduce((s,r,i)=>s+(r.actual-(pred[i]+learningRate*(vector(r)[f]<=threshold?lm:rm)))**2,0);if(!best||error<best.error)best={f,threshold,left:lm,right:rm,error};}if(!best)break;trees.push(best);for(let i=0;i<rows.length;i++)pred[i]+=learningRate*(vector(rows[i])[best.f]<=best.threshold?best.left:best.right);}return {trees,learningRate};}
function boostedPredict(model,row){const x=vector(row);return model.trees.reduce((s,t)=>s+model.learningRate*(x[t.f]<=t.threshold?t.left:t.right),0);}
function residualSigma(rows,predict){const e=rows.map(r=>r.actual-predict(r));return Math.max(.35,Math.sqrt(e.reduce((s,v)=>s+v*v,0)/Math.max(1,e.length)));}
export function trainEnsemble(rows=[],options={}){
 const clean=(Array.isArray(rows)?rows:[]).filter(r=>finite(r?.actual)&&finite(r?.line)&&r?.features);if(clean.length<30)return {available:false,code:'INSUFFICIENT_TRAINING_ROWS',rows:clean.length};
 const ridge=fitRidge(clean,options.lambda||3);if(!ridge)return {available:false,code:'RIDGE_FIT_FAILED',rows:clean.length};
 const base=clean.map(r=>ridgePredict(ridge,r)),boost=fitStumps(clean,base,options),predict=r=>Math.max(0,ridgePredict(ridge,r)+boostedPredict(boost,r)),sigma=residualSigma(clean,predict);
 return {available:true,version:'ensemble-v1',featureNames:FEATURE_NAMES,ridge,boost,sigma,rows:clean.length,predict(row){const projection=predict(row),z=(projection-row.line)/sigma,probabilityOver=sigmoid(z*1.6);return {projection,probabilityOver,probabilityUnder:1-probabilityOver,probabilityPush:0};}};
}
