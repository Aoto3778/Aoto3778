'use strict';

/*
 * Generates build/icon.png (a clock icon) without any image libraries.
 * Renders at 3x and downsamples for anti-aliasing, then writes a PNG by hand.
 * Run with: npm run icon
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 512;
const SS = 3;
const HS = SIZE * SS;
const buf = new Uint8ClampedArray(HS * HS * 4); // hi-res RGBA, default transparent

function clamp(v, a, b) { return Math.min(Math.max(v, a), b); }
function lerp(a, b, t) { return a + (b - a) * t; }
function set(x, y, r, g, b) {
  const i = (y * HS + x) * 4;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
}
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = clamp(t, 0, 1);
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// geometry (in SIZE units)
const m = SIZE * 0.06, rr = SIZE * 0.20;
const cx = SIZE / 2, cy = SIZE / 2;
const rFace = SIZE * 0.34, ringW = SIZE * 0.016, centerR = SIZE * 0.024;

function gradient(fy) {
  const t = clamp(fy / SIZE, 0, 1);
  return [lerp(32, 40, t), lerp(84, 150, t), lerp(160, 95, t)];
}
const FACE = [245, 247, 250], RING = [206, 213, 224];
const TICK = [96, 108, 130], MAJOR = [56, 68, 92];
const HAND = [38, 50, 70], CENTER = [48, 160, 100];

// hands: minute at 8min, hour at ~10:08 (a friendly pose)
function endPoint(angDeg, len) {
  const a = angDeg * Math.PI / 180;
  return [cx + len * Math.sin(a), cy - len * Math.cos(a)];
}
const minEnd = endPoint(48, rFace * 0.66);
const hourEnd = endPoint(304, rFace * 0.46);
const minTh = SIZE * 0.018, hourTh = SIZE * 0.028;

// 12 tick endpoints (radial segments)
const ticks = [];
for (let k = 0; k < 12; k++) {
  const a = k * 30 * Math.PI / 180;
  const sin = Math.sin(a), cos = -Math.cos(a);
  const inner = (k % 3 === 0) ? rFace * 0.74 : rFace * 0.82;
  ticks.push({
    ax: cx + sin * inner, ay: cy + cos * inner,
    bx: cx + sin * (rFace * 0.92), by: cy + cos * (rFace * 0.92),
    th: (k % 3 === 0) ? SIZE * 0.013 : SIZE * 0.008,
    major: (k % 3 === 0)
  });
}

for (let y = 0; y < HS; y++) {
  for (let x = 0; x < HS; x++) {
    const fx = (x + 0.5) / SS, fy = (y + 0.5) / SS;

    // rounded-rect mask
    const nx = clamp(fx, m + rr, SIZE - m - rr);
    const ny = clamp(fy, m + rr, SIZE - m - rr);
    if (Math.hypot(fx - nx, fy - ny) > rr) continue; // outside → transparent

    let col = gradient(fy);
    const d = Math.hypot(fx - cx, fy - cy);

    if (d <= rFace) {
      col = (d >= rFace - ringW) ? RING : FACE;
      if (d > rFace * 0.7 && d < rFace * 0.95) {
        for (let t = 0; t < ticks.length; t++) {
          const tk = ticks[t];
          if (distSeg(fx, fy, tk.ax, tk.ay, tk.bx, tk.by) <= tk.th) {
            col = tk.major ? MAJOR : TICK; break;
          }
        }
      }
      if (distSeg(fx, fy, cx, cy, minEnd[0], minEnd[1]) <= minTh) col = HAND;
      if (distSeg(fx, fy, cx, cy, hourEnd[0], hourEnd[1]) <= hourTh) col = HAND;
      if (d <= centerR) col = CENTER;
    }
    set(x, y, col[0], col[1], col[2]);
  }
}

// downsample SS×SS → SIZE
const out = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const i = ((y * SS + sy) * HS + (x * SS + sx)) * 4;
        const pa = buf[i + 3];
        r += buf[i] * pa; g += buf[i + 1] * pa; b += buf[i + 2] * pa; a += pa;
      }
    }
    const o = (y * SIZE + x) * 4;
    if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
    out[o + 3] = Math.round(a / (SS * SS));
  }
}

// ---- minimal PNG encoder ----
const crcTable = (function () {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
let pos = 0;
for (let y = 0; y < SIZE; y++) {
  raw[pos++] = 0; // filter: none
  out.copy(raw, pos, y * SIZE * 4, (y + 1) * SIZE * 4);
  pos += SIZE * 4;
}
const idat = zlib.deflateSync(raw, { level: 9 });
const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);

const outPath = path.join(__dirname, 'icon.png');
fs.writeFileSync(outPath, png);
console.log('wrote ' + outPath + ' (' + png.length + ' bytes, ' + SIZE + 'x' + SIZE + ')');
