/**
 * Pre-registered H3 (research/PREREGISTRATION.md): our illumination reproduces the LROC WAC
 * map over its own year, Pearson r >= 0.85.
 *
 * Reference: WAC_POLE_ILL_TWI_SOUTH_100M v1.3 (LROC team, Speyerer & Robinson 2013): share of
 * 3,807 Wide Angle Camera images, 15 Feb 2010 - 5 Feb 2011, in which each 100 m pixel is lit.
 * It is built from photographs, so it tests our shadows against observed shadows, with no
 * LOLA-derived product in between.
 *
 * Fixed by the pre-registration and followed here:
 *   - the same 2,000 seeded points as H1-H4 (seed 20261511, uniform in area over 85-90 S); the
 *     WAC map covers 88-90 S only, so the points of that sample inside it are used
 *   - both horizon conventions reported (shipped and converged, from scripts/lib/horizon.mjs,
 *     the code behind every skyline the app ships); converged is the one the app uses
 *   - any part of the solar disc above the skyline counts as lit; hourly over the WAC's own window
 *   - no exclusions: every valid pixel counts. Scattered light inflates WAC values inside
 *     shadow (named in the pre-registration as the reason for the lower threshold); a version
 *     without WAC values below 5% is reported as a SECONDARY sensitivity check, not the result.
 *
 * Registration: the WAC label gives a 1214 x 1214 float32 image (percent) after two 4856-byte
 * label records (the PDS4 XML says one; the PDS3 header, ^IMAGE = 3, and the file size say two,
 * and only two gives values in 0-100), polar stereographic, 100 m/px, origin at pixel 606.5.
 * Axis orientation is confirmed WITHOUT our model: the WAC map is correlated with NASA's LOLA
 * sunlight map (AVGVISIB) under each of the four possible axis flips, and the run stops unless
 * the standard orientation is clearly best.
 *
 * Run: npm run validate:wac  (writes research/validation/result-wac.json)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { skyAt, siteBasis } from "../.build/selene.js";
import { loadDem, horizonProfile, horizonAt } from "../../scripts/lib/horizon.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const RAW = path.join(ROOT, "research/validation/raw");
const R = 1737400, D = Math.PI / 180, SUN_R = 0.266;
const SEED = 20261511, N_POINTS = 2000;

// ---- WAC product ----
const REC = 4856, LABEL_RECORDS = 2, WAC_N = 1214, WAC_C = 606.5, WAC_PIX = 100;
const MISSING = -3.4e38; // 0xFF7FFFFB and the other special constants are all below this
const wbuf = fs.readFileSync(path.join(RAW, "wac_twi.img"));
if (wbuf.length !== (LABEL_RECORDS + WAC_N) * REC) throw new Error(`wac_twi.img: unexpected size ${wbuf.length}`);
const wac = new Float32Array(wbuf.buffer.slice(wbuf.byteOffset + LABEL_RECORDS * REC, wbuf.byteOffset + (LABEL_RECORDS + WAC_N) * REC));
const stereo = (lat, lon, pix) => {
  const r = (2 * R * Math.tan(((90 - Math.abs(lat)) * D) / 2)) / pix;
  return { x: r * Math.sin(lon * D), y: -r * Math.cos(lon * D) };
};
const wacAt = (lat, lon, fx = 1, fy = 1) => {
  const p = stereo(lat, lon, WAC_PIX);
  const x = Math.round(WAC_C + fx * p.x), y = Math.round(WAC_C + fy * p.y);
  if (x < 0 || y < 0 || x >= WAC_N || y >= WAC_N) return null;
  const v = wac[y * WAC_N + x];
  return v < MISSING || v < 0 || v > 100.001 ? null : v / 100;
};

// ---- NASA LOLA sunlight map, for registration only ----
const lbl = fs.readFileSync(path.join(RAW, "AVGVISIB_85S_060M_201608.LBL"), "latin1");
const num = (k) => Number(lbl.match(new RegExp(`${k}\\s*=\\s*([-+0-9.]+)`))[1]);
const lola = { n: num("LINES"), scale: num("SCALING_FACTOR"), off: num("LINE_PROJECTION_OFFSET"), pix: num("MAP_SCALE") };
const lbuf = fs.readFileSync(path.join(RAW, "AVGVISIB_85S_060M_201608.IMG"));
lola.data = new Int16Array(lbuf.buffer, lbuf.byteOffset, lola.n * lola.n);
const lolaAt = (lat, lon) => {
  const p = stereo(lat, lon, lola.pix);
  const x = Math.round(lola.off + p.x), y = Math.round(lola.off + p.y);
  return x < 0 || y < 0 || x >= lola.n || y >= lola.n ? null : lola.data[y * lola.n + x] * lola.scale;
};

// ---- the pre-registered sample (identical generator to validate-lola.mjs) ----
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const all = [];
while (all.length < N_POINTS) {
  const cosTheta = 1 - rand() * (1 - Math.cos(5 * D));
  all.push({ lat: -(90 - Math.acos(cosTheta) / D), lon: rand() * 360 });
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const pearson = (xs, ys) => {
  const mx = mean(xs), my = mean(ys);
  let n = 0, a = 0, b = 0;
  for (let i = 0; i < xs.length; i++) { n += (xs[i] - mx) * (ys[i] - my); a += (xs[i] - mx) ** 2; b += (ys[i] - my) ** 2; }
  return n / Math.sqrt(a * b);
};

// ---- registration: WAC vs LOLA under the four axis flips (no SUNLOCK code involved) ----
const regPts = all.filter((p) => p.lat <= -88);
const registration = {};
for (const [fx, fy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
  const xs = [], ys = [];
  for (const p of regPts) {
    const w = wacAt(p.lat, p.lon, fx, fy), l = lolaAt(p.lat, p.lon);
    if (w !== null && l !== null) { xs.push(w); ys.push(l); }
  }
  registration[`x${fx > 0 ? "+" : "-"}y${fy > 0 ? "+" : "-"}`] = +pearson(xs, ys).toFixed(4);
}
const best = Object.entries(registration).sort((a, b) => b[1] - a[1]);
if (best[0][0] !== "x+y+" || best[0][1] - best[1][1] < 0.1) throw new Error(`WAC registration unclear: ${JSON.stringify(registration)}`);
console.log("registration (WAC vs LOLA, r by axis orientation):", registration);

// ---- our illumination over the WAC year, both conventions ----
const start = Date.UTC(2010, 1, 15), end = Date.UTC(2011, 1, 5), stepMs = 3600000;
const nT = Math.floor((end - start) / stepMs);
const sun = new Float64Array(nT * 3);
for (let i = 0; i < nT; i++) {
  const s = skyAt(new Date(start + i * stepMs)).sun;
  sun[i * 3] = s.x; sun[i * 3 + 1] = s.y; sun[i * 3 + 2] = s.z;
}
const dem = loadDem(path.join(ROOT, "data/raw/ldem_80s_80m.img"));
function litShare(prof, lat, lon) {
  const b = siteBasis(lat, lon);
  let lit = 0;
  for (let i = 0; i < nT; i++) {
    const x = sun[i * 3], y = sun[i * 3 + 1], z = sun[i * 3 + 2];
    const el = Math.asin(Math.max(-1, Math.min(1, x * b.up.x + y * b.up.y + z * b.up.z))) / D;
    let az = Math.atan2(x * b.east.x + y * b.east.y + z * b.east.z, x * b.north.x + y * b.north.y + z * b.north.z) / D;
    if (az < 0) az += 360;
    if (el + SUN_R > horizonAt(prof, az)) lit++;
  }
  return lit / nT;
}

const rows = [];
let outside = 0, invalid = 0;
for (const p of all) {
  if (p.lat > -88) { outside++; continue; }
  const ref = wacAt(p.lat, p.lon);
  if (ref === null) { invalid++; continue; }
  const conv = horizonProfile(dem, p.lat, p.lon, "converged");
  const ship = horizonProfile(dem, p.lat, p.lon, "shipped");
  if (!conv || !ship) { invalid++; continue; }
  rows.push({ lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5), ref: +ref.toFixed(4), converged: +litShare(conv.prof, p.lat, p.lon).toFixed(4), shipped: +litShare(ship.prof, p.lat, p.lon).toFixed(4) });
}

// the named sites the pre-registration adds to the sample, where the WAC map covers them
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, "web/public/terrain/sites.json"), "utf8"));
const named = meta.sites.filter((s) => s.current !== false && s.lat <= -88).map((s) => {
  const ref = wacAt(s.lat, s.lon), conv = horizonProfile(dem, s.lat, s.lon, "converged");
  const l = lolaAt(s.lat, s.lon);
  return ref === null || !conv ? { site: s.name, wac: null } : {
    site: s.name, wacPct: +(100 * ref).toFixed(1), oursPct: +(100 * litShare(conv.prof, s.lat, s.lon)).toFixed(1),
    nasaLolaPct18y: l === null ? null : +(100 * l).toFixed(1),
    note: "a single 60 m crest pixel in NASA's LOLA map (40-55% within 120 m around it); WAC's 100 m, photo-registered pixels cannot resolve it, so this point is not counted against either map",
  };
});

const stats = (sub, key) => {
  const d = sub.map((r) => r[key] - r.ref);
  return {
    n: sub.length,
    r: +pearson(sub.map((r) => r[key]), sub.map((r) => r.ref)).toFixed(4),
    rmsePct: +(Math.sqrt(mean(d.map((x) => x * x))) * 100).toFixed(2),
    biasPct: +(mean(d) * 100).toFixed(2),
  };
};
const bands = [[0, 0.2], [0.2, 0.5], [0.5, 0.8], [0.8, 1.01]].map(([lo, hi]) => {
  const sub = rows.filter((r) => r.ref >= lo && r.ref < hi);
  return { band: `${Math.round(lo * 100)}-${Math.round(hi * 100)}%`, n: sub.length, biasPct: sub.length ? +(mean(sub.map((r) => r.converged - r.ref)) * 100).toFixed(2) : null };
});
const above5 = rows.filter((r) => r.ref >= 0.05);
const result = {
  hypothesis: "H3: our illumination reproduces the LROC WAC map over its own year, r >= 0.85 (pre-registered)",
  reference: "WAC_POLE_ILL_TWI_SOUTH_100M v1.3 (LROC, Speyerer & Robinson 2013), 100 m/px, 88-90 S",
  window: { start: "2010-02-15", end: "2011-02-05", stepHours: 1, steps: nT },
  sample: { seed: SEED, drawn: N_POINTS, outsideWacCoverage: outside, invalid, used: rows.length },
  registration: { what: "r between the WAC map and NASA's LOLA AVGVISIB at the sample points, per axis orientation (independent of SUNLOCK)", ...registration },
  converged: stats(rows, "converged"),
  shipped: stats(rows, "shipped"),
  result: stats(rows, "converged").r >= 0.85 ? "pass" : "fail",
  bandsConverged: bands,
  namedSites: named,
  secondary: { what: "sensitivity only, not pre-registered: points with WAC >= 5% (scattered light inflates near-zero WAC values)", converged: stats(above5, "converged") },
  deviations: [
    "Named sites: only current sites inside the WAC map's 88-90 S coverage can be compared; they are listed individually (namedSites) and not pooled into r, since two or three points would not change it and would mix a curated set into a random sample.",
    "Horizon reach: the adopted converged convention uses 150 km (decided after H1, documented in validate-lola.mjs); the shipped convention keeps the pre-registered 64 km.",
  ],
};
fs.writeFileSync(path.join(ROOT, "research/validation/result-wac.json"), JSON.stringify(result, null, 2) + "\n");
fs.writeFileSync(path.join(ROOT, "research/validation/pairs-wac.csv"), "lat,lon,wac,ours_converged,ours_shipped\n" + rows.map((r) => `${r.lat},${r.lon},${r.ref},${r.converged},${r.shipped}`).join("\n") + "\n");
const { bandsConverged, ...summary } = result;
console.log(JSON.stringify(summary, null, 1));
