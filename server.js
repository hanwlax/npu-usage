'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Client } = require('ssh2');
const { parseNpuSmi } = require('./parser.js');

const DATA_DIR = path.join(__dirname, 'data');
const HOSTS_FILE = process.env.HOSTS_FILE || path.join(DATA_DIR, 'hosts.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 8787;
const HISTORY_WINDOW_MS = 5 * 60 * 1000;

fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT_NPU_CMD = 'npu-smi info';

function loadHosts() {
  try {
    const raw = fs.readFileSync(HOSTS_FILE, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    return [];
  }
}

async function saveHosts(hosts) {
  const tmp = HOSTS_FILE + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(hosts, null, 2), 'utf8');
  await fsp.rename(tmp, HOSTS_FILE);
}

function genId() {
  return crypto.randomBytes(6).toString('hex');
}

function sanitizeHost(h) {
  const safe = { ...h };
  if (safe.auth && safe.auth.password) {
    safe.auth = { type: 'password' };
  }
  return safe;
}

class HostSession {
  constructor(host, onUpdate) {
    this.host = host;
    this.onUpdate = onUpdate;
    this.client = null;
    this.timer = null;
    this.running = false;
    this.lastError = null;
    this.lastSample = null;
    this.history = [];
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastError = null;
    this.tick();
    const interval = Math.max(500, Number(this.host.intervalMs) || 2000);
    this.timer = setInterval(() => this.tick(), interval);
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.client) {
      const c = this.client;
      this.client = null;
      let closed = false;
      c.once('close', () => { closed = true; });
      try { c.end(); } catch (_) {}
      setTimeout(() => {
        if (!closed) {
          try { c.removeAllListeners(); c.destroy(); } catch (_) {}
        }
      }, 1500).unref();
    }
  }

  status() {
    return {
      running: this.running,
      lastError: this.lastError,
      lastSample: this.lastSample,
      history: this.history,
    };
  }

  ensureClient() {
    return new Promise((resolve, reject) => {
      if (this.client && this.client._connected) return resolve(this.client);
      const conn = new Client();
      const cfg = {
        host: this.host.host,
        port: Number(this.host.port) || 22,
        username: this.host.username,
        keepaliveInterval: 10000,
        readyTimeout: 8000,
      };
      if (this.host.auth && this.host.auth.type === 'privateKey') {
        try {
          const key = fs.readFileSync(this.host.auth.privateKeyPath);
          cfg.privateKey = key;
          if (this.host.auth.passphrase) cfg.passphrase = this.host.auth.passphrase;
        } catch (err) {
          return reject(new Error('Cannot read private key: ' + err.message));
        }
      } else if (this.host.auth && this.host.auth.type === 'password') {
        cfg.password = this.host.auth.password;
      }

      conn.on('ready', () => {
        this.client = conn;
        conn._connected = true;
        conn.on('error', () => { conn._connected = false; });
        conn.on('close', () => { conn._connected = false; });
        resolve(conn);
      });
      conn.on('error', (err) => {
        conn._connected = false;
        reject(err);
      });
      conn.connect(cfg);
    });
  }

  exec(cmd) {
    return new Promise((resolve, reject) => {
      this.ensureClient().then((conn) => {
        conn.exec(cmd, (err, stream) => {
          if (err) return reject(err);
          let stdout = '';
          let stderr = '';
          stream.on('data', (data) => { stdout += data.toString('utf8'); });
          stream.stderr.on('data', (data) => { stderr += data.toString('utf8'); });
          stream.on('close', (code) => {
            if (code !== 0 && !stdout) return reject(new Error('exit ' + code + ': ' + stderr.trim()));
            resolve({ stdout, stderr, code });
          });
        });
      }).catch(reject);
    });
  }

  async tick() {
    if (!this.running) return;
    const cmd = this.host.command || DEFAULT_NPU_CMD;
    try {
      const { stdout } = await this.exec(cmd);
      const { npus, raw } = parseNpuSmi(stdout);
      const sample = { ts: Date.now(), npus, raw: this.host.showRaw ? raw : undefined };
      this.lastSample = sample;
      this.lastError = null;
      this.history.push(sample);
      const cutoff = Date.now() - HISTORY_WINDOW_MS;
      while (this.history.length && this.history[0].ts < cutoff) this.history.shift();
      this.onUpdate(this.host.id, { type: 'sample', sample });
    } catch (err) {
      this.lastError = err.message || String(err);
      if (this.client) {
        try { this.client.end(); } catch (_) {}
        this.client = null;
      }
      this.onUpdate(this.host.id, { type: 'error', error: this.lastError });
    }
  }
}

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(PUBLIC_DIR));

