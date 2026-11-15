/**
 * Choose a landing point for each Artemis III candidate region.
 *
 * Input: the 130 published landing sites of Wueller et al. (2026), JGR Planets,
 *   doi:10.1029/2025JE009434 (research/data/wueller2026-landing-sites.csv, CC BY 4.0).
 *   Those sites already lie inside the authors' HLS-suitable (slope + Sun) areas.
 *
 * For every site we compute, over 18.6 years at hourly steps (one lunar nodal
 * cycle, the same baseline as NASA's LOLA illumination maps):
 *   - sunlight fraction (any part of the solar disc), converged horizon
 *   - the same under three other conventions -> an honest range
 *   - Earth visibility (any part of Earth's disc)
 *   - longest continuous darkness (worst case over 18.6 years)
 *   - slope at the DEM baseline
 *   - NASA's own value at that point (PGDA product 69) as a cross-check
 * and pick, per region, the site our model rates sunniest.
 *
 * Run: npm run sites   (writes web/public/terrain/regions.json)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { skyAt, siteBasis } from "../.build/selene.js";
import { loadDem, horizonProfile, horizonAt, slopeDeg } from "../../scripts/lib/horizon.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const D = Math.PI / 180;
const SUN_R = 0.266;
const EARTH_R = 0.95;
const R_MOON = 1737400;

// Region codes as used by Wueller et al. (2026); names checked against the
// positions of the features they are named after.
const REGIONS = {
  PCB: { name: "Peak near Cabeus B", current: true },
  HW: { name: "Haworth", current: true },
  MMA: { name: "Malapert Massif", current: true },
  MMP: { name: "Mons Mouton Plateau", current: true },
  MMO: { name: "Mons Mouton", current: true },
  NR1: { name: "Nobile Rim 1", current: true },
  NR2: { name: "Nobile Rim 2", current: true },
  dGR2: { name: "de Gerlache Rim 2", current: true },
  SP: { name: "Slater Plain", current: true },
  PNS: { name: "Peak near Shackleton", current: false },
  CR: { name: "Connecting Ridge", current: false },
  CRE: { name: "Connecting Ridge Extension", current: false },
  dGR1: { name: "de Gerlache Rim 1", current: false },
  dGKM: { name: "de Gerlache–Kocher Massif", current: false },
  AR: { name: "Amundsen Rim", current: false },
  FRA: { name: "Faustini Rim A", current: false },
};

// ---------- inputs ----------
const csv = fs.readFileSync(path.join(ROOT, "research/data/wueller2026-landing-sites.csv"), "utf8")
  .split("\n").filter((l) => l && !l.startsWith("#")).slice(1)
  .map((l) => { const [code, site, lat, lon] = l.split(","); return { code, site, lat: +lat, lon: +lon }; });

const dem = loadDem(path.join(ROOT, "data/raw/ldem_80s_80m.img"));

function loadRef(base) {
  const dir = path.join(ROOT, "research/validation/raw");
  const lbl = fs.readFileSync(path.join(dir, `${base}.LBL`), "latin1");
  const num = (k) => Number(lbl.match(new RegExp(`${k}\\s*=\\s*([-+0-9.]+)`))[1]);
  const n = num("LINES");
  const buf = fs.readFileSync(path.join(dir, `${base}.IMG`));
  return { n, scale: num("SCALING_FACTOR"), off: num("LINE_PROJECTION_OFFSET"), mapScale: num("MAP_SCALE"),
    data: new Int16Array(buf.buffer, buf.byteOffset, n * n) };
}
function refAt(p, lat, lon) {
  const r = (2 * R_MOON * Math.tan(((90 - Math.abs(lat)) * D) / 2)) / p.mapScale;
  const x = Math.round(p.off + r * Math.sin(lon * D)), y = Math.round(p.off - r * Math.cos(lon * D));
  if (x < 0 || y < 0 || x >= p.n || y >= p.n) return null;
  return p.data[y * p.n + x] * p.scale;
}
const nasaSun = loadRef("AVGVISIB_85S_060M_201608");
const psr = loadRef("LPSR_85S_060M_201608"); // DN +20000 = permanent shadow, -20000 = not

/**
 * Distance (km) from a point to the nearest permanently shadowed pixel in NASA's
 * LPSR map, searched out to maxKm. null outside the map; Infinity if none in range.
 * Permanently shadowed regions are where water ice can survive.
 */
