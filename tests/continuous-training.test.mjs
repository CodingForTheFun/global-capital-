import test from 'node:test';
import assert from 'node:assert/strict';
import {promotionDecision} from '../lib/ml/continuous-training.mjs';

function rows({n=60,error=1,p=.7}={}){
 return Array.from({length:n},(_,i)=>{const over=i%10<7,line=4.5,actual=over?6:3;return {eventId:'e'+Math.floor(i/2),line,actual,projection:actual+(i%2?error:-error),probabilityOver:p};});
}
test('challenger promotes only with enough events, better error and preserved calibration',()=>{
 const decision=promotionDecision({championRows:rows({error:2}),challengerRows:rows({error:1})});
 assert.equal(decision.promote,true);
});
test('small challenger never auto-promotes',()=>{
 const decision=promotionDecision({championRows:rows({error:2}),challengerRows:rows({n:12,error:.5})});
 assert.equal(decision.promote,false);assert.ok(decision.reasons.includes('INSUFFICIENT_GRADED'));
});
test('overconfident challenger is blocked even when projection error improves',()=>{
 const challenger=rows({error:.5,p:.99}).map((r,i)=>({...r,probabilityOver:i%10<7?.99:.99}));
 const decision=promotionDecision({championRows:rows({error:2}),challengerRows:challenger});
 assert.equal(decision.promote,false);assert.ok(decision.reasons.includes('CALIBRATION_FAILED'));
});
