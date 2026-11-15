/**
 * Map-wide validation against NASA's published illumination products.
 *
 * Reference: PGDA product 69 (LOLA team, Mazarico et al. 2011)
 *   AVGVISIB_85S_060M_201608 — "percentage of timesteps where each pixel was
 *   sunlit (by any fraction of the solar disc)", 18.6 yr, 60 m/px.
 *   LPSR_85S_060M_201608      — permanent shadow.
 *   AVGVISIB_..._EARTH        — same, for Earth visibility.
 *
 * Our side uses the shipped ephemeris and frame (`web/src/lib/selene.ts`),
 * and a horizon ray-marched from LDEM_80S_80M.
 *
 * Pre-registration: research/PREREGISTRATION.md (committed before this ran).
 *
 * Run: node scripts/validate-lola.mjs --points 2000 --step 1 --convention converged
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { skyAt, siteBasis } from "../.build/selene.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const RAW = path.resolve(ROOT, "../data/raw");
const REF = path.resolve(ROOT, "../research/validation/raw");
const OUT = path.resolve(ROOT, "../research/validation");

const R_MOON = 1737400;
const D = Math.PI / 180;
const SUN_R = 0.266;
const EARTH_R = 0.95;

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const N_POINTS = Number(arg("points", "2000"));
const STEP_H = Number(arg("step", "1"));
const CONV = arg("convention", "converged"); // shipped | converged
const SEED = Number(arg("seed", "20261511"));

// ---------- deterministic PRNG (fixed by pre-registration) ----------
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- reference products ----------
function readLabel(file) {
  const t = fs.readFileSync(file, "latin1");
  const num = (k) => {
    const m = t.match(new RegExp(`${k}\\s*=\\s*([-+0-9.]+)`));
    return m ? Number(m[1]) : null;
  };
  return {
    lines: num("LINES"),
    samples: num("LINE_SAMPLES"),
    scale: num("SCALING_FACTOR"),
    offset: num("OFFSET") ?? 0,
    projOffset: num("LINE_PROJECTION_OFFSET"),
    mapScale: num("MAP_SCALE"),
  };
}

function loadProduct(base) {
  const lbl = readLabel(path.join(REF, `${base}.LBL`));
  const img = path.join(REF, `${base}.IMG`);
  if (!fs.existsSync(img)) throw new Error(`missing ${img}`);
  const buf = fs.readFileSync(img);
  const expected = lbl.lines * lbl.samples * 2;
  if (buf.length !== expected) throw new Error(`${base}: ${buf.length} != ${expected}`);
  return { ...lbl, data: new Int16Array(buf.buffer, buf.byteOffset, lbl.lines * lbl.samples) };
}

/** lat/lon -> fractional pixel for a polar stereographic product centred on the south pole */
function toPixel(lat, lon, prod) {
  const colat = (90 - Math.abs(lat)) * D;
  const r = (2 * R_MOON * Math.tan(colat / 2)) / prod.mapScale;
  const a = lon * D;
  return {
    x: prod.projOffset + r * Math.sin(a),
    y: prod.projOffset - r * Math.cos(a),
    radiusPx: r,
  };
}

function sampleRef(prod, lat, lon) {
  const p = toPixel(lat, lon, prod);
  if (p.x < 0 || p.y < 0 || p.x >= prod.samples - 1 || p.y >= prod.lines - 1) return null;
  const xi = Math.round(p.x), yi = Math.round(p.y);
  const dn = prod.data[yi * prod.samples + xi];
  return dn * prod.scale + prod.offset;
}

// ---------- terrain ----------
function loadDem(file, N) {
  const buf = fs.readFileSync(file);
  if (buf.length !== N * N * 2) throw new Error(`${file}: unexpected size ${buf.length}`);
  return new Int16Array(buf.buffer, buf.byteOffset, N * N);
}

const DEM_N = 7600, DEM_PIX = 80;
const dem = loadDem(path.join(RAW, "ldem_80s_80m.img"), DEM_N);