function nearestPsrKm(lat, lon, maxKm = 30) {
  const r = (2 * R_MOON * Math.tan(((90 - Math.abs(lat)) * D) / 2)) / psr.mapScale;
  const cx = psr.off + r * Math.sin(lon * D), cy = psr.off - r * Math.cos(lon * D);
  if (cx < 0 || cy < 0 || cx >= psr.n || cy >= psr.n) return null;
  const R = Math.ceil((maxKm * 1000) / psr.mapScale);
  let best = Infinity;
  for (let dy = -R; dy <= R; dy++) {
    const y = Math.round(cy + dy);
    if (y < 0 || y >= psr.n) continue;
    for (let dx = -R; dx <= R; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 >= best) continue;
      const x = Math.round(cx + dx);
      if (x < 0 || x >= psr.n) continue;
      if (psr.data[y * psr.n + x] > 0) best = d2;
    }
  }
  return best === Infinity ? Infinity : +((Math.sqrt(best) * psr.mapScale) / 1000).toFixed(2);
}
const HEIGHTS = [0, 2, 10]; // metres above ground: surface, lander deck, mast
const nasaEarth = loadRef("AVGVISIB_85S_060M_201608_EARTH");

// ---------- sky over 18.6 years ----------
const STEP_H = Number(process.argv.includes("--step") ? process.argv[process.argv.indexOf("--step") + 1] : 1);
const start = Date.UTC(2010, 0, 1);
const nSteps = Math.floor((18.6 * 365.25 * 24) / STEP_H);
console.time("sky");
const sky = new Float64Array(nSteps * 6);
for (let i = 0; i < nSteps; i++) {
  const s = skyAt(new Date(start + i * STEP_H * 3600e3));
  // Earth as a vector in lunar radii, so each site can take its own parallax (see lookEarth)
  const k = s.earthDistR;
  sky.set([s.sun.x, s.sun.y, s.sun.z, s.earth.x * k, s.earth.y * k, s.earth.z * k], i * 6);
}
console.timeEnd("sky");

function look(b, vx, vy, vz) {
  const el = Math.asin(Math.max(-1, Math.min(1, vx * b.up.x + vy * b.up.y + vz * b.up.z))) / D;
  let az = Math.atan2(vx * b.east.x + vy * b.east.y + vz * b.east.z, vx * b.north.x + vy * b.north.y + vz * b.north.z) / D;
  if (az < 0) az += 360;
  return [el, az];
}

/** Earth seen from the surface point (topocentric), as JPL Horizons and the app compute it. */
function lookEarth(b, ex, ey, ez) {
  const x = ex - b.up.x, y = ey - b.up.y, z = ez - b.up.z, n = Math.hypot(x, y, z);
  return look(b, x / n, y / n, z / n);
}

function sunPctAt(prof, b) {
  let lit = 0;
  for (let i = 0; i < nSteps; i++) {
    const o = i * 6;
    const [el, az] = look(b, sky[o], sky[o + 1], sky[o + 2]);
    if (el + SUN_R > horizonAt(prof, az)) lit++;
  }
  return +((100 * lit) / nSteps).toFixed(1);
}

