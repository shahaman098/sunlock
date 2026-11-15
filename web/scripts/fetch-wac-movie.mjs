/**
 * Sample LROC's timestamped south-pole photographs for the shadow-timing validation.
 *
 * Product: WAC_POLE_MOVIE_SOUTH (LROC RDR, LROLRC_2001): one map-projected Wide Angle Camera
 * strip per orbit (about every 2 hours), I/F at 100 m/px, polar stereographic, 6080 x 6080
 * float32 after a 24,320-byte PDS3 header. Each file is 148 MB, so only the rows within 25 km of
 * the pole are requested (HTTP Range, 12 MB per frame), and only the values at a fixed grid are
 * kept: every 1 km in x and y within 24 km of the pole (no point is chosen by hand).
 *
 * Frames: every frame of December 2009 (the densest month, ~13 per day, nearly one lunar day).
 *
 * Output (committed, so the validation runs offline):
 *   research/validation/wac-movie-samples.json  frames (name, time), grid definition
 *   research/validation/wac-movie-samples.bin   float32 [frame][point] I/F, NaN = outside the strip
 *
 * Run: npm run fetch:wac-movie   (about 2.7 GB of range requests)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HOST = "https://pds.mcp.nasa.gov/data/store/img";
const PREFIX = "lunar_reconnaissance_orbiter/pds4/lroc/lro-l-lroc-5-rdr/LROLRC_2001/DATA/BDR/WAC_POLE/WAC_POLE_MOVIE_SOUTH/";
const N = 6080, HEADER = 24320, C = 3039.5, PIX_M = 100;
const ROW0 = 2790, ROW1 = 3290; // rows fetched (y within +-25 km of the pole)
const GRID_M = 1000, RADIUS_M = 24000;
const MONTH = "200912";

// ---- the fixed grid ----
const points = [];
for (let y = -RADIUS_M; y <= RADIUS_M; y += GRID_M)
  for (let x = -RADIUS_M; x <= RADIUS_M; x += GRID_M)
    if (Math.hypot(x, y) <= RADIUS_M) points.push({ x, y });

// ---- list the month's frames ----
async function list() {
  const names = new Set();
  let token = null;
  for (let page = 0; page < 40; page++) {
    const u = `${HOST}/?list-type=2&max-keys=1000&prefix=${PREFIX}WAC_MOVIE_S${MONTH}${token ? `&continuation-token=${encodeURIComponent(token)}` : ""}`;
    const xml = await (await fetch(u)).text();
    for (const m of xml.matchAll(/<Key>[^<]*\/(WAC_MOVIE_S\d{8}T\d{4})\.IMG<\/Key>/g)) names.add(m[1]);
    token = xml.match(/<NextContinuationToken>([^<]+)/)?.[1] ?? null;
    if (!token) break;
  }
  return [...names].sort();
}

async function sample(name) {
  const url = `${HOST}/${PREFIX}${name}.IMG`;
  const from = HEADER + ROW0 * N * 4, to = HEADER + ROW1 * N * 4 - 1;
  for (let attempt = 1; ; attempt++) {
    try {
      const [img, lbl] = await Promise.all([
        fetch(url, { headers: { range: `bytes=${from}-${to}` } }).then((r) => { if (r.status !== 206) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }),
        fetch(`${HOST}/${PREFIX}${name}.xml`).then((r) => r.text()),
      ]);
      if (img.byteLength !== to - from + 1) throw new Error(`short read ${img.byteLength}`);
      const a = new Float32Array(img);
      const start = Date.parse(lbl.match(/<start_date_time>([^<]+)/)[1]), stop = Date.parse(lbl.match(/<stop_date_time>([^<]+)/)[1]);
      const out = new Float32Array(points.length);
      points.forEach((p, i) => {
        // x right, y: north (toward lon 0) is up the image, i.e. smaller line numbers
        const col = Math.round(C + p.x / PIX_M), row = Math.round(C - p.y / PIX_M) - ROW0;
        const v = a[row * N + col];
        out[i] = v < -1e30 ? NaN : v;
      });
      return { name, start, stop, out };
    } catch (e) {
      if (attempt >= 4) throw new Error(`${name}: ${e.message}`);
    }
  }
}

const names = await list();
console.log(`${names.length} frames in ${MONTH}, ${points.length} grid points`);
const results = new Array(names.length);
let next = 0, done = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < names.length) {
    const i = next++;
    results[i] = await sample(names[i]);
    if (++done % 20 === 0) process.stderr.write(`${done} `);
  }
}));
const bin = new Float32Array(names.length * points.length);
results.forEach((r, i) => bin.set(r.out, i * points.length));
const dir = path.join(ROOT, "research/validation");
fs.writeFileSync(path.join(dir, "wac-movie-samples.bin"), Buffer.from(bin.buffer));
fs.writeFileSync(path.join(dir, "wac-movie-samples.json"), JSON.stringify({
  product: "LROC WAC_POLE_MOVIE_SOUTH (LRO-L-LROC-5-RDR-V1.0, LROLRC_2001), I/F, 100 m/px",
  source: `${HOST}/${PREFIX}`,
  grid: { what: "polar stereographic metres from the pole; x toward 90 E, y toward 0 E", stepM: GRID_M, radiusM: RADIUS_M, points: points.map((p) => [p.x, p.y]) },
  frames: results.map((r) => ({ name: r.name, start: new Date(r.start).toISOString(), stop: new Date(r.stop).toISOString() })),
}) + "\n");
console.log(`\nwrote wac-movie-samples.bin (${(bin.byteLength / 1e6).toFixed(1)} MB) and .json`);
