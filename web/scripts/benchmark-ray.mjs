/**
 * Ray-sampling study: how much does the horizon sampling step change illumination?
 *
 * Horizon ray-marching samples the raster at discrete distances. If the step is
 * much larger than a pixel the march can step over ridges; if it is much smaller
 * than the DEM's effective resolution it can lock onto near-field artefacts that
 * the site coordinate was never chosen for. This quantifies both regimes on three
 * terrain products at one coordinate.
 *
 * Run: npm run bench:ray
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSkies, siteSeries, statsFor } from "../.build/analysis.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.resolve(HERE, "../../data/raw");
const OUT = path.resolve(HERE, "../public/terrain/benchmark-ray.json");

const R = 1737400, D = Math.PI / 180;
// Pinned to the coordinate the research report uses (not looked up by name, so it stays
// reproducible when the app's site list changes).
const site = { name: "Peak near Shackleton (report coordinate)", lat: -89.438, lon: 222.717 };
const skies = buildSkies(new Date(Date.UTC(2027, 0, 1)), 180, 30);

const products = [
  { label: "80 m", file: "ldem_80s_80m.img", N: 7600, pixM: 80, maxLat: 80 },
  { label: "40 m", file: "ldem_80s_40m.img", N: 15200, pixM: 40, maxLat: 80 },
  { label: "20 m", file: "ldem_875s_20m.img", N: 7584, pixM: 20, maxLat: 87.5 },
];

function load(file, N) {
  const p = path.join(RAW, file);
  if (!fs.existsSync(p)) return null;
  const buf = fs.readFileSync(p);
  if (buf.length !== N * N * 2) return null;
  return new Int16Array(buf.buffer, buf.byteOffset, N * N);
}

const rows = [];
for (const prod of products) {
  const dem = load(prod.file, prod.N);
  if (!dem) { rows.push({ product: prod.label, note: "raster not present" }); continue; }

  const C = (prod.N - 1) / 2;
  const colat = (90 - Math.abs(site.lat)) * D;
  const r = (2 * R * Math.tan(colat / 2)) / prod.pixM;
  const a = site.lon * D;
  const x0 = C + r * Math.sin(a);
  const y0 = C - r * Math.cos(a);

  const at = (x, y) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= prod.N || yi >= prod.N) return null;
    return dem[yi * prod.N + xi] * 0.5;
  };
  const e0 = at(x0, y0);
  if (e0 === null) { rows.push({ product: prod.label, note: "outside coverage" }); continue; }

  for (const stepM of [80, 160, 320]) {
    const stepPx = Math.max(1, Math.round(stepM / prod.pixM));
    const steps = Math.floor(64000 / (stepPx * prod.pixM));
    const prof = [];
    for (let az = 0; az < 360; az++) {
      // geographic azimuth -> image direction: north (az 0) is (sin lon, -cos lon), east is (cos lon, sin lon)
      const ang = (az + site.lon) * D;
      // negated: raster axes run opposite to the standard stereographic convention
      const dx = Math.sin(ang), dy = -Math.cos(ang);
      let best = -1e9;
      for (let k = 1; k <= steps; k++) {
        const h = at(x0 + dx * k * stepPx, y0 + dy * k * stepPx);
        if (h === null) break;
        const d = k * stepPx * prod.pixM;
        const s = (h - e0 - (d * d) / (2 * R)) / d;
        if (s > best) best = s;
      }
      prof.push(best === -1e9 ? 0 : Math.atan(best) / D);
    }
    // disc-centre criterion, as in the report's sampling table (readSite uses any part of the disc)
    const st = statsFor(siteSeries({ ...site, horizonDeg: prof.map((h) => h + 0.266) }, skies), 30);
    rows.push({
      product: prod.label,
      spatialResM: prod.pixM,
      stepM,
      stepsPerPixel: +(stepM / prod.pixM).toFixed(1),
      meanHorizonDeg: +(prof.reduce((p, q) => p + q, 0) / 360).toFixed(2),
      illumPct: +st.illumPct.toFixed(1),
    });
  }
}

const summary = {
  generated: new Date().toISOString(),
  site: site.name,
  note: "Same coordinate, same 64 km range, same curvature correction; only the distance between samples changes.",
  rows,
};
fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
console.table(rows);
