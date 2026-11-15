/**
 * Convergence and criterion study (report §5.2 and §5.3).
 *
 * Same coordinate, bilinear terrain sampling, decreasing ray interval. Reports
 * illumination under two criteria:
 *   - centre: the centre of the solar disc clears the skyline
 *   - limb:   any part of the 0.266° disc clears the skyline
 *
 * Run: npm run bench:conv
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSkies, siteSeries, statsFor } from "../.build/analysis.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.resolve(HERE, "../../data/raw");
const OUT = path.resolve(HERE, "../public/terrain/benchmark-convergence.json");

const R = 1737400, D = Math.PI / 180, SUN_R = 0.266;
// Pinned to the coordinate the research report uses (not looked up by name, so it stays
// reproducible when the app's site list changes).
const site = { name: "Peak near Shackleton (report coordinate)", lat: -89.438, lon: 222.717 };
const skies = buildSkies(new Date(Date.UTC(2027, 0, 1)), 180, 30);

const N = 7600, PIX = 80, C = (N - 1) / 2;
const dem = new Int16Array(fs.readFileSync(path.join(RAW, "ldem_80s_80m.img")).buffer.slice(0));

const colat = (90 - Math.abs(site.lat)) * D;
const rr = (2 * R * Math.tan(colat / 2)) / PIX;
const a = site.lon * D;
const x0 = C + rr * Math.sin(a);
const y0 = C - rr * Math.cos(a);

/** bilinear terrain sample; null outside the raster */
function bilinear(x, y) {
  if (x < 0 || y < 0 || x >= N - 1 || y >= N - 1) return null;
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const p00 = dem[yi * N + xi] * 0.5;
  const p10 = dem[yi * N + xi + 1] * 0.5;
  const p01 = dem[(yi + 1) * N + xi] * 0.5;
  const p11 = dem[(yi + 1) * N + xi + 1] * 0.5;
  return p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy;
}

function horizon(stepM) {
  const e0 = bilinear(x0, y0);
  if (e0 === null) throw new Error("site outside raster");
  const stepPx = stepM / PIX;
  const n = Math.floor(64000 / stepM);
  const prof = [];
  for (let az = 0; az < 360; az++) {
    // geographic azimuth -> image direction: north (az 0) is (sin lon, -cos lon), east is (cos lon, sin lon)
    const ang = (az + site.lon) * D;
    // negated: raster axes run opposite to the standard stereographic convention
    const dx = Math.sin(ang), dy = -Math.cos(ang);
    let best = -1e9;
    for (let k = 1; k <= n; k++) {
      const h = bilinear(x0 + dx * k * stepPx, y0 + dy * k * stepPx);
      if (h === null) break;
      const d = k * stepM;
      const s = (h - e0 - (d * d) / (2 * R)) / d;
      if (s > best) best = s;
    }
    prof.push(Math.atan(best) / D);
  }
  return prof;
}

const rows = [];
for (const stepM of [80, 40, 20, 10]) {
  const prof = horizon(stepM);
  // readSite counts the Sun as up while any part of its disc clears the horizon.
  // Disc centre == the same test against a horizon raised by the solar radius.
  const centre = statsFor(siteSeries({ ...site, horizonDeg: prof.map((h) => h + SUN_R) }, skies), 30).illumPct;
  const limb = statsFor(siteSeries({ ...site, horizonDeg: prof }, skies), 30).illumPct;
  rows.push({
    stepM,
    meanHorizonDeg: +(prof.reduce((p, q) => p + q, 0) / 360).toFixed(2),
    centrePct: +centre.toFixed(1),
    limbPct: +limb.toFixed(1),
  });
}

const summary = {
  generated: new Date().toISOString(),
  site: site.name,
  terrain: "LDEM_80S_80M, bilinear sampling",
  sunAngularRadiusDeg: SUN_R,
  rows,
};
fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
console.table(rows);
