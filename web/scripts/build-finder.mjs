/**
 * Site-finder grid for 85-90 deg S, built only from NASA products:
 *   - AVGVISIB_85S_060M_201608        LOLA team, 18.6-year average Sun visibility (PGDA product 69)
 *   - AVGVISIB_85S_060M_201608_EARTH  the same for Earth
 *   - LPSR_85S_060M_201608            permanent shadow (where water ice can survive)
 *   - LDEM_80S_80M                    LOLA terrain, for slope
 *
 * Output (web/public/terrain/finder.bin): N x N cells (~600 m) over the square that holds the
 * 85 deg S circle, in the same polar-stereographic axes as the app's map. Each cell keeps
 * three candidate 60 m spots (sunniest overall, sunniest with slope <= 8 deg, sunniest with
 * slope <= 4 deg); every value of a candidate belongs to that one spot, and the spot's own
 * pixel is stored so the app opens exactly the place whose numbers it shows. See the cell
 * loop below for the byte layout; finder.json carries the layout and projection.
 *
 * Run: npm run finder
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDem, N as DEM_N, PIX_M as DEM_PIX, CENTER as DEM_C, M_PER_DN } from "../../scripts/lib/horizon.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const OUT_N = 512;

function loadRef(base) {
  const dir = path.join(ROOT, "research/validation/raw");
  const lbl = fs.readFileSync(path.join(dir, `${base}.LBL`), "latin1");
  const num = (k) => Number(lbl.match(new RegExp(`${k}\\s*=\\s*([-+0-9.]+)`))[1]);
  const n = num("LINES");
  const buf = fs.readFileSync(path.join(dir, `${base}.IMG`));
  return {
    n, scale: num("SCALING_FACTOR"), offsetV: num("OFFSET"), off: num("LINE_PROJECTION_OFFSET"), mapScale: num("MAP_SCALE"),
    data: new Int16Array(buf.buffer, buf.byteOffset, n * n),
  };
}
const sun = loadRef("AVGVISIB_85S_060M_201608");
const earth = loadRef("AVGVISIB_85S_060M_201608_EARTH");
const lpsr = loadRef("LPSR_85S_060M_201608");
const dem = loadDem(path.join(ROOT, "data/raw/ldem_80s_80m.img"));
const NP = sun.n, PIX = sun.mapScale, OFF = sun.off;

const slopeAt = (xi, yi) => {
  if (xi < 1 || yi < 1 || xi >= DEM_N - 1 || yi >= DEM_N - 1) return null;
  const z = (dx, dy) => dem[(yi + dy) * DEM_N + (xi + dx)] * M_PER_DN;
  const gx = (z(1, -1) + 2 * z(1, 0) + z(1, 1) - (z(-1, -1) + 2 * z(-1, 0) + z(-1, 1))) / (8 * DEM_PIX);
  const gy = (z(-1, 1) + 2 * z(0, 1) + z(1, 1) - (z(-1, -1) + 2 * z(0, -1) + z(1, -1))) / (8 * DEM_PIX);
  return (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI;
};

// ---- per 60 m pixel: distance to the nearest permanently shadowed pixel (exact Euclidean
// distance transform, Felzenszwalb & Huttenlocher 2012, two 1-D passes)
console.time("distance to permanent shadow");
const INF = 1e20;
const f = new Float64Array(NP * NP);
for (let k = 0; k < NP * NP; k++) f[k] = lpsr.data[k] * lpsr.scale + lpsr.offsetV > 0.5 ? 0 : INF;
function edt1d(get, set, n) {
  const v = new Int32Array(n), z = new Float64Array(n + 1), d = new Float64Array(n);
  let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let sx = ((get(q) + q * q) - (get(v[k]) + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (sx <= z[k]) { k--; sx = ((get(q) + q * q) - (get(v[k]) + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = sx; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + get(v[k]); }
  for (let q = 0; q < n; q++) set(q, d[q]);
}
for (let x = 0; x < NP; x++) edt1d((y) => f[y * NP + x], (y, val) => { f[y * NP + x] = val; }, NP);
for (let y = 0; y < NP; y++) edt1d((x) => f[y * NP + x], (x, val) => { f[y * NP + x] = val; }, NP);
console.timeEnd("distance to permanent shadow");
const psrKmAt = (k) => (Math.sqrt(f[k]) * PIX) / 1000;

// ---- cells. Each keeps three candidate 60 m spots: the sunniest overall, the sunniest
// with slope <= 8 deg and the sunniest with slope <= 4 deg (so a flatter spot that passes
// stricter limits is not thrown away). Bytes per candidate:
//   sun %, Earth %, slope x4, km to permanent shadow x20 (255 = farther than 12.7 km), dx, dy
// where dx, dy locate the spot's 60 m pixel inside the cell (255 = no such spot).
const HALF_M = OFF * PIX;
const CELL_M = (2 * HALF_M) / OUT_N;
const K = 3, B = 6, SLOPE_CAPS = [Infinity, 8, 4];
const out = new Uint8Array(OUT_N * OUT_N * K * B).fill(255);
console.log(`cell ${CELL_M.toFixed(1)} m, ${K} candidates per cell`);
console.time("cells");
const slopeCache = new Float32Array(NP * NP).fill(NaN);
const slopeOfPixel = (a, b) => {
  const k = b * NP + a;
  if (Number.isNaN(slopeCache[k])) {
    const xm = (a + 0.5 - OFF) * PIX, ym = (b + 0.5 - OFF) * PIX;
    const sl = slopeAt(Math.round(DEM_C + xm / DEM_PIX), Math.round(DEM_C + ym / DEM_PIX));
    slopeCache[k] = sl === null ? -1 : sl;
  }
  return slopeCache[k];
};
for (let j = 0; j < OUT_N; j++) {
  for (let i = 0; i < OUT_N; i++) {
    const x0 = -HALF_M + i * CELL_M, y0 = -HALF_M + j * CELL_M;
    const a0 = Math.floor(OFF + x0 / PIX), a1 = Math.floor(OFF + (x0 + CELL_M) / PIX);
    const b0 = Math.floor(OFF + y0 / PIX), b1 = Math.floor(OFF + (y0 + CELL_M) / PIX);
    const best = SLOPE_CAPS.map(() => ({ s: -1, a: 0, b: 0 }));
    for (let b = b0; b < b1; b++) {
      if (b < 0 || b >= NP) continue;
      for (let a = a0; a < a1; a++) {
        if (a < 0 || a >= NP) continue;
        const k = b * NP + a;
        const sv = sun.data[k] * sun.scale + sun.offsetV;
        if (sv < 0 || sv > 1.0001) continue;
        const sl = slopeOfPixel(a, b);
        if (sl < 0) continue;
        for (let c = 0; c < K; c++) if (sl <= SLOPE_CAPS[c] && sv > best[c].s) best[c] = { s: sv, a, b };
      }
    }
    for (let c = 0; c < K; c++) {
      if (best[c].s < 0) continue;
      const { a, b } = best[c], k = b * NP + a;
      const o = ((j * OUT_N + i) * K + c) * B;
      out[o] = Math.round(100 * best[c].s);
      out[o + 1] = Math.round(100 * (earth.data[k] * earth.scale + earth.offsetV));
      out[o + 2] = Math.min(254, Math.round(slopeOfPixel(a, b) * 4));
      const km = psrKmAt(k);
      out[o + 3] = km <= 12.7 ? Math.round(km * 20) : 255;
      out[o + 4] = a - a0;
      out[o + 5] = b - b0;
    }
  }
}
console.timeEnd("cells");

const file = path.join(ROOT, "web/public/terrain/finder.bin");
fs.writeFileSync(file, out);
const meta = {
  n: OUT_N, k: K, bytesPerCandidate: B, slopeCaps: [null, 8, 4], cellM: +CELL_M.toFixed(4), halfM: HALF_M, pixM: PIX, off: OFF,
  candidate: ["sunPct", "earthPct", "slopeDegX4", "psrKmX20", "dxPixel", "dyPixel"],
  sources: ["AVGVISIB_85S_060M_201608", "AVGVISIB_85S_060M_201608_EARTH", "LPSR_85S_060M_201608", "LDEM_80S_80M"],
  generated: new Date().toISOString(),
};
fs.writeFileSync(path.join(ROOT, "web/public/terrain/finder.json"), JSON.stringify(meta));
console.log(`wrote ${path.relative(ROOT, file)} (${(out.length / 1e6).toFixed(1)} MB)`);
