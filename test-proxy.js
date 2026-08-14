'use strict';

const path = require('path');
const fs = require('fs');

const TEST_PORT = Number(process.env.PROXY_TEST_PORT) || 18788;
const TEST_PROXIES = path.join(__dirname, 'data', 'proxies.json.test');
const TEST_SSH_CONFIG = path.join(__dirname, 'data', 'ssh-config.test');

process.env.PORT = String(TEST_PORT);
process.env.PROXIES_FILE = TEST_PROXIES;
process.env.SSH_CONFIG_FILE = TEST_SSH_CONFIG;
process.env.PROXY_RETRY_BASE_MS = '250';
process.env.PROXY_RETRY_MAX_MS = '500';

for (const file of [TEST_PROXIES, TEST_SSH_CONFIG]) {
  try { fs.unlinkSync(file); } catch (_) {}
}
fs.writeFileSync(TEST_SSH_CONFIG, 'Host config-only-proxy\n  HostName 127.0.0.1\n  Port 1\n', 'utf8');

const server = require('./server.js');
const BASE = `http://127.0.0.1:${TEST_PORT}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function json(url, options) {
  const res = await fetch(BASE + url, options);
  const data = await res.json();
  return { res, data };
}

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('timed out waiting for proxy state');
}

async function main() {
  server.startBackend();
  await waitFor(async () => {
    try { return (await fetch(BASE + '/api/proxies')).ok; } catch (_) { return false; }
  });

  let result = await json('/api/proxies');
  assert(result.res.ok, 'proxy list should load');
  assert(result.data.length === 1 && result.data[0].source === 'ssh-config', 'SSH config proxy should be synchronized');

  result = await json('/api/proxies', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ host: '127.0.0.1', username: 'root', sshPort: 1, localPort: 8787, remotePort: 18787 }),
  });
  assert(result.res.status === 201, 'custom proxy should be created');
  const custom = result.data;
  assert(custom.source === 'custom' && custom.username === 'root', 'custom proxy fields should be returned');
  assert(fs.existsSync(TEST_PROXIES), 'custom proxy should be persisted');

  result = await json('/api/proxies', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ host: '127.0.0.1', localPort: 0, remotePort: 70000 }),
  });
  assert(result.res.status === 400, 'invalid ports should be rejected');

  result = await json(`/api/proxies/${encodeURIComponent(custom.id)}/start`, { method: 'POST' });
  assert(result.res.ok && result.data.desired, 'custom proxy should enter desired running state');

  const retrying = await waitFor(async () => {
    const current = await json('/api/proxies');
    const proxy = current.data.find(item => item.id === custom.id);
    return proxy && proxy.retryCount >= 1 && proxy.lastError ? proxy : null;
  });
  assert(['starting', 'retrying'].includes(retrying.state), 'failed tunnel should be retried');
  assert(retrying.nextRetryAt || retrying.state === 'starting', 'retry schedule should be exposed');

  const exhausted = await waitFor(async () => {
    const current = await json('/api/proxies');
    const proxy = current.data.find(item => item.id === custom.id);
    return proxy?.state === 'failed' ? proxy : null;
  }, 20000);
  assert(exhausted.retryCount === 6, 'automatic retries should stop after exactly 6 retries');
  assert(!exhausted.desired && !exhausted.nextRetryAt, 'exhausted proxy should not schedule another retry');

  result = await json(`/api/proxies/${encodeURIComponent(custom.id)}/start`, { method: 'POST' });
  assert(result.res.ok && result.data.desired && result.data.retryCount === 0, 'manual restart should reset retry count');
  await waitFor(async () => {
    const current = await json('/api/proxies');
    const proxy = current.data.find(item => item.id === custom.id);
    return proxy?.retryCount >= 1 ? proxy : null;
  });

  result = await json(`/api/proxies/${encodeURIComponent(custom.id)}/stop`, { method: 'POST' });
  assert(result.res.ok && !result.data.desired && result.data.state === 'stopped', 'manual stop should cancel keepalive');
  const session = server.proxySessions.get(custom.id);
  assert(!session.retryTimer && !session.readyTimer, 'manual stop should clear retry timers');

  result = await json(`/api/proxies/${encodeURIComponent(custom.id)}`, { method: 'DELETE' });
  assert(result.res.ok && result.data.ok, 'custom proxy should be deleted');
  result = await json('/api/proxies');
  assert(result.data.length === 1 && result.data[0].source === 'ssh-config', 'config proxy should remain after custom deletion');

  console.log('  PASS  proxy config synchronization');
  console.log('  PASS  custom proxy persistence and validation');
  console.log('  PASS  proxy keepalive retry, 6-retry limit and visible error state');
  console.log('  PASS  proxy stop and delete lifecycle');
}

main().then(async () => {
  await server.stopBackend();
  process.exitCode = 0;
}).catch(async err => {
  console.error('PROXY TEST FAILED:', err);
  process.exitCode = 1;
  try { await server.stopBackend(); } catch (_) {}
}).finally(() => {
  for (const file of [TEST_PROXIES, TEST_SSH_CONFIG]) {
    try { fs.unlinkSync(file); } catch (_) {}
  }
  setTimeout(() => process.exit(process.exitCode || 0), 50);
});
