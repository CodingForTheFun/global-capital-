import test from 'node:test';
import assert from 'node:assert/strict';
import {trainEnsemble} from '../lib/ml/ensemble.mjs';

function rows(n=80){return Array.from({length:n},(_,i)=>{const season=15+(i%11),h2h=i%4?season:season+3,line=20.5,actual=season+(i%3)-1;return {actual,line,features:{l5Mean:season,l10Mean:season-.3,l20Mean:season-.5,seasonMean:season-.7,l5OverRate:actual>line?.7:.3,l10OverRate:.5,l20OverRate:.5,h2hMean:h2h,h2hOverRate:h2h>line?.7:.3,h2hGames:i%6,historyGames:20+i,isHome:i%2,restDays:2,opponentDefenseRank:1+i%30,marketOverProbability:.5}};});}
test('ensemble trains real ridge and nonlinear boosted components',()=>{
 const model=trainEnsemble(rows());assert.equal(model.available,true);assert.equal(model.version,'ensemble-v1');assert.ok(model.ridge.length>1);assert.ok(model.boost.trees.length>0);assert.ok(model.sigma>0);
 const p=model.predict(rows()[20]);assert.ok(Number.isFinite(p.projection));assert.ok(p.probabilityOver>0&&p.probabilityOver<1);assert.ok(Math.abs(p.probabilityOver+p.probabilityUnder-1)<1e-9);
});
test('ensemble refuses tiny datasets instead of pretending to train',()=>{const m=trainEnsemble(rows(12));assert.equal(m.available,false);assert.equal(m.code,'INSUFFICIENT_TRAINING_ROWS');});
