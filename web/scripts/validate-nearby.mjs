/**
 * Independent check of the stress card's nearby positions and its terrain case.
 *
 * Nearby positions: 1 and 2 km from each current Artemis III site, 8 directions. This script
 * first tested a cheap ADJUSTED skyline (A: the named site's 80 m skyline plus the change our
 * ~600 m grid sees). It failed (see the result), so the app now ships (B) for every position
 * (web/scripts/build-nearby.mjs). Each of the 144 points gets
 *   (B) a full LOLA LDEM_80S_80M skyline ray-marched at the point itself (converged convention,
 *       the one that scores r = 0.995 map-wide), and
 *   (C) NASA's own 18.6-year sunlight at that 60 m pixel (AVGVISIB_85S_060M_201608), which is
 *       independent of all our code.
 * We compare 18.6-year sunlight (A, B vs C), sunrise/sunset transitions in 2027 (A vs B), and the
 * decision the card makes (does a 14-day landing pass all 8 stress cases?) under A and under B.
 *
 * The terrain case (skyline raised until sunlight falls by our RMS error, 6.8 points) is checked
 * against the 105 published landing sites: how often is our sunlight above NASA's by more than
 * the case allows, i.e. how often would the real error be larger than the case tests?
 *
 * Run: npm run validate:nearby   (writes research/validation/nearby.json)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDem, horizonProfile } from "../../scripts/lib/horizon.mjs";
import { skyAt, siteBasis } from "../.build/selene.js";
import { buildSkies, siteSeries, raisedTerrain } from "../.build/analysis.js";
import { stressTest, allCasesPass, simulateMission } from "../.build/power.js";
import { offsetPoint, nearbyHorizon } from "../.build/terrain.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const D = Math.PI / 180, R_MOON = 1737400, SUN_R = 0.266;
const read = (p) => fs.readFileSync(path.join(ROOT, p));

const meta = JSON.parse(read("web/public/terrain/sites.json"));
const eb = read("web/public/terrain/elevgrid.bin");
const grid = { size: meta.elevation.size, pixM: meta.elevation.pixM, data: new Int16Array(eb.buffer, eb.byteOffset, eb.length / 2) };
const dem = loadDem(path.join(ROOT, "data/raw/ldem_80s_80m.img"));
const sites = meta.sites.filter((s) => s.current !== false);

// NASA reference
const lbl = read("research/validation/raw/AVGVISIB_85S_060M_201608.LBL").toString("latin1");
const num = (k) => Number(lbl.match(new RegExp(`${k}\\s*=\\s*([-+0-9.]+)`))[1]);
const ref = { n: num("LINES"), scale: num("SCALING_FACTOR"), off: num("LINE_PROJECTION_OFFSET"), mapScale: num("MAP_SCALE") };
const rb = read("research/validation/raw/AVGVISIB_85S_060M_201608.IMG");
ref.data = new Int16Array(rb.buffer, rb.byteOffset, ref.n * ref.n);
const nasaSun = (lat, lon) => {
  if (lat > -85.02) return null; // NASA's 60 m product covers 85-90 S only
  const r = (2 * R_MOON * Math.tan(((90 - Math.abs(lat)) * D) / 2)) / ref.mapScale;
  const x = Math.round(ref.off + r * Math.sin(lon * D)), y = Math.round(ref.off - r * Math.cos(lon * D));
  return 100 * ref.data[y * ref.n + x] * ref.scale;
};

// 18.6-year sunlight (2-hour steps), any part of the disc above the skyline
const LONG_STEP_H = 2;
const longN = Math.floor((18.6 * 365.25 * 24) / LONG_STEP_H);
const sunVec = new Float64Array(longN * 3);
for (let i = 0; i < longN; i++) {
  const s = skyAt(new Date(Date.UTC(2010, 0, 1) + i * LONG_STEP_H * 3600000)).sun;
  sunVec[i * 3] = s.x; sunVec[i * 3 + 1] = s.y; sunVec[i * 3 + 2] = s.z;
}
const at = (prof, az) => { const a = ((az % 360) + 360) % 360, i = Math.floor(a) % 360, t = a - Math.floor(a); return prof[i] * (1 - t) + prof[(i + 1) % 360] * t; };
function longRunSun(prof, lat, lon) {
  const b = siteBasis(lat, lon);
  let lit = 0;
  for (let i = 0; i < longN; i++) {
    const x = sunVec[i * 3], y = sunVec[i * 3 + 1], z = sunVec[i * 3 + 2];
    const el = Math.asin(Math.max(-1, Math.min(1, x * b.up.x + y * b.up.y + z * b.up.z))) / D;
    let az = Math.atan2(x * b.east.x + y * b.east.y + z * b.east.z, x * b.north.x + y * b.north.y + z * b.north.z) / D;
    if (az < 0) az += 360;
    if (el + SUN_R > at(prof, az)) lit++;
  }
  return (100 * lit) / longN;
}

// 2027 at the app's 30-minute step, for transitions and decisions
const STEP = 30, YEAR_N = 365 * 48 + 1, DAYS = 14, steps = DAYS * 48;
const skies = buildSkies(new Date(Date.UTC(2027, 0, 1)), 365 + 34, STEP);
const lander = { loadW: 100, arrayM2: 4, batteryWh: 10000, dod: 0.8, heaterW: 0 };
const LANDINGS = Array.from({ length: Math.floor(365 / 3) }, (_, k) => k * 3 * 48);
const transitions = (ser) => { const t = []; for (let i = 1; i < YEAR_N; i++) if (ser[i].lit !== ser[i - 1].lit) t.push({ i, up: ser[i].lit }); return t; };

const rows = [];
console.time("points");
for (const site of sites) {
  for (const km of [1, 2]) {
    for (let k = 0; k < 8; k++) {
      const p = offsetPoint(site.lat, site.lon, k * 45, km * 1000);
      const lat = Number(p.lat.toFixed(5)), lon = Number(p.lon.toFixed(5));
      p.lat = lat; p.lon = lon; // the coordinates the app ships
      const adj = nearbyHorizon(grid, site, p.lat, p.lon);
      const det = horizonProfile(dem, p.lat, p.lon, "converged");
      if (!adj || !det) continue;
      const A = { ...site, ...p, horizonDeg: adj.horizon }, B = { ...site, ...p, horizonDeg: Array.from(det.prof) };
      const serA = siteSeries(A, skies), serB = siteSeries(B, skies);
      // lit/unlit agreement and transition timing, 2027
      let agree = 0;
      for (let i = 0; i < YEAR_N; i++) if (serA[i].lit === serB[i].lit) agree++;
      const tA = transitions(serA), tB = transitions(serB);
      const offsets = tB.map((e) => {
        let best = Infinity;
        for (const f of tA) if (f.up === e.up) best = Math.min(best, Math.abs(f.i - e.i));
        return best * STEP;
      });
      // decisions: nominal survival and pass-all-8, each terrain case calibrated on its own skyline
      const tcA = { samples: raisedTerrain(A, skies, YEAR_N, 6.8).samples, label: "t" };
      const tcB = { samples: raisedTerrain(B, skies, YEAR_N, 6.8).samples, label: "t" };
      const dec = LANDINGS.map((l) => ({
        nomA: simulateMission(serA, l, steps, STEP, "tracking", lander, {}, false).survives,
        nomB: simulateMission(serB, l, steps, STEP, "tracking", lander, {}, false).survives,
        allA: allCasesPass(stressTest(serA, l, steps, STEP, "tracking", lander, {}, tcA)),
        allB: allCasesPass(stressTest(serB, l, steps, STEP, "tracking", lander, {}, tcB)),
      }));
      rows.push({
        site: site.id, km, az: k * 45, lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5),
        sunA: +longRunSun(adj.horizon, p.lat, p.lon).toFixed(2),
        sunB: +longRunSun(det.prof, p.lat, p.lon).toFixed(2),
        sunNasa: nasaSun(p.lat, p.lon) === null ? null : +nasaSun(p.lat, p.lon).toFixed(2),
        litAgreePct: +((100 * agree) / YEAR_N).toFixed(2),
        transitionsB: tB.length, transitionsA: tA.length,
        medianShiftMin: offsets.length ? offsets.sort((a, b) => a - b)[Math.floor(offsets.length / 2)] : null,
        dec,
      });
    }
  }
  process.stderr.write(`${site.id} `);
}
console.timeEnd("points");

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const rms = (a) => Math.sqrt(mean(a.map((x) => x * x)));
const corr = (x, y) => { const mx = mean(x), my = mean(y); let n = 0, a = 0, b = 0; x.forEach((v, i) => { n += (v - mx) * (y[i] - my); a += (v - mx) ** 2; b += (y[i] - my) ** 2; }); return n / Math.sqrt(a * b); };
const inNasa = rows.filter((r) => r.sunNasa !== null);
const dA = inNasa.map((r) => r.sunA - r.sunNasa), dB = inNasa.map((r) => r.sunB - r.sunNasa), dAB = rows.map((r) => r.sunA - r.sunB);
const all = rows.flatMap((r) => r.dec);
const count = (f) => all.filter(f).length;
const offeredA = count((d) => d.allA), offeredBoth = count((d) => d.allA && d.allB);

// terrain case vs the real error at the 105 published sites
const regions = JSON.parse(read("web/public/terrain/regions.json"));
const pub = (regions.regions ?? regions).flatMap((r) => r.sites ?? []).filter((s) => s.nasaSunPct != null && s.sunPct != null);
const over = pub.map((s) => s.sunPct - s.nasaSunPct);

const result = {
  what: "nearby positions (1 and 2 km, 8 directions) around the 9 current Artemis III sites",
  n: rows.length,
  sunlight18y: {
    note: "percentage points; A = adjusted skyline (rejected), B = full 80 m skyline at the point (what the app uses), NASA = AVGVISIB_85S_060M_201608 (points inside 85-90 S only)",
    nNasa: inNasa.length,
    A_vs_NASA: { r: +corr(inNasa.map((r) => r.sunA), inNasa.map((r) => r.sunNasa)).toFixed(3), biasPp: +mean(dA).toFixed(2), rmsePp: +rms(dA).toFixed(2) },
    B_vs_NASA: { r: +corr(inNasa.map((r) => r.sunB), inNasa.map((r) => r.sunNasa)).toFixed(3), biasPp: +mean(dB).toFixed(2), rmsePp: +rms(dB).toFixed(2), within5pp: dB.filter((d) => Math.abs(d) <= 5).length, oursHigherByMoreThanTerrainCase: dB.filter((d) => d > 6.8).length },
    A_vs_B: { biasPp: +mean(dAB).toFixed(2), rmsePp: +rms(dAB).toFixed(2), maxAbsPp: +Math.max(...dAB.map(Math.abs)).toFixed(2) },
  },
  transitions2027: {
    litStateAgreementPct: +mean(rows.map((r) => r.litAgreePct)).toFixed(2),
    medianShiftMinutes: rows.map((r) => r.medianShiftMin).filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b)[Math.floor(rows.length / 2)],
  },
  decisions: {
    what: `14-day landing every 3 days in 2027 (${LANDINGS.length} dates x ${rows.length} points), default lander`,
    n: all.length,
    nominalAgreementPct: +((100 * count((d) => d.nomA === d.nomB)) / all.length).toFixed(2),
    passAll8AgreementPct: +((100 * count((d) => d.allA === d.allB)) / all.length).toFixed(2),
    offeredByAdjusted: offeredA,
    offeredByAdjustedAndConfirmedByFull: offeredBoth,
    adjustedPrecisionPct: offeredA ? +((100 * offeredBoth) / offeredA).toFixed(1) : null,
    missedByAdjusted: count((d) => !d.allA && d.allB),
    passAll8WithFull: count((d) => d.allB),
  },
  terrainCase: {
    what: "published landing sites: our 18.6-year sunlight minus NASA's",
    n: pub.length,
    rmsePp: +rms(over).toFixed(2),
    oursHigherByMoreThanCasePct: +((100 * over.filter((x) => x > 6.8).length) / pub.length).toFixed(1),
    note: "the terrain case removes 6.8 points of sunlight; where our map overstates sunlight by more than that, the case is not conservative enough",
  },
  rows: rows.map(({ dec, ...r }) => ({ ...r, passAll8A: dec.filter((d) => d.allA).length, passAll8B: dec.filter((d) => d.allB).length })),
};
const out = path.join(ROOT, "research/validation/nearby.json");
fs.writeFileSync(out, JSON.stringify(result, null, 1));
const { rows: _r, ...summary } = result;
console.log(JSON.stringify(summary, null, 1));