const nearest = (x, y) => {
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= DEM_N || yi >= DEM_N) return null;
  return dem[yi * DEM_N + xi] * 0.5;
};
const bilinear = (x, y) => {
  if (x < 0 || y < 0 || x >= DEM_N - 1 || y >= DEM_N - 1) return null;
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const p00 = dem[yi * DEM_N + xi] * 0.5;
  const p10 = dem[yi * DEM_N + xi + 1] * 0.5;
  const p01 = dem[(yi + 1) * DEM_N + xi] * 0.5;
  const p11 = dem[(yi + 1) * DEM_N + xi + 1] * 0.5;
  return p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy;
};

function horizonProfile(lat, lon, convention) {
  const colat = (90 - Math.abs(lat)) * D;
  const rr = (2 * R_MOON * Math.tan(colat / 2)) / DEM_PIX;
  const a = lon * D;
  const x0 = (DEM_N - 1) / 2 + rr * Math.sin(a);
  const y0 = (DEM_N - 1) / 2 - rr * Math.cos(a);

  const g = convention === "shipped" ? nearest : bilinear;
  const stepM = convention === "shipped" ? 160 : 40;
  const stepPx = stepM / DEM_PIX;
  const e0 = g(x0, y0);
  if (e0 === null) return null;

  const maxKm = 150; // pre-registration: reach extended so distant massifs are included
  const nSteps = Math.floor((maxKm * 1000) / stepM);
  const prof = new Float32Array(360);
  for (let az = 0; az < 360; az++) {
    // geographic azimuth -> image direction: north (az 0) is (sin lon, -cos lon), east is (cos lon, sin lon)
    const ang = (az + lon) * D;
    // negated: raster axes run opposite to the standard stereographic convention
    const dx = Math.sin(ang), dy = -Math.cos(ang);
    let best = -1e9;
    for (let k = 1; k <= nSteps; k++) {
      const h = g(x0 + dx * k * stepPx, y0 + dy * k * stepPx);
      if (h === null) break;
      const d = k * stepM;
      const s = (h - e0 - (d * d) / (2 * R_MOON)) / d;
      if (s > best) best = s;
    }
    prof[az] = best === -1e9 ? 0 : Math.atan(best) / D;
  }
  return { prof, x0, y0 };
}

const horizonAt = (prof, az) => {
  const a = ((az % 360) + 360) % 360;
  const i = Math.floor(a) % 360;
  const j = (i + 1) % 360;
  const t = a - Math.floor(a);
  return prof[i] * (1 - t) + prof[j] * t;
};

// ---------- sample points ----------
const rand = mulberry32(SEED);
const thetaMax = 5 * D; // 85S..90S
const points = [];
while (points.length < N_POINTS) {
  const cosTheta = 1 - rand() * (1 - Math.cos(thetaMax));
  const theta = Math.acos(cosTheta);
  const lat = -(90 - theta / D);
  const lon = rand() * 360;
  points.push({ lat, lon });
}

// ---------- integration ----------
const YEARS = 18.6;
const start = Date.UTC(2010, 0, 1);
const stepMs = STEP_H * 3600 * 1000;
const nSteps = Math.floor((YEARS * 365.25 * 86400000) / stepMs);
console.log(`points ${points.length} · step ${STEP_H} h · ${nSteps} timesteps · convention ${CONV}`);

console.time("skies");
const skies = new Float32Array(nSteps * 6);
for (let i = 0; i < nSteps; i++) {
  const s = skyAt(new Date(start + i * stepMs));
  skies[i * 6 + 0] = s.sun.x; skies[i * 6 + 1] = s.sun.y; skies[i * 6 + 2] = s.sun.z;
  // Earth stored as a vector in lunar radii, so each point can take its own parallax
  skies[i * 6 + 3] = s.earth.x * s.earthDistR; skies[i * 6 + 4] = s.earth.y * s.earthDistR; skies[i * 6 + 5] = s.earth.z * s.earthDistR;
}
console.timeEnd("skies");

