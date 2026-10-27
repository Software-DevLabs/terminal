import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const SIZE = 1024;
const feather = 1;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const len = abx * abx + aby * aby || 1;
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / len, 0, 1);
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

/** Coverage of a stroked capsule, used for the prompt glyph. */
function capsule(px, py, ax, ay, bx, by, thickness) {
  const half = thickness / 2;
  return clamp(half + feather / 2 - sdSegment(px, py, ax, ay, bx, by), 0, 1);
}

const box = { cx: SIZE / 2, cy: SIZE / 2, hw: 448, hh: 400, r: 96 };
const barHeight = 128;

const lights = [
  { x: box.cx - box.hw + 96, c: [255, 95, 87] },
  { x: box.cx - box.hw + 200, c: [254, 188, 46] },
  { x: box.cx - box.hw + 304, c: [40, 200, 64] },
];

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const top = [46, 46, 52];
const bottom = [20, 20, 24];
const barTop = [62, 62, 70];
const barBottom = [46, 46, 54];

const buf = new Uint8Array(SIZE * SIZE * 4);

for (let y = 0; y < SIZE; y += 1) {
  const v = (y - (box.cy - box.hh)) / (box.hh * 2);
  const body = mix(top, bottom, clamp(v, 0, 1));
  const band = mix(barTop, barBottom, clamp(v, 0, 1));
  for (let x = 0; x < SIZE; x += 1) {
    const d = sdRoundRect(x, y, box.cx, box.cy, box.hw, box.hh, box.r);
    const inside = clamp(feather / 2 - d, 0, 1);
    if (inside === 0) continue;

    let color = body;
    let alpha = inside;

    if (y < box.cy - box.hh + barHeight) {
      color = band;
    }

    // Hairline rim keeps the dark icon legible on both light and dark taskbars.
    if (d > -4) {
      color = mix(color, [255, 255, 255], 0.16);
    }

    for (const light of lights) {
      const cover = clamp(feather / 2 - sdCircle(x, y, light.x, box.cy - box.hh + barHeight / 2, 26), 0, 1);
      if (cover === 0) continue;
      color = mix(color, light.c, cover);
      alpha = Math.max(alpha, cover * inside);
    }

    const glyph = [
      capsule(x, y, box.cx - box.hw + 104, box.cy + 40, box.cx - box.hw + 216, box.cy + 152, 40),
      capsule(x, y, box.cx - box.hw + 216, box.cy + 152, box.cx - box.hw + 104, box.cy + 264, 40),
      capsule(x, y, box.cx - box.hw + 288, box.cy + 236, box.cx - box.hw + 432, box.cy + 236, 40),
    ].reduce((a, b) => Math.max(a, b), 0);
    if (glyph !== 0) {
      color = mix(color, [78, 226, 122], glyph);
      alpha = Math.max(alpha, glyph * inside);
    }

    const i = (y * SIZE + x) * 4;
    buf[i] = Math.round(color[0]);
    buf[i + 1] = Math.round(color[1]);
    buf[i + 2] = Math.round(color[2]);
    buf[i + 3] = Math.round(alpha * 255);
  }
}

/* ---------------- PNG encoding ---------------- */

const table = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([head, name, data, tail]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y += 1) {
  Buffer.from(buf.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

writeFileSync(new URL('../src-tauri/app-icon.png', import.meta.url), png);
console.log(`src-tauri/app-icon.png ${SIZE}x${SIZE} ${(png.length / 1024).toFixed(1)} KiB`);
