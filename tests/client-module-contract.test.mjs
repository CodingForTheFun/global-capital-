import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('every direct research UI module import is served by the production asset allowlist',()=>{
 const frontend=readFileSync(new URL('../apex-v2/scout-ui-v5.js',import.meta.url),'utf8');
 const server=readFileSync(new URL('../frontdoor-prod.mjs',import.meta.url),'utf8');
 const list=server.slice(server.indexOf('const CLIENT_MODULES ='),server.indexOf('CLIENT_MODULES.set'));
 const allowed=new Set([...list.matchAll(/'(lib\/[^']+\.mjs)'/g)].map(m=>m[1]));
 const imports=[...frontend.matchAll(/import\('\/assets\/(lib\/[^']+\.mjs)'\)/g)].map(m=>m[1]);
 assert.ok(imports.length>10);
 for(const file of imports)assert.ok(allowed.has(file),`${file} must be served in production`);
});
