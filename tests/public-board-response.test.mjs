import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {publicJsonChunks,writePublicBoard} from '../lib/autoscout/public-board-response.mjs';
import {sanitizePublicPayload} from '../lib/public-sanitize.mjs';
test('streamed board exactly preserves existing sanitizer output and data shape',()=>{
 const board={props:[{playerName:'Player',sport:'MLB',market:'Strikeouts',side:'OVER',line:5.5,price:-115,sportsbook:'DraftKings',provider:'The Odds API',apiKey:'must-drop',nullValue:null}],data:{events:[{id:'event',commenceTime:'2099-01-01'}],lines:[{side:'UNDER',price:-105}]},meta:{quota:{remaining:123},provider:'The Odds API',warning:'Provider quota unavailable',stale:true},missing:undefined};
 assert.deepEqual(JSON.parse([...publicJsonChunks(board)].join('')),sanitizePublicPayload(JSON.parse(JSON.stringify(board))));
});
test('large props response streams complete JSON under backpressure without giant chunks',async()=>{
 const board={props:Array.from({length:23000},(_,i)=>({id:i,playerName:'Fixture',line:5.5,side:i%2?'UNDER':'OVER',price:-110,autoScout:{checks:[{detail:'Fixture data '.repeat(30)}]}})),meta:{stale:true}};
 assert.ok(Math.max(...[...publicJsonChunks(board)].map(s=>s.length))<2048);
 const errors=[];const server=http.createServer((req,res)=>{void writePublicBoard(res,board).catch(e=>{errors.push(e);res.destroy();});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const response=await fetch(`http://127.0.0.1:${server.address().port}`);const actual=await response.json();
  assert.equal(response.status,200);assert.equal(actual.props.length,23000);assert.equal(actual.props[22999].price,-110);assert.deepEqual(errors,[]);
 }finally{await new Promise(r=>server.close(r));}
});
