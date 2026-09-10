import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readSavedProps, updateSavedProps, normalizeSavedProp } from '../lib/autoscout/saved-props.mjs';
test('server saves isolate access profiles, persist snapshots, and serialize writes',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'autoscout-saves-')),previous=process.env.DATA_DIR;
  process.env.DATA_DIR=root;
  const a={authenticated:true,role:'member',subject:'alice'},b={authenticated:true,role:'member',subject:'bob'};
  const prop=key=>({key,sport:'NFL',playerName:'Test player',market:'Pass Yards',rows:[{side:'OVER',line:0,price:null,isAlternate:false}]});
  try{await Promise.all([updateSavedProps(a,prop('a')),updateSavedProps(a,prop('b'))]);assert.equal((await readSavedProps(a)).length,2);assert.deepEqual(await readSavedProps(b),[]);await updateSavedProps(a,{key:'a'},true);assert.equal((await readSavedProps(a))[0].key,'b');await assert.rejects(()=>readSavedProps({authenticated:false}));assert.equal(normalizeSavedProp(prop('zero')).rows[0].line,0);assert.throws(()=>normalizeSavedProp({...prop('bad'),rows:[{side:'OVER',line:null}]}));}
  finally{if(previous===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=previous;await fs.rm(root,{recursive:true,force:true});}
});
