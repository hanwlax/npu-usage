'use strict';

function parseNpuSmi(stdout) {
  if (!stdout || typeof stdout !== 'string') return { npus: [], raw: '' };

  const jsonResult = tryParseJson(stdout);
  if (jsonResult) return jsonResult;

  const usagesResult = tryParseUsages(stdout);
  if (usagesResult) return usagesResult;

  return parseTable(stdout);
}

function tryParseJson(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  if (!/^[\[{]/.test(trimmed)) return null;
  let data;
  try { data = JSON.parse(trimmed); } catch (_) { return null; }
  const arr = Array.isArray(data) ? data : (data && Array.isArray(data.npus) ? data.npus : null);
  if (!arr || !arr.length) return null;
  const npus = [];
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue;
    const id = String(it.npu_id ?? it.id ?? it.NPU ?? '').trim();
    if (!/^\d+$/.test(id)) continue;
    const mem = it.memory || {};
    npus.push({
      id,
      chip: it.name || it.chip || '',
      memoryUsed: numOrNull(mem.used ?? mem.used_mb ?? mem.usedMiB),
      memoryTotal: numOrNull(mem.total ?? mem.total_mb ?? mem.totalMiB),
      util: numOrNull(it.util ?? it.utilization ?? it.aicore_util ?? it['Util-Gpu'] ?? it['util-gpu']),
      processDir: it.processDir || it.process_dir || '',
      processMemory: numOrNull(it.processMemory ?? it.process_memory ?? it.process_memory_mb),
    });
  }
  return npus.length ? { npus, raw: stdout } : null;
}

function tryParseUsages(stdout) {
  if (!/NPU\s+ID/i.test(stdout) && !/Utilization/i.test(stdout)) return null;
  const blocks = stdout.split(/NPU\s+ID\s*[:：]/i);
  const npus = [];
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const idMatch = block.match(/^\s*(\d+)/);
    if (!idMatch) continue;
    const id = idMatch[1];
    const utilMatch = block.match(/Utilization[^\d]*(\d+(?:\.\d+)?)/i);
    const memMatch = block.match(/Memory[^\d]*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/i);
    npus.push({
      id,
      chip: '',
      memoryUsed: memMatch ? Number(memMatch[1]) : null,
      memoryTotal: memMatch ? Number(memMatch[2]) : null,
      util: utilMatch ? Number(utilMatch[1]) : null,
    });
  }
  return npus.length ? { npus, raw: stdout } : null;
}

function parseTable(stdout) {
  const lines = stdout.split(/\r?\n/);
  const npuMap = new Map();
  const processMap = new Map();
  const processes = [];
  let pendingName = null;
  let pendingSingleNpu = null;
  let inProcessTable = false;
  let isPhyIdFormat = /Phy-?ID/i.test(stdout);
  let isSingleNpuIdFormat = /NPU\s+ID/i.test(stdout) && /Bus-Id/i.test(stdout) && !isPhyIdFormat;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!line.includes('|')) continue;
    if (/^\+[-\s=]+\+$/.test(trimmed)) continue;
    if (/^\|[\s=:]+(\s*\|)+$/.test(line)) continue;
    if (/Process\s+(id|name|memory|usage)/i.test(line)) {
      inProcessTable = true;
      continue;
    }
    if (/No running processes/i.test(line)) continue;
    if (/^\|\s*(NPU\s+Name|NPU\s+Chip|NPU\s+ID)/i.test(line)) continue;

    const cols = line.split('|').map(s => s.trim());
    if (cols.length < 3) continue;

    if (inProcessTable) {
      collectProcessRow(cols, processMap, processes, npuMap, { isPhyIdFormat, isSingleNpuIdFormat });
      continue;
    }

    const col1Tokens = (cols[1] || '').split(/\s+/).filter(Boolean);
    const firstToken = col1Tokens[0] || '';
    const secondToken = col1Tokens[1] || '';
    if (!/^\d+$/.test(firstToken)) {
      if (isSingleNpuIdFormat && pendingSingleNpu) {
        const m = extractChipRow(cols);
        const hbmHasData = m.hbmTotal != null && m.hbmTotal > 0;
        npuMap.set(pendingSingleNpu.id, {
          id: pendingSingleNpu.id,
          npuId: pendingSingleNpu.id,
          die: '0',
          name: pendingSingleNpu.name,
          util: m.util,
          memoryUsed: hbmHasData ? m.hbmUsed : m.memoryUsed,
          memoryTotal: hbmHasData ? m.hbmTotal : m.memoryTotal,
          hbmUsed: m.hbmUsed,
          hbmTotal: m.hbmTotal,
        });
        pendingSingleNpu = null;
      }
      continue;
    }

    if (isSingleNpuIdFormat && !secondToken) {
      const name = (cols[2] || '').trim();
      if (name && !/^\d+$/.test(name)) {
        pendingSingleNpu = { id: firstToken, name };
      }
      continue;
    }

    if (/^\d+$/.test(secondToken)) {
      if (isPhyIdFormat) {
        const busIdCell = (cols[2] || '').trim();
        if (!/^[0-9a-fA-F]{4}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}\.0$/.test(busIdCell)) continue;
      }
      const m = extractChipRow(cols);
      const npuId = pendingName ? pendingName.id : null;
      const chipName = pendingName ? pendingName.chipName : '';
      const hbmHasData = m.hbmTotal != null && m.hbmTotal > 0;
      const memUsed = hbmHasData ? m.hbmUsed : m.memoryUsed;
      const memTotal = hbmHasData ? m.hbmTotal : m.memoryTotal;
      if (isPhyIdFormat) {
        npuMap.set(secondToken, {
          id: secondToken,
          npuId,
          die: firstToken,
          name: chipName,
          util: m.util,
          memoryUsed: memUsed,
          memoryTotal: memTotal,
          hbmUsed: m.hbmUsed,
          hbmTotal: m.hbmTotal,
        });
      } else {
        npuMap.set(firstToken, {
          id: firstToken,
          npuId: firstToken,
          die: '0',
          name: chipName,
          util: m.util,
          memoryUsed: memUsed,
          memoryTotal: memTotal,
          hbmUsed: m.hbmUsed,
          hbmTotal: m.hbmTotal,
        });
      }
    } else {
      pendingName = { id: firstToken, chipName: secondToken };
    }
  }

  const npus = Array.from(npuMap.values());
  for (const npu of npus) {
    const process = processMap.get(String(npu.id));
    if (process) {
      npu.processDir = process.dir;
      npu.processMemory = process.memory;
    }
  }
  npus.sort((a, b) => Number(a.npuId) - Number(b.npuId) || Number(a.id) - Number(b.id));
  return { npus, raw: stdout, processes };
}

