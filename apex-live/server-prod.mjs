import http from 'node:http';
import { handleApexRequest } from './handler.mjs';

const port = Number(process.env.PORT || 3001);
const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  Promise.resolve(handleApexRequest(req, res, url)).then((handled) => {
    if (handled || res.headersSent) return;
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }).catch((error) => {
    console.error('[Apex Props] unhandled request failure', error?.message || error);
    if (res.headersSent) return res.destroy();
    const body = JSON.stringify({ ok: false, error: 'Apex Props could not complete that request.' });
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  });
});

server.listen(port, '0.0.0.0', () => console.log(`Apex Props production listening on 0.0.0.0:${port}`));