const sessions = new Map();
let hosts = loadHosts();

function getOrCreateSession(host) {
  let s = sessions.get(host.id);
  if (!s) {
    s = new HostSession(host, broadcastHost);
    sessions.set(host.id, s);
  } else {
    s.host = host;
  }
  return s;
}

function removeSession(id) {
  const s = sessions.get(id);
  if (s) {
    s.stop();
    sessions.delete(id);
  }
}

app.get('/api/hosts', (req, res) => {
  res.json(hosts.map(h => ({ ...sanitizeHost(h), status: sessions.get(h.id)?.status() || { running: false } })));
});

app.post('/api/hosts', async (req, res) => {
  const body = req.body || {};
  if (!body.name || !body.host || !body.username) {
    return res.status(400).json({ error: 'name, host, username are required' });
  }
  const host = {
    id: genId(),
    name: String(body.name),
    host: String(body.host),
    port: Number(body.port) || 22,
    username: String(body.username),
    intervalMs: Math.max(500, Number(body.intervalMs) || 2000),
    command: typeof body.command === 'string' && body.command.trim() ? body.command.trim() : DEFAULT_NPU_CMD,
    showRaw: !!body.showRaw,
    auth: body.auth && body.auth.type === 'privateKey'
      ? { type: 'privateKey', privateKeyPath: String(body.auth.privateKeyPath || ''), passphrase: body.auth.passphrase || undefined }
      : { type: 'password', password: body.auth && body.auth.password ? String(body.auth.password) : '' },
  };
  hosts.push(host);
  await saveHosts(hosts);
  res.json({ ...sanitizeHost(host) });
});

app.put('/api/hosts/:id', async (req, res) => {
  const idx = hosts.findIndex(h => h.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'not found' });
  const cur = hosts[idx];
  const body = req.body || {};
  const next = {
    ...cur,
    name: body.name ?? cur.name,
    host: body.host ?? cur.host,
    port: body.port ?? cur.port,
    username: body.username ?? cur.username,
    intervalMs: body.intervalMs ?? cur.intervalMs,
    command: body.command ?? cur.command,
    showRaw: body.showRaw ?? cur.showRaw,
  };
  if (body.auth) {
    if (body.auth.type === 'privateKey') {
      next.auth = { type: 'privateKey', privateKeyPath: body.auth.privateKeyPath || '', passphrase: body.auth.passphrase || undefined };
    } else if (body.auth.type === 'password') {
      next.auth = { type: 'password', password: body.auth.password || '' };
    } else {
      next.auth = cur.auth;
    }
  }
  hosts[idx] = next;
  await saveHosts(hosts);
  const wasRunning = sessions.get(cur.id)?.running;
  if (wasRunning) {
    removeSession(cur.id);
    getOrCreateSession(next).start();
  }
  res.json(sanitizeHost(next));
});

app.delete('/api/hosts/:id', async (req, res) => {
  const before = hosts.length;
  hosts = hosts.filter(h => h.id !== req.params.id);
  if (hosts.length === before) return res.status(404).json({ error: 'not found' });
  removeSession(req.params.id);
  await saveHosts(hosts);
  res.json({ ok: true });
});

app.post('/api/hosts/:id/start', (req, res) => {
  const h = hosts.find(x => x.id === req.params.id);
  if (!h) return res.status(404).json({ error: 'not found' });
  getOrCreateSession(h).start();
  res.json({ ok: true });
});

app.post('/api/hosts/:id/stop', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.json({ ok: true, running: false });
  s.stop();
  res.json({ ok: true, running: false });
});

