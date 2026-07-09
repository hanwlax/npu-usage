'use strict';
process.env.PORT = '8787';
const fs = require('fs');
const path = require('path');
const HOSTS_FILE = path.join(__dirname, 'data', 'hosts.json');

const server = require('./server.js');
server.startBackend();
const PORT = Number(process.env.PORT);
const BASE = 'http://127.0.0.1:' + PORT;

async function wait() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/api/hosts'); if (r.ok) return; } catch (_) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('server not up');
}

async function main() {
  await wait();
  const before = fs.readFileSync(HOSTS_FILE, 'utf8');
  console.log('--- BEFORE ---');
  console.log(before);

  const res = await fetch(BASE + '/api/hosts', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'persist-test', host: '10.0.0.1', username: 'root', auth: { type: 'password', password: 'x' } }),
  });
  const created = await res.json();
  console.log('Created id:', created.id);

  await new Promise(r => setTimeout(r, 200));
  const after = fs.readFileSync(HOSTS_FILE, 'utf8');
  console.log('--- AFTER ---');
  console.log(after);

  const arr = JSON.parse(after);
  const found = arr.find(h => h.id === created.id);
  if (!found) { console.log('FAIL: not in file'); process.exit(1); }
  console.log('PASS: persisted to file');

  // cleanup
  await fetch(BASE + '/api/hosts/' + created.id, { method: 'DELETE' });
  await new Promise(r => setTimeout(r, 100));
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
