'use strict';
process.env.PORT = '8788';
process.env.HOSTS_FILE = require('path').join(__dirname, 'data', 'hosts.json.stop-test');
const path = require('path');
const fs = require('fs');
try { fs.unlinkSync(process.env.HOSTS_FILE); } catch (_) {}
fs.writeFileSync(process.env.HOSTS_FILE, '[]');

const server = require('./server.js');
const PORT = Number(process.env.PORT);
const BASE = 'http://127.0.0.1:' + PORT;

let failed = 0;
function ok(name) { console.log('  PASS  ' + name); }
function bad(name, e) { console.log('  FAIL  ' + name + ' :: ' + (e && e.message || e)); failed++; }

async function wait() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/api/hosts'); if (r.ok) return; } catch (_) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('server not up');
}

async function main() {
  await wait();

  // Create + start a host (will fail to SSH but session is created)
  const createRes = await fetch(BASE + '/api/hosts', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'stop-test', host: '10.255.255.1', port: 22, username: 'nobody', auth: { type: 'password', password: 'x' }, intervalMs: 500 }),
  });
  const host = await createRes.json();
  await fetch(BASE + '/api/hosts/' + host.id + '/start', { method: 'POST' });

  // Give the SSH attempt time to start (it will fail but tick() ran)
  await new Promise(r => setTimeout(r, 1500));

  // Check the session is in our internal map
  const session = server.sessions.get(host.id);
  if (!session) { bad('session exists', 'no session in map'); throw new Error('abort'); }
  ok('session created and registered');

  // Start a fresh tick that will hang on SSH (against unreachable IP)
  // Then call stop and verify it returns quickly
  const stopRes = await fetch(BASE + '/api/hosts/' + host.id + '/stop', { method: 'POST' });
  if (!stopRes.ok) { bad('stop endpoint', await stopRes.text()); throw new Error('abort'); }
  ok('POST /api/hosts/:id/stop returns 200');

  // Verify session.client was cleared and timer stopped
  const session2 = server.sessions.get(host.id);
  if (!session2) { bad('session retained for restart', 'removed from map'); throw new Error('abort'); }
  ok('session retained in map (for fast restart)');
  if (session2.running) { bad('session.running=false', 'still running'); throw new Error('abort'); }
  ok('session.running is false');
  if (session2.client !== null) { bad('session.client=null', 'still has client: ' + (session2.client && session2.client._connected)); throw new Error('abort'); }
  ok('session.client cleared (= no leaked SSH socket reference)');
  if (session2.timer) { bad('session.timer cleared', 'still has timer'); throw new Error('abort'); }
  ok('session.timer cleared (no more ticks)');

  // Verify status shows running=false
  const listRes = await fetch(BASE + '/api/hosts');
  const list = await listRes.json();
  if (list[0].status.running) { bad('running=false after stop', list[0].status); throw new Error('abort'); }
  ok('status.running is false after stop');

  // Reuse the same client to verify start/stop/start/stop cycle doesn't leak
  for (let i = 0; i < 3; i++) {
    await fetch(BASE + '/api/hosts/' + host.id + '/start', { method: 'POST' });
    await new Promise(r => setTimeout(r, 300));
    const stop2 = await fetch(BASE + '/api/hosts/' + host.id + '/stop', { method: 'POST' });
    if (!stop2.ok) { bad('cycle ' + i, await stop2.text()); throw new Error('abort'); }
    await new Promise(r => setTimeout(r, 300));
    const s = server.sessions.get(host.id);
    if (!s) { bad('cycle ' + i + ' session exists', 'missing'); throw new Error('abort'); }
    if (s.client !== null) { bad('cycle ' + i + ' client cleared', 'still has client'); throw new Error('abort'); }
    if (s.timer) { bad('cycle ' + i + ' timer cleared', 'still has timer'); throw new Error('abort'); }
  }
  ok('3x start/stop cycles: no leaked client/timer');

  // Cleanup
  await fetch(BASE + '/api/hosts/' + host.id, { method: 'DELETE' });
  fs.unlinkSync(process.env.HOSTS_FILE);
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
