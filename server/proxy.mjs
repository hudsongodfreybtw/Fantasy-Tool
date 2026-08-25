#!/usr/bin/env node
/* Fallback only. The app talks to api.sleeper.app straight from the browser,
   which is how it should work. If that ever fails (a network that blocks it,
   or a CORS surprise), run this on a laptop on the same wifi:

       node server/proxy.mjs                # serves the app + a Sleeper proxy

   then open http://<laptop-ip>:8080 on your phone and set
   "Proxy base" to the same origin on the Draft tab.

   Zero dependencies. Read-only: it forwards GET requests to Sleeper's v1 API
   and nothing else.                                                          */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 8080;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // ---- Sleeper passthrough -------------------------------------------------
  if (url.pathname.startsWith('/v1/')) {
    if (req.method !== 'GET') { res.writeHead(405); return res.end('GET only'); }
    const upstream = 'https://api.sleeper.app' + url.pathname + url.search;
    https.get(upstream, { headers: { 'user-agent': 'draft-room-proxy' } }, (up) => {
      res.writeHead(up.statusCode || 502, {
        'Content-Type': up.headers['content-type'] || 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      });
      up.pipe(res);
    }).on('error', (e) => {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: e.message }));
    });
    return;
  }

  // ---- static app ----------------------------------------------------------
  let p = path.join(ROOT, decodeURIComponent(url.pathname));
  if (url.pathname === '/' || url.pathname === '') p = path.join(ROOT, 'index.html');
  if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end('no'); }
  fs.readFile(p, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(PORT, () => {
  const nets = Object.values(os.networkInterfaces()).flat()
    .filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
  console.log('Draft Room on:');
  console.log('  http://localhost:' + PORT);
  nets.forEach(ip => console.log('  http://' + ip + ':' + PORT + '   <- use this on your phone'));
  console.log('\nSleeper proxy live at /v1/*  (set "Proxy base" on the Draft tab if you need it)');
});