function evaluate(s) {
  const conv = horizonProfile(dem, s.lat, s.lon, "converged");
  const ship = horizonProfile(dem, s.lat, s.lon, "shipped");
  if (!conv || !ship) return null;
  const b = siteBasis(s.lat, s.lon);
  let anyC = 0, cenC = 0, anyS = 0, cenS = 0, earth = 0, run = 0, longest = 0, both = 0, eRun = 0, eLongest = 0;
  for (let i = 0; i < nSteps; i++) {
    const o = i * 6;
    const [el, az] = look(b, sky[o], sky[o + 1], sky[o + 2]);
    const hc = horizonAt(conv.prof, az), hs = horizonAt(ship.prof, az);
    const lit = el + SUN_R > hc;
    if (lit) anyC++;
    if (el > hc) cenC++;
    if (el + SUN_R > hs) anyS++;
    if (el > hs) cenS++;
    run = lit ? 0 : run + 1;
    if (run > longest) longest = run;
    const [ee, ea] = lookEarth(b, sky[o + 3], sky[o + 4], sky[o + 5]);
    const inView = ee + EARTH_R > horizonAt(conv.prof, ea);
    if (inView) earth++;
    if (inView && lit) both++;
    eRun = inView ? 0 : eRun + 1;
    if (eRun > eLongest) eLongest = eRun;
  }
  const pct = (k) => +((100 * k) / nSteps).toFixed(1);
  const all = [pct(anyC), pct(cenC), pct(anyS), pct(cenS)];
  const ns = refAt(nasaSun, s.lat, s.lon), ne = refAt(nasaEarth, s.lat, s.lon);
  return {
    site: s.site, lat: s.lat, lon: s.lon,
    elevationM: Math.round(conv.elevationM),
    slopeDeg: +slopeDeg(dem, s.lat, s.lon).toFixed(1),
    sunPct: pct(anyC),
    sunRangePct: [Math.min(...all), Math.max(...all)],
    earthPct: pct(earth),
    longestNightH: +(longest * STEP_H).toFixed(0),
    longestBlackoutH: +(eLongest * STEP_H).toFixed(0),
    sunAndEarthPct: pct(both),
    poleKm: +(((90 - Math.abs(s.lat)) * D) * R_MOON / 1000).toFixed(1),
    psrKm: (() => { const v = nearestPsrKm(s.lat, s.lon); return v === Infinity ? ">30" : v; })(),
    nasaSunPct: ns === null ? null : +(ns * 100).toFixed(1),
    nasaEarthPct: ne === null ? null : +(ne * 100).toFixed(1),
  };
}

// ---------- run ----------
console.time("sites");
const byRegion = {};
let done = 0;
for (const s of csv) {
  const r = evaluate(s);
  if (r) (byRegion[s.code] ??= []).push(r);
  process.stderr.write(`\r${++done}/${csv.length}`);
}
console.timeEnd("sites");

// Selection is validation-aware: picking the maximum of a noisy estimate favours
// points where the model is optimistic, so a site only qualifies when our value
// agrees with NASA's map within AGREE_PP (or lies outside that map's 85-90°S coverage).
const AGREE_PP = 5;
const regions = Object.entries(REGIONS).map(([code, meta]) => {
  const sites = (byRegion[code] ?? []).map((s) => ({
    ...s,
    nasaDiffPp: s.nasaSunPct === null ? null : +(s.sunPct - s.nasaSunPct).toFixed(1),
    agrees: s.nasaSunPct === null ? null : Math.abs(s.sunPct - s.nasaSunPct) <= AGREE_PP,
  })).sort((a, b) => b.sunPct - a.sunPct || b.earthPct - a.earthPct);
  const best = sites.find((s) => s.agrees !== false) ?? sites[0];
  return { code, ...meta, nSites: sites.length, nAgree: sites.filter((s) => s.agrees).length, best, sites };
});

fs.writeFileSync(path.join(ROOT, "web/public/terrain/regions.json"), JSON.stringify({
  method: {
    baseline: "18.6 years from 2010-01-01", stepHours: STEP_H,
    horizon: "converged: bilinear LOLA LDEM_80S_80M, 40 m steps, 150 km reach",
    sun: "any part of the solar disc above the local horizon (same definition as NASA PGDA AVGVISIB)",
    range: "min-max over {converged, shipped} x {any part, disc centre}",
    slope: "Horn 3x3 on 80 m posts (240 m baseline)",
    iceAccess: "distance to the nearest permanently shadowed pixel in NASA LPSR_85S_060M_201608, searched to 30 km",
    heights: "horizons re-marched with the observer raised 2 m and 10 m above the surface (cf. Gläser et al. 2014)",
    selection: `per region, the published site with the highest modelled sunlight among those agreeing with NASA's map within ${AGREE_PP} percentage points (sites north of 85°S lie outside that map and are taken on our model alone)`,
  },
  sources: {
    sites: "Wueller et al. (2026) JGR Planets doi:10.1029/2025JE009434; data doi:10.5281/zenodo.17084058 (CC BY 4.0)",
    regions: "NASA Artemis III candidate regions, Oct 2024 (NTRS 20250011660)",
    crossCheck: "NASA PGDA product 69, AVGVISIB_85S_060M_201608 (+ _EARTH)",
  },
  regions,
}, null, 0));