app.post('/api/test', async (req, res) => {
  const body = req.body || {};
  if (!body.host || !body.username) {
    return res.status(400).json({ ok: false, error: 'host 和 username 必填' });
  }
  const auth = body.auth || { type: 'password' };
  let privateKey;
  let passphrase;
  if (auth.type === 'privateKey') {
    try {
      privateKey = fs.readFileSync(auth.privateKeyPath);
      passphrase = auth.passphrase;
    } catch (err) {
      return res.status(400).json({ ok: false, error: '无法读取私钥: ' + err.message });
    }
  }
  const client = new Client();
  const cfg = {
    host: String(body.host),
    port: Number(body.port) || 22,
    username: String(body.username),
    keepaliveInterval: 10000,
    readyTimeout: 8000,
  };
  if (auth.type === 'privateKey') { cfg.privateKey = privateKey; if (passphrase) cfg.passphrase = passphrase; }
  else if (auth.type === 'password') { cfg.password = auth.password || ''; }

  const done = (status, payload) => {
    try { client.end(); } catch (_) {}
    res.status(status).json(payload);
  };

  client.on('ready', () => {
    client.exec('echo ok && uname -a', (err, stream) => {
      if (err) return done(500, { ok: false, error: err.message });
      let stdout = '', stderr = '';
      stream.on('data', d => stdout += d.toString('utf8'));
      stream.stderr.on('data', d => stderr += d.toString('utf8'));
      stream.on('close', code => {
        if (code !== 0 && !stdout) return done(500, { ok: false, error: 'exit ' + code + ': ' + stderr.trim() });
        done(200, { ok: true, stdout: stdout.trim(), stderr: stderr.trim() });
      });
    });
  });
  client.on('error', err => done(500, { ok: false, error: err.message || String(err) }));
  client.connect(cfg);
});

app.post('/api/hosts/:id/test', async (req, res) => {
  const h = hosts.find(x => x.id === req.params.id);
  if (!h) return res.status(404).json({ error: 'not found' });
  const session = getOrCreateSession(h);
  try {
    const { stdout, stderr } = await session.exec('echo ok && uname -a');
    res.json({ ok: true, stdout: stdout.trim(), stderr: stderr.trim() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  } finally {
    if (session.client) {
      try { session.client.end(); } catch (_) {}
      session.client = null;
    }
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const subs = new Map();

function broadcastHost(hostId, payload) {
  const set = subs.get(hostId);
  if (!set) return;
  const msg = JSON.stringify({ hostId, ...payload });
  for (const ws of set) {
    if (ws.readyState === 1) {
      try { ws.send(msg); } catch (_) {}
    }
  }
}

wss.on('connection', (ws) => {
  ws.hosts = new Set();
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
    if (msg.type === 'subscribe' && Array.isArray(msg.hostIds)) {
      for (const id of msg.hostIds) {
        if (!subs.has(id)) subs.set(id, new Set());
        subs.get(id).add(ws);
        ws.hosts.add(id);
        const s = sessions.get(id);
        if (s) {
          try { ws.send(JSON.stringify({ hostId: id, type: 'snapshot', status: s.status() })); } catch (_) {}
        }
      }
    } else if (msg.type === 'unsubscribe' && Array.isArray(msg.hostIds)) {
      for (const id of msg.hostIds) {
        subs.get(id)?.delete(ws);
        ws.hosts.delete(id);
      }
    }
  });
  ws.on('close', () => {
    for (const id of ws.hosts) subs.get(id)?.delete(ws);
    ws.hosts.clear();
  });
});

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch (_) {}
  });
}, 30000);

let httpServer = null;

function startBackend() {
  if (httpServer) return httpServer;
  httpServer = app.listen(PORT, () => {
    console.log(`NPU monitor listening on http://localhost:${PORT}`);
    console.log(`Data dir: ${DATA_DIR}`);
  });
  return httpServer;
}

function stopBackend() {
  if (!httpServer) return Promise.resolve();
  return new Promise(resolve => {
    httpServer.close(() => { httpServer = null; resolve(); });
  });
}

if (require.main === module) {
  startBackend();
}

module.exports = { sessions, hosts, app, startBackend, stopBackend, get server() { return httpServer; } };