function collectProcessRow(cols, processMap, processes, npuMap, options) {
  const firstCell = cols[1] || '';
  const tokens = firstCell.split(/\s+/).filter(Boolean);
  const firstToken = tokens[0] || '';
  if (!/^\d+$/.test(firstToken)) return;

  const secondToken = tokens[1] || '';
  const npuKey = resolveProcessNpuKey(firstToken, secondToken, npuMap, options);
  const pid = (cols[2] || '').trim();
  const processName = (cols[3] || '').trim();
  const processMemory = numOrNull(cols[4]);
  const dir = extractProcessDirectory(processName);
  if (!/^\d+$/.test(pid) || processMemory == null) return;

  processes.push({ npuId: npuKey, pid, name: processName, memory: processMemory, dir });
  if (!dir) return;

  const current = processMap.get(npuKey);
  if (!current || processMemory > current.memory) {
    processMap.set(npuKey, { dir, memory: processMemory });
  }
}

function resolveProcessNpuKey(firstToken, secondToken, npuMap, options) {
  if (!options.isPhyIdFormat) return firstToken;
  if (!/^\d+$/.test(secondToken)) return firstToken;

  for (const [id, npu] of npuMap.entries()) {
    if (String(npu.npuId) === firstToken && String(npu.die) === secondToken) return id;
  }
  return secondToken;
}

function extractProcessDirectory(value) {
  if (!value) return '';
  const pathMatch = String(value).match(/(?:^|\s)(\/[^\s'"|]+)/);
  if (!pathMatch) return '';
  const clean = pathMatch[1].replace(/[),;]+$/, '');
  const parts = clean.split('/').filter(Boolean);
  if (parts[0] === 'home' && parts.length >= 3) return '/' + parts.slice(0, 3).join('/');
  if (parts.length <= 1) return clean;
  return '/' + parts.slice(0, -1).join('/');
}

function extractChipRow(cols) {
  const cells = [];
  for (let i = 2; i < cols.length; i++) {
    const cell = (cols[i] || '').trim();
    if (!cell) continue;
    if (/^[0-9a-fA-F]{4}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}\.0$/.test(cell)) continue;
    cells.push(cell);
  }
  const ratios = [];
  const plainNums = [];
  for (const cell of cells) {
    const ratioRe = /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/g;
    let m;
    while ((m = ratioRe.exec(cell)) !== null) {
      ratios.push({ used: Number(m[1]), total: Number(m[2]) });
    }
    const stripped = cell.replace(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/g, ' ');
    const numRe = /-?\d+(?:\.\d+)?/g;
    let n;
    while ((n = numRe.exec(stripped)) !== null) {
      plainNums.push(Number(n[0]));
    }
  }
  return {
    util: plainNums.length ? plainNums[0] : null,
    memoryUsed: ratios.length ? ratios[0].used : null,
    memoryTotal: ratios.length ? ratios[0].total : null,
    hbmUsed: ratios.length ? ratios[ratios.length - 1].used : null,
    hbmTotal: ratios.length ? ratios[ratios.length - 1].total : null,
  };
}

function fallbackExtract(line) {
  const util = scanRightmostNumber(line, /(?:Util|Util-Gpu|AICore)[^0-9]*(\d+(?:\.\d+)?)/i);
  const mem = line.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  return {
    util: util != null ? Number(util) : null,
    memoryUsed: mem ? Number(mem[1]) : null,
    memoryTotal: mem ? Number(mem[2]) : null,
  };
}

function scanRightmostNumber(s, re) {
  const m = s.match(re);
  return m ? m[1] : null;
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

module.exports = { parseNpuSmi };
