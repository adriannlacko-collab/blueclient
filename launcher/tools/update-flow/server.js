'use strict';
// A fake of GitHub's release downloads and blueclient.net's feed.
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const PORT = Number(process.env.PORT);
const TAR = process.env.TAR;
let mode = process.env.MODE || 'ok';
const counts = { manifest: 0, archive: 0 };
const body = fs.readFileSync(TAR);
const sha = crypto.createHash('sha512').update(body).digest('base64');
http.createServer((req, res) => {
  if (req.url === '/__mode') { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { mode = b; res.end('ok'); }); return; }
  if (req.url === '/__counts') return res.end(JSON.stringify(counts));
  if (req.url.endsWith('/releases/latest/download/bundle.json')) {
    counts.manifest++;
    const m = { version: process.env.NEXT || '1.12.0', electron: mode === 'electron' ? '45.0.0' : '44.4.3', sha512: mode === 'badsha' ? sha.replace(/^./, sha[0] === 'A' ? 'B' : 'A') : sha, size: body.length };
    const delay = mode === 'slow' ? 800 : 0;
    return setTimeout(() => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(m)); }, delay);
  }
  if (req.url.endsWith('/releases/latest/download/bundle.tar.gz')) {
    counts.archive++;
    res.writeHead(302, { location: 'https://objects.githubusercontent.com/release-asset/bundle.tar.gz' });
    return res.end();
  }
  if (req.url.startsWith('/objects.githubusercontent.com/')) {
    res.writeHead(200, { 'content-length': body.length });
    if (mode === 'drop') { res.write(body.subarray(0, 1024)); return setTimeout(() => res.destroy(), 100); }
    return res.end(body);
  }
  if (req.url.startsWith('/blueclient.net/latest.json')) return res.end(JSON.stringify({ version: '1.11.0' }));
  res.writeHead(404); res.end();
}).listen(PORT, '127.0.0.1');