const rows = [];
let dropped = 0;
let done = 0;
console.time("points");
for (const pt of points) {
  const hz = horizonProfile(pt.lat, pt.lon, CONV);
  if (!hz) { dropped++; continue; }
  const b = siteBasis(pt.lat, pt.lon);

  let litAny = 0, litCentre = 0, earthAny = 0;
  for (let i = 0; i < nSteps; i++) {
    const sx = skies[i * 6], sy = skies[i * 6 + 1], sz = skies[i * 6 + 2];
    const sinEl = sx * b.up.x + sy * b.up.y + sz * b.up.z;
    const el = Math.asin(Math.max(-1, Math.min(1, sinEl))) / D;
    let az = Math.atan2(
      sx * b.east.x + sy * b.east.y + sz * b.east.z,
      sx * b.north.x + sy * b.north.y + sz * b.north.z
    ) / D;
    if (az < 0) az += 360;
    const h = horizonAt(hz.prof, az);
    if (el > h) litCentre++;
    if (el + SUN_R > h) litAny++;
    // H4: any part of Earth's disc above the local horizon
    // topocentric: seen from the surface point, not the Moon's centre
    let ex = skies[i * 6 + 3] - b.up.x, ey = skies[i * 6 + 4] - b.up.y, ez = skies[i * 6 + 5] - b.up.z;
    const en = Math.hypot(ex, ey, ez); ex /= en; ey /= en; ez /= en;
    const eEl = Math.asin(Math.max(-1, Math.min(1, ex * b.up.x + ey * b.up.y + ez * b.up.z))) / D;
    let eAz = Math.atan2(ex * b.east.x + ey * b.east.y + ez * b.east.z, ex * b.north.x + ey * b.north.y + ez * b.north.z) / D;
    if (eAz < 0) eAz += 360;
    if (eEl + EARTH_R > horizonAt(hz.prof, eAz)) earthAny++;
  }
  rows.push({
    lat: +pt.lat.toFixed(4),
    lon: +pt.lon.toFixed(4),
    oursAny: +(litAny / nSteps).toFixed(5),
    oursCentre: +(litCentre / nSteps).toFixed(5),
    oursEarth: +(earthAny / nSteps).toFixed(5),
  });
  if (++done % 100 === 0) process.stderr.write(`\r${done}`);
}
console.timeEnd("points");

// ---------- compare ----------
const avgvis = loadProduct("AVGVISIB_85S_060M_201608");
const pair = [];
for (const r of rows) {
  const ref = sampleRef(avgvis, r.lat, r.lon);
  if (ref === null) { dropped++; continue; }
  if (ref <= 0 && r.oursAny <= 0.001) continue; // both permanent shadow; excluded from r
  pair.push({ ...r, ref });
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const pearson = (xs, ys) => {
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return num / Math.sqrt(dx * dy);
};

const ours = pair.map((p) => p.oursAny);
const refs = pair.map((p) => p.ref);
const diffs = pair.map((p) => p.oursAny - p.ref);

const bands = [
  [0, 0.2], [0.2, 0.5], [0.5, 0.8], [0.8, 1.01],
].map(([lo, hi]) => {
  const sub = pair.filter((p) => p.ref >= lo && p.ref < hi);
  return {
    band: `${Math.round(lo * 100)}-${Math.round(hi * 100)}%`,
    n: sub.length,
    bias: sub.length ? +(mean(sub.map((p) => p.oursAny - p.ref)) * 100).toFixed(2) : null,
  };
});

// ---------- H2: permanent shadow (all points, not just the paired set) ----------
const lpsr = loadProduct("LPSR_85S_060M_201608"); // DN +20000 = permanent shadow
let tp = 0, fp = 0, fn = 0, tn = 0, h2n = 0;
for (const r of rows) {
  const v = sampleRef(lpsr, r.lat, r.lon);
  if (v === null) continue;
  h2n++;
  const refPsr = v > 0;
  const ourPsr = r.oursAny === 0; // never touched by any part of the Sun in 18.6 years
  if (refPsr && ourPsr) tp++; else if (!refPsr && ourPsr) fp++; else if (refPsr && !ourPsr) fn++; else tn++;
}
const h2 = { n: h2n, tp, fp, fn, tn, iou: +(tp / Math.max(1, tp + fp + fn)).toFixed(3) };

// ---------- H4: Earth visibility on the same random points ----------
const avgEarth = loadProduct("AVGVISIB_85S_060M_201608_EARTH");
const epair = [];
for (const r of rows) {
  const ref = sampleRef(avgEarth, r.lat, r.lon);
  if (ref === null) continue;
  if (ref <= 0 && r.oursEarth <= 0.001) continue; // both never see Earth; excluded from r, as for H1
  epair.push({ ours: r.oursEarth, ref });
}
const ed = epair.map((p) => p.ours - p.ref);
const h4 = {
  n: epair.length,
  r: +pearson(epair.map((p) => p.ours), epair.map((p) => p.ref)).toFixed(4),
  rmsePct: +(Math.sqrt(mean(ed.map((d) => d * d))) * 100).toFixed(2),
  biasPct: +(mean(ed) * 100).toFixed(2),
};

const pct = (arr, q) => {
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.floor(q * (a.length - 1))];
};

