const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const grid = $('#grid');
const empty = $('#empty');
const tpl = $('#tpl-card');
const metaNodes = $('#meta-nodes');
const metaDies = $('#meta-dies');
const metaUptime = $('#meta-uptime');

const dlg = $('#dlg-host');
const form = $('#form-host');
const dlgTitle = $('#dlg-title');
const dlgLog = $('#dlg-log');
const authPassword = $('#auth-password');
const authKey = $('#auth-key');

let hosts = [];
let ws = null;
let wsRetry = 0;
const bootTime = Date.now();
const HOST_ORDER_KEY = 'npu-host-order';
let heightRaf = 0;
let draggingCard = null;

function scheduleRelayout() {
  scheduleBodyHeightUpdate();
}


function readHostOrder() {
  try {
    const value = JSON.parse(localStorage.getItem(HOST_ORDER_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch (_) {
    return [];
  }
}

function applyHostOrder(list) {
  const order = readHostOrder();
  if (!order.length) return list;
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...list].sort((a, b) => {
    const ar = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
    const br = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
    if (ar !== br) return ar - br;
    return list.indexOf(a) - list.indexOf(b);
  });
}

function saveHostOrderFromDom() {
  const ids = $$('.card', grid).map(card => card.dataset.hostId).filter(Boolean);
  try { localStorage.setItem(HOST_ORDER_KEY, JSON.stringify(ids)); } catch (_) {}
}

function isDragBlocked(target) {
  return !!target.closest('button, input, textarea, select, a, dialog, .action-menu');
}

function handleCardDragStart(e) {
  const card = e.currentTarget.closest('.card');
  if (!card) return;
  if (!e.target.closest('.card-head') || isDragBlocked(e.target)) {
    e.preventDefault();
    return;
  }
  draggingCard = card;
  card.classList.add('dragging');
  grid.classList.add('drag-active');
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.hostId || '');
  }
}

function handleCardDragEnd(e) {
  const card = e.currentTarget.closest('.card');
  if (card) card.classList.remove('dragging');
  if (draggingCard) draggingCard.classList.remove('dragging');
  draggingCard = null;
  grid.classList.remove('drag-active');
  saveHostOrderFromDom();
  scheduleBodyHeightUpdate();
}

function handleGridDragOver(e) {
  if (!draggingCard) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  const target = e.target.closest('.card');
  if (!target || target === draggingCard || !grid.contains(target)) return;
  const rect = target.getBoundingClientRect();
  const insertBefore = e.clientY < rect.top + rect.height / 2;
  grid.insertBefore(draggingCard, insertBefore ? target : target.nextSibling);
}
function scheduleBodyHeightUpdate() {
  if (heightRaf) return;
  heightRaf = requestAnimationFrame(() => {
    heightRaf = 0;
    for (const card of $$('.card', grid)) updateBodyHeight(card);
  });
}

function updateBodyHeight(card) {
  const body = $('.card-body', card);
  if (!body) return;
  if (card.classList.contains('collapsed')) {
    body.style.maxHeight = '0px';
    return;
  }
  body.style.maxHeight = body.scrollHeight + 'px';
}

function setCardCollapsed(card, collapsed, immediate = false) {
  const body = $('.card-body', card);
  if (!body) return;
  card.classList.toggle('collapsed', collapsed);
  if (immediate) body.style.transition = 'none';
  if (collapsed) {
    body.style.maxHeight = body.scrollHeight + 'px';
    requestAnimationFrame(() => { body.style.maxHeight = '0px'; });
  } else {
    body.style.maxHeight = body.scrollHeight + 'px';
  }
  if (immediate) {
    void body.offsetHeight;
    body.style.transition = '';
  }
}
function fmtBytes(mb) {
  if (mb == null) return '-';
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
  return mb.toFixed(0) + ' MB';
}
function metricClass(v) {
  if (v == null) return '';
  if (v > 85) return 'high';
  if (v >= 70) return 'mid';
  return 'low';
}
function npuLabel(npu) {
  if (npu.npuId != null && npu.die != null) return `N${npu.npuId}·D${npu.die}`;
  if (npu.npuId != null) return `N${npu.npuId}`;
  return `N${npu.id}`;
}
function pctText(v) {
  return v == null ? '--' : `${Math.round(v)}%`;
}
function computeSummary(npus) {
  const utilVals = (npus || []).map(n => n.util).filter(v => v != null && Number.isFinite(Number(v))).map(Number);
  const memVals = (npus || [])
    .map(n => (n.memoryUsed != null && n.memoryTotal) ? (Number(n.memoryUsed) / Number(n.memoryTotal)) * 100 : null)
    .filter(v => v != null && Number.isFinite(v));
  return {
    util: utilVals.length ? utilVals.reduce((a, b) => a + b, 0) / utilVals.length : null,
    memory: memVals.length ? memVals.reduce((a, b) => a + b, 0) / memVals.length : null,
  };
}
function setMetricClass(el, value) {
  if (!el) return;
  el.classList.remove('low', 'mid', 'high');
  const cls = metricClass(value);
  if (cls) el.classList.add(cls);
}

