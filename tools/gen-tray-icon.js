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
// R, G, B, A per pixel
function makePixels() {
  const px = Buffer.alloc(W * H * 4);
  const bg = [0xf5, 0xa6, 0x23, 0xff];     // amber
  const fg = [0x0a, 0x0c, 0x0f, 0xff];     // near-black
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      // Background
      px[i] = bg[0]; px[i + 1] = bg[1]; px[i + 2] = bg[2]; px[i + 3] = bg[3];
      // Letter N: vertical bars at x∈[10,14] and [22,26], diagonal between
      const inLeft = x >= 10 && x <= 14;
      const inRight = x >= 22 && x <= 26;
      const inDiag = false;
      if (inLeft && y >= 8 && y <= 26) { px[i] = fg[0]; px[i + 1] = fg[1]; px[i + 2] = fg[2]; }
      if (inRight && y >= 8 && y <= 26) { px[i] = fg[0]; px[i + 1] = fg[1]; px[i + 2] = fg[2]; }
      // diagonal from top-left of right bar to bottom-left of left bar
      // y = 8 + (26-8) * (x-14)/(26-14) = 8 + 1.5*(x-14)
      if (x >= 14 && x <= 26 && y >= 8 && y <= 26) {
        const expectedY = 8 + 1.5 * (x - 14);
        if (Math.abs(y - expectedY) < 1.6) {
          px[i] = fg[0]; px[i + 1] = fg[1]; px[i + 2] = fg[2];
        }
      }
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
