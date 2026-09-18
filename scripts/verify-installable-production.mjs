import assert from 'node:assert/strict';
const release = 'oblige-installable-20260918';
const origins = ['https://www.obligeprops.com', 'https://oblige-web-production.up.railway.app'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const get = (origin, path) => fetch(origin + path, { signal: AbortSignal.timeout(15000), redirect: 'follow', headers: { 'cache-control': 'no-cache' } });
let lastFailure = '';
for (let attempt = 1; attempt <= 60; attempt++) {
  try {
    for (const origin of origins) {
      const response = await get(origin, '/app.webmanifest');
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-oblige-app-release'), release);
      const manifest = await response.json();
      assert.equal(manifest.start_url, '/board'); assert.equal(manifest.display, 'standalone');
      const worker = await get(origin, '/app-worker.js');
      assert.equal(worker.status, 200); assert.equal(worker.headers.get('service-worker-allowed'), '/');
      assert.match(worker.headers.get('cache-control'), /no-store/);
      assert.match(worker.headers.get('content-type'), /javascript/);
      assert.ok((await worker.text()).includes(release));
      for (const size of [180, 192, 512]) {
        const icon = await get(origin, `/app-icons/${size}.png`); assert.equal(icon.status, 200);
        const png = Buffer.from(await icon.arrayBuffer());
        assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
      }
      for (const path of ['/', '/board', '/research', '/account']) {
        const page = await get(origin, path); assert.equal(page.status, 200);
        const html = await page.text(); assert.ok(html.includes('/app.webmanifest'), `${origin}${path} missing install metadata`);
        assert.ok(html.includes('/app-icons/180.png'), `${origin}${path} missing iPhone icon`);
      }
    }
    const health = await get(origins[0], '/api/health'); assert.equal(health.status, 200);
    // Verify that no unauthenticated identity was gained. No credentials or
    // provider calls, mutations, account creation, or raw health body logging.
    const me = await get(origins[0], '/api/account/me');
    if (me.status === 200) { const account = await me.json(); assert.notEqual(account.authenticated, true); assert.ok(!account.user?.id); }
    else assert.ok([401, 403].includes(me.status), 'Intentional unauthenticated status');
    console.log(JSON.stringify({ status: 'PASS', release, checkedAt: new Date().toISOString(), origins, manifest: 'standalone', startUrl: '/board', icons: [180, 192, 512], workerScope: '/', pages: ['/', '/board', '/research', '/account'], healthHttp: health.status, unauthenticatedIdentity: 'preserved' }));
    process.exit(0);
  } catch (error) {
    lastFailure = error.message.split('\n')[0];
    console.log(`Deployment verification attempt ${attempt}/60: not ready (${lastFailure})`);
    if (attempt < 60) await sleep(10000);
  }
}
throw new Error(`Installable release not verified on both production surfaces: ${lastFailure}`);