function buildTile(npu, idx) {
  const tile = document.createElement('div');
  tile.className = 'npu-tile';
  tile.dataset.npuId = String(npu.id);
  tile.style.animationDelay = (idx * 20) + 'ms';
  tile.innerHTML = `
    <div class="tile-head"><span>${npuLabel(npu)}</span><span class="tile-dot">●</span></div>
    <div class="tile-main">
      <div class="tile-mem-block">
        <div class="tile-mem"></div>
        <div class="tile-bar"><div class="tile-bar-fill"></div></div>
      </div>
    </div>
    <div class="tile-vram"></div>
  `;
  updateTile(tile, npu);
  return tile;
}
function updateTile(tile, npu) {
  const memPct = (npu.memoryUsed != null && npu.memoryTotal) ? (Number(npu.memoryUsed) / Number(npu.memoryTotal)) * 100 : null;
  const barFill = tile.querySelector('.tile-bar-fill');
  barFill.style.width = (memPct != null ? Math.max(0, Math.min(100, memPct)) : 0) + '%';
  tile.querySelector('.tile-mem').textContent = `${fmtBytes(npu.memoryUsed)} / ${fmtBytes(npu.memoryTotal)}`;
  tile.querySelector('.tile-vram').textContent = memPct != null ? `${memPct.toFixed(0)}% VRAM` : '-- VRAM';
  tile.classList.remove('low', 'mid', 'high');
  const cls = metricClass(memPct);
  if (cls) tile.classList.add(cls);
}
function updateHostSummary(card, npus) {
  const summary = computeSummary(npus || []);
  const vramPct = card.querySelector('.summary-vram-pct');
  const vramFill = card.querySelector('.summary-vram-fill');
  vramPct.textContent = pctText(summary.memory);
  vramFill.style.width = (summary.memory != null ? Math.max(0, Math.min(100, summary.memory)) : 0) + '%';
  setMetricClass(vramFill, summary.memory);
}

