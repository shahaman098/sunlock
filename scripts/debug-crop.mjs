import fs from "node:fs";
import zlib from "node:zlib";

const N = 7600, PIX_M = 80, R = 1737400, C = (N - 1) / 2;
const b = fs.readFileSync(new URL("../data/raw/ldem_80s_80m.img", import.meta.url));
const d = new Int16Array(b.buffer, b.byteOffset, N * N);
const proj = (lat, lon) => {
  const colat = ((90 - Math.abs(lat)) * Math.PI) / 180;
  const r = (2 * R * Math.tan(colat / 2)) / PIX_M;
  const a = (lon * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
};
const [lat, lon, span] = process.argv.slice(2).map(Number);
const [cx, cy] = proj(lat, lon);
const s = span || 300;
let lo = 1e9, hi = -1e9;
const e = new Float32Array(s * s);
for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
  const sx = Math.round(cx - s / 2 + x), sy = Math.round(cy - s / 2 + y);
  const v = (sx < 0 || sy < 0 || sx >= N || sy >= N) ? 0 : d[sy * N + sx] * 0.5;
  e[y * s + x] = v; if (v < lo) lo = v; if (v > hi) hi = v;
}
const rgb = Buffer.alloc(s * s * 3);
const az = 315 * Math.PI / 180, alt = 20 * Math.PI / 180;
const lx = Math.cos(alt) * Math.sin(az), ly = Math.cos(alt) * Math.cos(az), lz = Math.sin(alt);
for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
  const xl = Math.max(0, x - 1), xr = Math.min(s - 1, x + 1), yu = Math.max(0, y - 1), yd = Math.min(s - 1, y + 1);
  const dx = (e[y * s + xr] - e[y * s + xl]) / ((xr - xl) * PIX_M);
  const dy = (e[yd * s + x] - e[yu * s + x]) / ((yd - yu) * PIX_M);
  const nx = -dx, ny = -dy, nz = 1, L = Math.hypot(nx, ny, nz);
  const dot = (nx * lx + ny * ly + nz * lz) / L;
  const sh = Math.min(1, Math.max(0, 0.2 + 0.9 * dot));
  const t = (e[y * s + x] - lo) / (hi - lo);
  const i = (y * s + x) * 3;
  rgb[i] = Math.min(255, (40 + 180 * t) * sh);
  rgb[i + 1] = Math.min(255, (42 + 176 * t) * sh);
  rgb[i + 2] = Math.min(255, (50 + 165 * t) * sh);
}
const raw = Buffer.alloc((s * 3 + 1) * s);
for (let y = 0; y < s; y++) { raw[y * (s * 3 + 1)] = 0; rgb.copy(raw, y * (s * 3 + 1) + 1, y * s * 3, (y + 1) * s * 3); }
const idat = zlib.deflateSync(raw);
let tab = null;
const crc32 = (bb) => { if (!tab) { tab = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tab[n] = c; } } let c = -1; for (let i = 0; i < bb.length; i++) c = tab[(c ^ bb[i]) & 0xff] ^ (c >>> 8); return c ^ -1; };
const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td) >>> 0); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(s, 0); ihdr.writeUInt32BE(s, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync("/tmp/crop.png", Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]));
console.log(`lat ${lat} lon ${lon} pixel ${cx.toFixed(1)},${cy.toFixed(1)} elev ${e[s * s >> 1]} range ${lo.toFixed(0)}..${hi.toFixed(0)}`);