// ---------- validation summary for the app ----------
{
  const pairs = regions.flatMap((r) => r.sites).filter((s) => s.nasaSunPct !== null);
  const xs = pairs.map((s) => s.sunPct), ys = pairs.map((s) => s.nasaSunPct);
  const mean = (a) => a.reduce((p, q) => p + q, 0) / a.length;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); dx += (x - mx) ** 2; dy += (ys[i] - my) ** 2; });
  const diffs = xs.map((x, i) => x - ys[i]);
  const mapWide = JSON.parse(fs.readFileSync(path.join(ROOT, "research/validation/result-converged.json"), "utf8"));
  fs.writeFileSync(path.join(ROOT, "web/public/terrain/validation.json"), JSON.stringify({
    reference: "NASA PGDA product 69, AVGVISIB_85S_060M_201608 (LOLA team, 18.6-year average, 60 m/px)",
    mapWide: {
      what: "random points 85-90°S, fixed seed",
      n: mapWide.points.paired, stepHours: mapWide.stepHours,
      r: mapWide.h1.r, rmsePp: mapWide.h1.rmsePct, biasPp: mapWide.h1.biasPct,
      shadow: mapWide.h2 ? { n: mapWide.h2.n, iou: mapWide.h2.iou, tp: mapWide.h2.tp, fp: mapWide.h2.fp, fn: mapWide.h2.fn } : null,
      earth: mapWide.h4 ? { n: mapWide.h4.n, r: mapWide.h4.r, rmsePp: mapWide.h4.rmsePct, biasPp: mapWide.h4.biasPct } : null,
    },
    preregistered: {
      H1: { test: "sunlight r >= 0.90 and |bias| <= 5 pp", result: mapWide.h1.r >= 0.9 && Math.abs(mapWide.h1.biasPct) <= 5 ? "pass" : "fail" },
      H2: { test: "permanent-shadow IoU >= 0.80", result: mapWide.h2 ? (mapWide.h2.iou >= 0.8 ? "pass" : "fail") : "not run" },
      H3: (() => {
        const f = path.join(ROOT, "research/validation/result-wac.json");
        if (!fs.existsSync(f)) return { test: "LROC WAC r >= 0.85", result: "not run" };
        const w = JSON.parse(fs.readFileSync(f, "utf8"));
        return { test: "LROC WAC r >= 0.85", result: w.result, n: w.converged.n, r: w.converged.r, rmsePp: w.converged.rmsePct, biasPp: w.converged.biasPct };
      })(),
      H4: { test: "Earth visibility r >= 0.90", result: mapWide.h4 ? (mapWide.h4.r >= 0.9 ? "pass" : "fail") : "not run" },
    },
    landingSites: {
      what: "published Artemis III landing sites (Wueller et al. 2026) inside the map",
      n: pairs.length, stepHours: STEP_H,
      r: +(num / Math.sqrt(dx * dy)).toFixed(3),
      biasPp: +mean(diffs).toFixed(1),
      rmsePp: +Math.sqrt(mean(diffs.map((d) => d * d))).toFixed(1),
      within5pp: pairs.filter((s) => Math.abs(s.sunPct - s.nasaSunPct) <= 5).length,
    },
    earthAtLandingSites: (() => {
      const ep = regions.flatMap((r) => r.sites).filter((s) => s.nasaEarthPct !== null);
      const ex = ep.map((s) => s.earthPct), ey = ep.map((s) => s.nasaEarthPct);
      const emx = mean(ex), emy = mean(ey);
      let en = 0, edx = 0, edy = 0;
      ex.forEach((x, i) => { en += (x - emx) * (ey[i] - emy); edx += (x - emx) ** 2; edy += (ey[i] - emy) ** 2; });
      const ed = ex.map((x, i) => x - ey[i]);
      return {
        what: "Earth visibility at the same sites vs AVGVISIB_85S_060M_201608_EARTH (pre-registered H4: r >= 0.90)",
        n: ep.length, r: +(en / Math.sqrt(edx * edy)).toFixed(3),
        biasPp: +mean(ed).toFixed(1), rmsePp: +Math.sqrt(mean(ed.map((d) => d * d))).toFixed(1),
      };
    })(),
  }, null, 1));
  console.log(`validation: ${pairs.length} landing sites, r=${(num / Math.sqrt(dx * dy)).toFixed(3)}`);
}