function updateHostUtilBar(card, npus) {
  updateHostSummary(card, npus);
}
function syncTiles(listEl, npus) {
  const needsRebuild = listEl.childElementCount !== npus.length || Array.from(listEl.children).some(el => !el.classList.contains('npu-tile'));
  if (needsRebuild) {
    listEl.innerHTML = '';
    for (let i = 0; i < npus.length; i++) listEl.appendChild(buildTile(npus[i], i));
    return;
  }
  for (let i = 0; i < npus.length; i++) {
    updateTile(listEl.children[i], npus[i]);
  }
}
function renderCard(host) {
  let card = grid.querySelector(`[data-host-id="${host.id}"]`);
  if (!card) {
    card = tpl.content.firstElementChild.cloneNode(true);
    card.dataset.hostId = host.id;
    grid.appendChild(card);
    const cardHead = card.querySelector('.card-head');
    if (cardHead) {
      cardHead.draggable = true;
      cardHead.addEventListener('dragstart', handleCardDragStart);
      cardHead.addEventListener('dragend', handleCardDragEnd);
    }

    const toggle = () => toggleMonitor(host.id);
    const test = () => testHost(host.id);
    const edit = () => openDialog(host);
    const del = () => deleteHost(host.id);

    card.querySelector('.btn-toggle').addEventListener('click', toggle);
    card.querySelector('.btn-toggle-menu').addEventListener('click', toggle);
    $$('.btn-test', card).forEach(btn => btn.addEventListener('click', test));
    card.querySelector('.btn-edit').addEventListener('click', edit);
    card.querySelector('.btn-edit-menu').addEventListener('click', edit);
    card.querySelector('.btn-del').addEventListener('click', del);
    card.querySelector('.btn-del-menu').addEventListener('click', del);
    const menuWrap = card.querySelector('.menu-wrap');
    const moreBtn = card.querySelector('.btn-more');
    if (menuWrap && moreBtn) {
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        menuWrap.classList.toggle('open');
      });
      card.querySelector('.action-menu').addEventListener('click', () => menuWrap.classList.remove('open'));
    }
    card.querySelector('.btn-collapse').addEventListener('click', () => {
      const collapsed = !card.classList.contains('collapsed');
      setCardCollapsed(card, collapsed);
      try { localStorage.setItem('npu-collapsed:' + host.id, collapsed ? '1' : '0'); } catch (_) {}
    });

    if (localStorage.getItem('npu-collapsed:' + host.id) === '1') {
      card.classList.add('collapsed');
      const body = card.querySelector('.card-body');
      if (body) body.style.maxHeight = '0px';
    }
  }
  card.querySelector('.name').textContent = host.name;
  const fullAddr = `${host.username}@${host.host}:${host.port || 22}`;
  const addrEl = card.querySelector('.addr');
  addrEl.textContent = fullAddr;
  addrEl.title = fullAddr;
  return card;
}
function updateCardFromStatus(host, status) {
  const card = grid.querySelector(`[data-host-id="${host.id}"]`);
  if (!card) return;
  const dot = card.querySelector('.dot');
  const btn = card.querySelector('.btn-toggle');
  const menuBtn = card.querySelector('.btn-toggle-menu');
  const statusEl = card.querySelector('.card-status');
  const listEl = card.querySelector('.npu-list');
  const rawEl = card.querySelector('.raw');
  const warnEl = card.querySelector('.parse-warn');
  const showRaw = !!host.showRaw;

  const running = !!status.running;
  const hasError = !!status.lastError && !running;
  dot.classList.toggle('running', running);
  dot.classList.toggle('error', hasError);
  card.classList.toggle('running', running);
  card.classList.toggle('error', hasError);

  btn.textContent = running ? 'STOP' : 'START';
  if (menuBtn) menuBtn.textContent = running ? 'STOP' : 'START';
  btn.classList.toggle('primary', !running);
  btn.classList.toggle('ghost', running);
  if (menuBtn) {
    menuBtn.classList.toggle('primary', !running);
    menuBtn.classList.toggle('ghost', running);
  }

  if (hasError) {
    statusEl.textContent = 'ERR · ' + (status.lastError || '').slice(0, 40);
  } else if (running) {
    statusEl.textContent = `LIVE · ${host.intervalMs || 2000}ms · ${host.command || 'npu-smi info'}`;
  } else {
    statusEl.textContent = 'IDLE';
  }

  if (status.lastSample && status.lastSample.npus) {
    syncTiles(listEl, status.lastSample.npus);
  } else {
    listEl.innerHTML = '<div class="tile-head" style="padding:14px 12px">— NO DATA —</div>';
  }

  const allNull = status.lastSample && status.lastSample.npus && status.lastSample.npus.length > 0 && status.lastSample.npus.every(n => n.util == null && n.memoryUsed == null);
  if (warnEl) warnEl.classList.toggle('hidden', !allNull);
  if ((showRaw || allNull) && status.lastSample && status.lastSample.raw) {
    rawEl.classList.remove('hidden');
    rawEl.textContent = status.lastSample.raw;
  } else {
    rawEl.classList.add('hidden');
  }

  if (status.lastSample && status.lastSample.npus) {
    updateHostUtilBar(card, status.lastSample.npus);
  } else {
    updateHostUtilBar(card, []);
  }
  updateBodyHeight(card);
}

