import test from 'node:test';
import assert from 'node:assert/strict';
import { ownsPath, serveNewWeb } from '../lib/web/new-web.mjs';

test('only exact install assets are added to the public frontend bridge', () => {
  for (const path of ['/app.webmanifest','/app-worker.js','/app-icons/180.png','/app-icons/192.png','/app-icons/512.png']) assert.equal(ownsPath(path), true, path);
  for (const path of ['/api/account/me','/api/apex/props','/api/apex/research','/api/account/login','/owner','/checkout','/app-icons/secret','/app-worker.js/other']) assert.equal(ownsPath(path), false, path);
});
test('install asset bridge preserves worker security headers and does not proxy POST', async () => {
  let called = false; const response = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end() {} };
  const fetchImpl = async () => { called = true; return new Response('worker', { headers: { 'content-type':'application/javascript', 'service-worker-allowed':'/', 'cache-control':'no-store' } }); };
  assert.equal(await serveNewWeb({ method:'POST',url:'/app-worker.js',headers:{} },response,{origin:'https://frontend.example',fetchImpl}),false);
  assert.equal(called,false);
  assert.equal(await serveNewWeb({ method:'GET',url:'/app-worker.js',headers:{} },response,{origin:'https://frontend.example',fetchImpl}),true);
  assert.equal(response.headers['service-worker-allowed'],'/');
  assert.equal(response.headers['cache-control'],'no-store');
});
