'use strict';
process.env.PORT = process.env.PORT || '8787';
const path = require('path');
const fs = require('fs');

const TEST_HOSTS = path.join(__dirname, 'data', 'hosts.json.test');
if (fs.existsSync(TEST_HOSTS)) fs.unlinkSync(TEST_HOSTS);
fs.writeFileSync(TEST_HOSTS, '[]');

process.env.HOSTS_FILE = TEST_HOSTS;
const server = require('./server.js');
server.startBackend();

const PORT = Number(process.env.PORT);
const BASE = 'http://127.0.0.1:' + PORT;

function logOk(name) { console.log('  PASS  ' + name); }
function logFail(name, err) { console.log('  FAIL  ' + name + ' :: ' + (err && err.message || err)); process.exitCode = 1; }

async function expectOk(name, p) {
  try {
    const res = await p;
    if (!res.ok && res.status >= 500) throw new Error('HTTP ' + res.status);
    return res;
  } catch (err) { logFail(name, err); throw err; }
}

async function waitForServer() {
  const t0 = Date.now();
  while (Date.now() - t0 < 5000) {
    try {
      const r = await fetch(BASE + '/api/hosts');
      if (r.ok) return;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('server did not start within 5s');
}

async function test() {
  await waitForServer();

  let res = await expectOk('GET /api/hosts (empty)', fetch(BASE + '/api/hosts'));
  const list0 = await res.json();
  if (list0.length !== 0) throw new Error('expected empty list, got ' + list0.length);
  logOk('list empty initially');

  res = await expectOk('POST /api/hosts (invalid -> 400)', fetch(BASE + '/api/hosts', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x' }),
  }));
  if (res.status !== 400) throw new Error('expected 400');
  await res.json();
  logOk('missing fields rejected');

  res = await expectOk('POST /api/hosts (valid)', fetch(BASE + '/api/hosts', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'fake-host',
      host: '127.0.0.1',
      port: 1,
      username: 'nobody',
      intervalMs: 1000,
      auth: { type: 'password', password: 'wrong' },
    }),
  }));
  const created = await res.json();
  if (!created.id) throw new Error('no id returned');
  logOk('host created: ' + created.id);
  if (created.auth && created.auth.password) throw new Error('password leaked in response');

  res = await fetch(BASE + '/api/hosts');
  const list1 = await res.json();
  if (list1.length !== 1) throw new Error('expected 1 host');
  logOk('list returns 1');

  res = await expectOk('POST /api/hosts/:id/start', fetch(BASE + '/api/hosts/' + created.id + '/start', { method: 'POST' }));
  await res.json();
  await new Promise(r => setTimeout(r, 400));
  res = await fetch(BASE + '/api/hosts');
  const list2 = await res.json();
  const running = list2[0].status && list2[0].status.running;
  if (!running) throw new Error('expected running=true');
  logOk('monitor started, status=' + JSON.stringify(list2[0].status));

  res = await fetch(BASE + '/api/test', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ host: '127.0.0.1', port: 1, username: 'nobody', auth: { type: 'password', password: 'x' } }),
  });
  const testData = await res.json();
  if (testData.ok) throw new Error('expected /api/test to fail against 127.0.0.1:1');
  logOk('POST /api/test fails fast (no persistence)');
  res = await fetch(BASE + '/api/hosts');
  const listAfterTest = await res.json();
  if (listAfterTest.length !== 1) throw new Error('/api/test must NOT create a host, got ' + listAfterTest.length);
  logOk('/api/test does NOT create host (count still 1)');

  res = await expectOk('POST /api/hosts/:id/stop', fetch(BASE + '/api/hosts/' + created.id + '/stop', { method: 'POST' }));
  await res.json();
  await new Promise(r => setTimeout(r, 200));
  res = await fetch(BASE + '/api/hosts');
  const list3 = await res.json();
  if (list3[0].status.running) throw new Error('expected running=false');
  logOk('monitor stopped');

  res = await expectOk('PUT /api/hosts/:id', fetch(BASE + '/api/hosts/' + created.id, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'renamed' }),
  }));
  const updated = await res.json();
  if (updated.name !== 'renamed') throw new Error('rename failed');
  logOk('host updated');

  res = await expectOk('DELETE /api/hosts/:id', fetch(BASE + '/api/hosts/' + created.id, { method: 'DELETE' }));
  await res.json();
  res = await fetch(BASE + '/api/hosts');
  const list4 = await res.json();
  if (list4.length !== 0) throw new Error('expected empty after delete');
  logOk('host deleted');

  console.log('\n  ALL TESTS PASSED');
}

test().catch(err => {
  console.error('TEST FAILED:', err);
  process.exitCode = 1;
}).finally(() => {
  if (fs.existsSync(TEST_HOSTS)) fs.unlinkSync(TEST_HOSTS);
  setTimeout(() => process.exit(process.exitCode || 0), 100);
});