function applyLiveSample(host, sample) {
  const card = grid.querySelector(`[data-host-id="${host.id}"]`);
  if (!card) return;
  const listEl = card.querySelector('.npu-list');
  const rawEl = card.querySelector('.raw');

  if (sample.npus && sample.npus.length) {
    syncTiles(listEl, sample.npus);
  }

  const allNull = sample.npus && sample.npus.length > 0 && sample.npus.every(n => n.util == null && n.memoryUsed == null);
  if ((host.showRaw || allNull) && sample.raw) {
    rawEl.classList.remove('hidden');
    rawEl.textContent = sample.raw;
  } else {
    rawEl.classList.add('hidden');
  }
  updateHostUtilBar(card, sample.npus || []);
  updateBodyHeight(card);
}

function updateMeta() {
  metaNodes.textContent = String(hosts.length).padStart(2, '0');
  const totalDies = hosts.reduce((acc, h) => acc + ((h.status && h.status.lastSample && h.status.lastSample.npus) ? h.status.lastSample.npus.length : 0), 0);
  metaDies.textContent = String(totalDies).padStart(2, '0');
  const elapsed = Math.floor((Date.now() - bootTime) / 1000);
  const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
  const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  metaUptime.textContent = `${h}:${m}:${s}`;
}

async function fetchHosts() {
  const res = await fetch('/api/hosts');
  hosts = applyHostOrder(await res.json());
  const validIds = new Set(hosts.map(h => h.id));
  for (const card of $$('.card', grid)) {
    if (!validIds.has(card.dataset.hostId)) {
      card.remove();
    }
  }
  for (const h of hosts) {
    const card = renderCard(h);
    updateCardFromStatus(h, h.status || { running: false });
  }
  setEmpty();
  updateMeta();
  subscribeAll();
  scheduleBodyHeightUpdate();
}

function setEmpty() {
  empty.classList.toggle('hidden', hosts.length > 0);
}

function subscribeAll() {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'subscribe', hostIds: hosts.map(h => h.id) }));
}

function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.addEventListener('open', () => { wsRetry = 0; subscribeAll(); });
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }
    const host = hosts.find(h => h.id === msg.hostId);
    if (!host) return;
    if (msg.type === 'snapshot') updateCardFromStatus(host, msg.status);
    else if (msg.type === 'sample') applyLiveSample(host, msg.sample);
    else if (msg.type === 'error') {
      const card = grid.querySelector(`[data-host-id="${host.id}"]`);
      if (card) {
        card.classList.remove('running');
        card.classList.add('error');
        const statusEl = card.querySelector('.card-status');
        statusEl.textContent = 'ERR · ' + (msg.error || '').slice(0, 40);
        const dot = card.querySelector('.dot');
        dot.classList.remove('running');
        dot.classList.add('error');
      }
    }
  });
  ws.addEventListener('close', () => {
    ws = null;
    wsRetry = Math.min(wsRetry + 1, 10);
    setTimeout(connectWs, 500 * wsRetry);
  });
  ws.addEventListener('error', () => { try { ws.close(); } catch (_) {} });
}

async function toggleMonitor(id) {
  const host = hosts.find(h => h.id === id);
  if (!host) return;
  const running = (host.status && host.status.running) || false;
  const url = `/api/hosts/${id}/${running ? 'stop' : 'start'}`;
  await fetch(url, { method: 'POST' });
  await fetchHosts();
}

async function testHost(id) {
  const buttons = $$(`.card[data-host-id="${id}"] .btn-test`);
  for (const btn of buttons) { btn.disabled = true; btn.textContent = '...'; }
  try {
    const res = await fetch(`/api/hosts/${id}/test`, { method: 'POST' });
    const data = await res.json();
    if (data.ok) alert(`Connected ✅\n\n${data.stdout}`);
    else alert(`Failed ❌\n${data.error || JSON.stringify(data)}`);
  } catch (err) {
    alert('Request failed: ' + err.message);
  } finally {
    for (const btn of buttons) { btn.disabled = false; btn.textContent = btn.classList.contains('compact-test') ? 'T' : 'TEST'; }
  }
}
async function deleteHost(id) {
  const host = hosts.find(h => h.id === id);
  if (!host) return;
  if (!confirm(`Delete "${host.name}"?`)) return;
  await fetch(`/api/hosts/${id}`, { method: 'DELETE' });
  await fetchHosts();
}

