'use strict';
/**
 * Generates build/icon.ico and build/icon.png from scratch — a gold ❖ on the app's own
 * near-black, drawn as raw pixels so the build needs no design tool and no binary asset in git.
 *
 *   node scripts/make-icon.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT = path.join(__dirname, '..', 'build');

/* --- the mark, as a signed-distance-ish rasteriser ------------------------------- */

const BG = [0x0b, 0x0b, 0x0e];
const GOLD = [0xe4, 0xcf, 0x9a];
const GOLD_DIM = [0x8a, 0x7c, 0x5c];

/**
 * Draw the diamond-in-diamond ❖ at a given size.
 * Returns RGBA bytes, row-major.
 */
function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const outer = size * 0.40;
  const innerOuter = size * 0.185;
  const ring = Math.max(1, size * 0.055);

  // Supersample so the diagonals do not stair-step at small sizes.
  const S = 4;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      let inner = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const fx = x + (sx + 0.5) / S - c;
          const fy = y + (sy + 0.5) / S - c;
          // A diamond is just the L1 (taxicab) distance from the centre.
          const d = Math.abs(fx) + Math.abs(fy);
          if (d <= outer && d >= outer - ring) hits++;
          if (d <= innerOuter) inner++;
        }
      }
      const total = S * S;
      const a = hits / total;
      const b = inner / total;
      const strength = Math.min(1, a + b);

      const i = (y * size + x) * 4;
      const fg = b > a ? GOLD : GOLD_DIM;
      px[i] = Math.round(BG[0] + (fg[0] - BG[0]) * strength);
      px[i + 1] = Math.round(BG[1] + (fg[1] - BG[1]) * strength);
      px[i + 2] = Math.round(BG[2] + (fg[2] - BG[2]) * strength);
      px[i + 3] = 255;
    }
  }
  return px;
}

/* --- PNG ------------------------------------------------------------------------- */

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function toPng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  // Each scanline is prefixed with its filter type; 0 means none.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* --- ICO (a container of PNGs, which Windows Vista+ accepts) ---------------------- */

function toIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach((e, i) => {
    const at = i * 16;
    dir[at] = e.size >= 256 ? 0 : e.size;      // 0 means 256
    dir[at + 1] = e.size >= 256 ? 0 : e.size;
    dir[at + 2] = 0;  // palette
    dir[at + 3] = 0;  // reserved
    dir.writeUInt16LE(1, at + 4);   // colour planes
    dir.writeUInt16LE(32, at + 6);  // bits per pixel
    dir.writeUInt32BE(0, at + 8);
    dir.writeUInt32LE(e.png.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += e.png.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

/* --- go ---------------------------------------------------------------------------- */

fs.mkdirSync(OUT, { recursive: true });

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const entries = icoSizes.map((size) => ({ size, png: toPng(render(size), size) }));

fs.writeFileSync(path.join(OUT, 'icon.ico'), toIco(entries));
fs.writeFileSync(path.join(OUT, 'icon.png'), toPng(render(1024), 1024));

console.log(`icon.ico  (${icoSizes.join(', ')} px)`);
console.log('icon.png  (1024 px — electron-builder converts this to .icns for macOS)');
