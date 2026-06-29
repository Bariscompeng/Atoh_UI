// Zero-dependency PNG icon generator for the PWA.
// Draws the SIMSOFT "◆" mark on a dark rounded background and writes PNGs.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
mkdirSync(OUT, { recursive: true });

// ---- tiny PNG encoder (RGBA, no filtering) ----
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
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // raw scanlines with filter byte 0
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- drawing ----
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BG = hex("#04090f");
const PANEL = hex("#0b1929");
const ACCENT = hex("#0ea5e9");

function draw(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const r = maskable ? size * 0.5 : size * 0.22; // corner radius (maskable = full bleed)
  const cx = size / 2, cy = size / 2;
  const set = (x, y, rgb, a = 255) => {
    const i = (y * size + x) * 4;
    buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2]; buf[i + 3] = a;
  };
  // rounded-rect background test
  const inRounded = (x, y) => {
    const dx = Math.max(r - x, x - (size - 1 - r), 0);
    const dy = Math.max(r - y, y - (size - 1 - r), 0);
    return dx * dx + dy * dy <= r * r;
  };
  // diamond (rotated square) glyph
  const glyph = size * 0.30;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inRounded(x, y)) { set(x, y, BG, 0); continue; }
      set(x, y, BG, 255);
      // subtle radial panel glow
      const dr = Math.hypot(x - cx, y - cy) / (size * 0.55);
      if (dr < 1) {
        const t = (1 - dr) * 0.5;
        set(x, y, [
          Math.round(BG[0] + (PANEL[0] - BG[0]) * t),
          Math.round(BG[1] + (PANEL[1] - BG[1]) * t),
          Math.round(BG[2] + (PANEL[2] - BG[2]) * t),
        ], 255);
      }
      // diamond outline
      const md = Math.abs(x - cx) + Math.abs(y - cy);
      const w = size * 0.035;
      if (md <= glyph && md >= glyph - w) set(x, y, ACCENT, 255);
      if (md < glyph - w) {
        const t = 0.18 * (1 - md / glyph);
        set(x, y, [
          Math.round(BG[0] + (ACCENT[0] - BG[0]) * t),
          Math.round(BG[1] + (ACCENT[1] - BG[1]) * t),
          Math.round(BG[2] + (ACCENT[2] - BG[2]) * t),
        ], 255);
      }
    }
  }
  return encodePNG(size, size, buf);
}

const targets = [
  ["icon-192.png", 192, {}],
  ["icon-512.png", 512, {}],
  ["maskable-192.png", 192, { maskable: true }],
  ["maskable-512.png", 512, { maskable: true }],
  ["apple-touch-icon.png", 180, { maskable: true }],
  ["favicon-64.png", 64, {}],
];
for (const [name, size, opts] of targets) {
  writeFileSync(join(OUT, name), draw(size, opts));
  console.log("wrote", name);
}