const result = {
  generated: new Date().toISOString(),
  convention: CONV,
  stepHours: STEP_H,
  years: YEARS,
  start: new Date(start).toISOString(),
  points: { requested: N_POINTS, used: rows.length, paired: pair.length, dropped },
  h1: {
    r: +pearson(ours, refs).toFixed(4),
    rmsePct: +(Math.sqrt(mean(diffs.map((d) => d * d))) * 100).toFixed(2),
    biasPct: +(mean(diffs) * 100).toFixed(2),
    rCentre: +pearson(pair.map((p) => p.oursCentre), refs).toFixed(4),
  },
  bands,
  h2,
  h4,
  distributions: {
    ours: [0.05, 0.5, 0.95].map((q) => +pct(ours, q).toFixed(3)),
    ref: [0.05, 0.5, 0.95].map((q) => +pct(refs, q).toFixed(3)),
  },
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `pairs-${CONV}.csv`), "lat,lon,ours_any,ours_centre,ref\n" + pair.map((p) => `${p.lat},${p.lon},${p.oursAny},${p.oursCentre},${p.ref}`).join("\n"));
fs.writeFileSync(path.join(OUT, `result-${CONV}.json`), JSON.stringify(result, null, 2));

// scatter SVG
const W = 520, Hh = 420, pad = 44;
const sx = (v) => pad + v * (W - 2 * pad);
const sy = (v) => Hh - pad - v * (Hh - 2 * pad);
const dots = pair.map((p) => `<circle cx="${sx(p.ref).toFixed(1)}" cy="${sy(p.oursAny).toFixed(1)}" r="1.1" fill="#7aa2ff" opacity="0.45"/>`).join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}">
<rect width="100%" height="100%" fill="#05070d"/>
<line x1="${sx(0)}" y1="${sy(0)}" x2="${sx(1)}" y2="${sy(1)}" stroke="#f2b45c" stroke-dasharray="4 3" stroke-width="1"/>
${dots}
<text x="${W / 2}" y="20" fill="#e8eef8" font-family="sans-serif" font-size="12" text-anchor="middle">SUNLOCK vs LOLA AVGVISIB (${CONV}, r=${result.h1.r})</text>
<text x="${W / 2}" y="${Hh - 10}" fill="#8fa2bd" font-family="sans-serif" font-size="10" text-anchor="middle">LOLA reference illumination</text>
<text x="14" y="${Hh / 2}" fill="#8fa2bd" font-family="sans-serif" font-size="10" transform="rotate(-90 14 ${Hh / 2})" text-anchor="middle">SUNLOCK</text>
</svg>`;
fs.writeFileSync(path.join(OUT, `scatter-${CONV}.svg`), svg);

console.log(JSON.stringify(result, null, 2));