function openDialog(host) {
  form.reset();
  dlgLog.classList.add('hidden');
  dlgLog.textContent = '';
  dlgLog.classList.remove('ok', 'err');
  if (host) {
    dlgTitle.textContent = 'Edit Host';
    form.id.value = host.id;
    form.name.value = host.name || '';
    form.host.value = host.host || '';
    form.port.value = host.port || 22;
    form.username.value = host.username || '';
    form.command.value = host.command || '';
    form.intervalMs.value = host.intervalMs || 2000;
    form.showRaw.checked = !!host.showRaw;
    const isKey = host.auth && host.auth.type === 'privateKey';
    form.authType.value = isKey ? 'privateKey' : 'password';
    authPassword.classList.toggle('hidden', isKey);
    authKey.classList.toggle('hidden', !isKey);
    if (isKey) form.privateKeyPath.value = host.auth.privateKeyPath || '';
  } else {
    dlgTitle.textContent = 'Add Host';
    form.id.value = '';
    authPassword.classList.remove('hidden');
    authKey.classList.add('hidden');
  }
  dlg.showModal();
}

document.addEventListener('click', () => {
  $$('.menu-wrap.open').forEach(el => el.classList.remove('open'));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $$('.menu-wrap.open').forEach(el => el.classList.remove('open'));
});

$('#btn-add').addEventListener('click', () => openDialog(null));
$('#btn-cancel').addEventListener('click', () => dlg.close());

$$('input[name="authType"]').forEach(r => {
  r.addEventListener('change', () => {
    const isKey = form.authType.value === 'privateKey';
    authPassword.classList.toggle('hidden', isKey);
    authKey.classList.toggle('hidden', !isKey);
  });
});

$('#btn-test').addEventListener('click', async () => {
  const body = collectForm();
  dlgLog.classList.remove('hidden', 'ok', 'err');
  dlgLog.textContent = 'Testing connection…';
  try {
    const res = await fetch('/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      dlgLog.classList.add('ok');
      dlgLog.textContent = `Connected ✅\n${data.stdout}`;
    } else {
      dlgLog.classList.add('err');
      dlgLog.textContent = `Failed ❌\n${data.error || res.statusText || ''}`;
    }
  } catch (err) {
    dlgLog.classList.add('err');
    dlgLog.textContent = 'Request failed: ' + err.message;
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = form.id.value;
  const body = collectForm();
  try {
    const res = await fetch(id ? `/api/hosts/${id}` : '/api/hosts', {
      method: id ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert('Save failed: ' + (err.error || res.statusText));
      return;
    }
    dlg.close();
    await fetchHosts();
  } catch (err) {
    alert('Save failed: ' + err.message);
  }
});

function collectForm() {
  const authType = form.authType.value;
  const auth = authType === 'privateKey'
    ? { type: 'privateKey', privateKeyPath: form.privateKeyPath.value.trim(), passphrase: form.passphrase.value || undefined }
    : { type: 'password', password: form.password.value || '' };
  return {
    name: form.name.value.trim(),
    host: form.host.value.trim(),
    port: Number(form.port.value) || 22,
    username: form.username.value.trim(),
    command: form.command.value.trim() || undefined,
    intervalMs: Number(form.intervalMs.value) || 2000,
    showRaw: form.showRaw.checked,
    auth,
  };
}

(async function init() {
  await fetchHosts();
  connectWs();
  setInterval(updateMeta, 1000);
  setInterval(() => {
    fetch('/api/hosts').then(r => r.json()).then(list => {
      hosts = applyHostOrder(list);
      for (const h of hosts) updateCardFromStatus(h, h.status || { running: false });
      updateMeta();
    }).catch(() => {});
  }, 15000);
  grid.addEventListener('dragover', handleGridDragOver);
  grid.addEventListener('drop', (e) => {
    if (!draggingCard) return;
    e.preventDefault();
    saveHostOrderFromDom();
  });
  window.addEventListener('resize', scheduleBodyHeightUpdate);
})();
