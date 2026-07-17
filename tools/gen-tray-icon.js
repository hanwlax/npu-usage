'use strict';
// Generate a 16x16 PNG tray icon (amber filled square with white N)
// Uses pure Node (no external deps). The PNG format: signature + IHDR + IDAT + IEND.

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; }
function u8(n) { return Buffer.from([n & 0xff]); }
function chunk(type, data) {
  const len = u32(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = u32(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const W = 32, H = 32;

function paint(px, x, y, color) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  px[i] = color[0];
  px[i + 1] = color[1];
  px[i + 2] = color[2];
  px[i + 3] = color[3];
}

function roundedRectContains(x, y, left, top, right, bottom, r) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = x < left + r ? left + r : x > right - r ? right - r : x;
  const cy = y < top + r ? top + r : y > bottom - r ? bottom - r : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

// R, G, B, A per pixel
function makePixels() {
  const px = Buffer.alloc(W * H * 4);
  const bg = [0x18, 0x1c, 0x22, 0xff];     // dark card
  const bgHi = [0x24, 0x27, 0x2f, 0xff];   // top sheen
  const border = [0x3d, 0x42, 0x4b, 0xff];
  const amber = [0xf5, 0x7e, 0x53, 0xff];
  const cream = [0xf2, 0xed, 0xe6, 0xff];
  const ok = [0x39, 0x73, 0x5f, 0xff];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const onBorder = roundedRectContains(x, y, 2, 2, 29, 29, 7);
      const onFill = roundedRectContains(x, y, 3, 3, 28, 28, 6);
      if (onBorder) paint(px, x, y, border);
      if (onFill) paint(px, x, y, y < 14 ? bgHi : bg);
    }
  }

  for (let y = 8; y <= 23; y++) {
    for (let x = 8; x <= 11; x++) paint(px, x, y, amber);
    for (let x = 20; x <= 23; x++) paint(px, x, y, cream);
  }

  for (let x = 12; x <= 21; x++) {
    const centerY = 8 + (x - 12) * 1.55;
    for (let y = Math.floor(centerY - 2); y <= Math.ceil(centerY + 2); y++) {
      if (y >= 8 && y <= 23 && Math.abs(y - centerY) <= 2.1) paint(px, x, y, amber);
    }
  }

  for (let y = 22; y <= 27; y++) {
    for (let x = 22; x <= 27; x++) {
      const dx = x - 24.5;
      const dy = y - 24.5;
      if (dx * dx + dy * dy <= 8.5) paint(px, x, y, ok);
    }
  }

  return px;
}

function makePNG() {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.concat([
    u32(W), u32(H),
    u8(8),       // bit depth
    u8(6),       // color type RGBA
    u8(0), u8(0), u8(0),  // compression, filter, interlace
  ]);
  const px = makePixels();
  // Add filter byte (0 = none) at start of each scanline
  const raw = Buffer.alloc(H * (W * 4 + 1));
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
  }
  const idatData = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idatData), chunk('IEND', Buffer.alloc(0))]);
}

const out = path.join(__dirname, '..', 'tray-icon.png');
fs.writeFileSync(out, makePNG());
console.log('Wrote', out, '(32x32 PNG)');