// ---------- app sites: one per region, at the chosen site, converged horizon ----------
const sitesPath = path.join(ROOT, "web/public/terrain/sites.json");
const meta = JSON.parse(fs.readFileSync(sitesPath, "utf8"));
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** Plain-language note on which published spot is shown, and why. */
function blurbFor(r) {
  const lead = r.current
    ? "One of NASA's nine candidate landing areas for Artemis III."
    : "On NASA's 2022 shortlist but dropped in 2024; kept for comparison.";
  const sunniest = Math.max(...r.sites.map((s) => s.sunPct));
  const why =
    r.best.sunPct >= sunniest
      ? `Shown at the sunniest of the ${r.nSites} landing spots scientists have proposed here.`
      : `Shown at the sunniest of the ${r.nSites} proposed landing spots where our model and NASA's own map agree; sunnier-looking spots here disagree with NASA's map, so we do not rely on them.`;
  return `${lead} ${why}`;
}

meta.sites = regions.filter((r) => r.best).map((r) => {
  const b = r.best;
  const hz = horizonProfile(dem, b.lat, b.lon, "converged");
  const basis = siteBasis(b.lat, b.lon);
  const byHeight = HEIGHTS.map((h) => {
    const p = h === 0 ? hz : horizonProfile(dem, b.lat, b.lon, "converged", 360, h);
    return { heightM: h, sunPct: h === 0 ? b.sunPct : sunPctAt(p.prof, basis), horizonDeg: Array.from(p.prof, (v) => +v.toFixed(2)) };
  });
  return {
    id: slug(r.name),
    name: r.name,
    region: r.code,
    current: r.current,
    publishedSite: b.site,
    lat: b.lat,
    lon: b.lon < 0 ? +(b.lon + 360).toFixed(5) : b.lon,
    elevationM: b.elevationM,
    slopeDeg: b.slopeDeg,
    longRun: {
      sunPct: b.sunPct, sunRangePct: b.sunRangePct, earthPct: b.earthPct,
      longestNightH: b.longestNightH, nasaSunPct: b.nasaSunPct, nasaEarthPct: b.nasaEarthPct,
      longestBlackoutH: b.longestBlackoutH, sunAndEarthPct: b.sunAndEarthPct, poleKm: b.poleKm, psrKm: b.psrKm,
      nasaDiffPp: b.nasaDiffPp, agrees: b.agrees, nSites: r.nSites, nAgree: r.nAgree,
    },
    blurb: blurbFor(r),
    horizonDeg: Array.from(hz.prof, (v) => +v.toFixed(2)),
    heights: byHeight.map(({ heightM, sunPct, horizonDeg }) => ({ heightM, sunPct, horizonDeg })),
  };
});
meta.sitesSource = "web/scripts/select-sites.mjs (npm run sites)";
fs.writeFileSync(sitesPath, JSON.stringify(meta));
console.log(`wrote ${meta.sites.length} sites to sites.json`);

console.log("\nregion                       best site    sun%  range       earth%  night(d)  slope  NASA sun%");
for (const r of regions) {
  const b = r.best;
  if (!b) { console.log(r.name, "no data"); continue; }
  console.log(`${(r.current ? "* " : "  ") + r.name.padEnd(28)} ${b.site.padEnd(11)} ${String(b.sunPct).padStart(5)}  ${b.sunRangePct.join("–").padEnd(10)}  ${String(b.earthPct).padStart(5)}  ${(b.longestNightH / 24).toFixed(1).padStart(7)}  ${String(b.slopeDeg).padStart(5)}  ${b.nasaSunPct}`);
}
