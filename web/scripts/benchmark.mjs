/**
 * Sensitivity benchmarks for the illumination numbers:
 *   1. finite solar disc vs centre-of-disc
 *   2. landing point moved ±250 m (horizon held fixed, isolates geometry)
 *   3. horizon azimuth sampling (every 4° instead of 1°)
 *
 * Run: npm run bench   → writes public/terrain/benchmarks.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSkies, siteSeries, statsFor } from "../.build/analysis.js";
import { readSite } from "../.build/selene.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT = path.resolve(ROOT, "public/terrain/benchmarks.json");

const meta = JSON.parse(fs.readFileSync(path.resolve(ROOT, "public/terrain/sites.json"), "utf8"));
const D = Math.PI / 180;
const STEP_MIN = 30;
const DAYS = 180;
const SUN_R = 0.266;

const skies = buildSkies(new Date(Date.UTC(2027, 0, 1)), DAYS, STEP_MIN);

/** Interpolate a coarse horizon (sampled every `everyDeg`) back to 1° resolution. */
function expandHorizon(profile, everyDeg) {
  const out = new Array(360);
  const n = 360 / everyDeg;
  for (let a = 0; a < 360; a++) {
    const x = a / everyDeg;
    const i = Math.floor(x) % n;
    const j = (i + 1) % n;
    const t = x - Math.floor(x);
    out[a] = profile[i] * (1 - t) + profile[j] * t;
  }
  return out;
}

const results = [];
for (const site of meta.sites) {
  const samples = siteSeries(site, skies);
  const stats = statsFor(samples, STEP_MIN);

  // 1. criterion: disc centre vs any part (the app's rule) vs disc-integrated fraction
  const centrePct = statsFor(siteSeries({ ...site, horizonDeg: site.horizonDeg.map((h) => h + SUN_R) }, skies), STEP_MIN).illumPct;
  let discSum = 0;
  for (const sky of skies) {
    const r = readSite(site, sky);
    discSum += Math.min(1, Math.max(0, (r.sunElev + SUN_R - r.sunHorizon) / (2 * SUN_R)));
  }
  const discPct = (discSum / skies.length) * 100;

  // 2. position sensitivity ±250 m
  const radiusDeg = 250 / 1737400 / D;
  const vals = [stats.illumPct];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * 2 * Math.PI;
    const moved = {
      ...site,
      lat: site.lat + Math.cos(a) * radiusDeg,
      lon: site.lon + (Math.sin(a) * radiusDeg) / Math.max(0.05, Math.cos(site.lat * D)),
    };
    vals.push(statsFor(siteSeries(moved, skies), STEP_MIN).illumPct);
  }
  const mean = vals.reduce((x, y) => x + y, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((x, y) => x + (y - mean) ** 2, 0) / vals.length);

  // 3. azimuth sampling: keep every 4th sample, interpolate back
  const coarse = expandHorizon(site.horizonDeg.filter((_, i) => i % 4 === 0), 4);
  const coarsePct = statsFor(siteSeries({ ...site, horizonDeg: coarse }, skies), STEP_MIN).illumPct;

  results.push({
    site: site.name,
    illumPct: +stats.illumPct.toFixed(2), // any part of the disc (the app's rule)
    centrePct: +centrePct.toFixed(2),
    discPct: +discPct.toFixed(2),
    discDeltaPct: +(discPct - centrePct).toFixed(2), // disc-integrated vs centre, as reported before
    criterionSpreadPct: +(stats.illumPct - centrePct).toFixed(2), // any part vs centre
    positionShiftSdPct: +sd.toFixed(2),
    horizon4degPct: +coarsePct.toFixed(2),
    horizonDeltaPct: +(coarsePct - stats.illumPct).toFixed(2),
  });
}

const summary = {
  generated: new Date().toISOString(),
  window: { days: DAYS, stepMin: STEP_MIN, start: "2027-01-01" },
  model: { sunAngularRadiusDeg: SUN_R, positionShiftRadiusM: 250, coarseHorizonSamplingDeg: 4 },
  sites: results,
  maxDiscDeltaPct: Math.max(...results.map((r) => Math.abs(r.discDeltaPct))),
  maxCriterionSpreadPct: Math.max(...results.map((r) => Math.abs(r.criterionSpreadPct))),
  maxPositionShiftSdPct: Math.max(...results.map((r) => Math.abs(r.positionShiftSdPct))),
  maxHorizonDeltaPct: Math.max(...results.map((r) => Math.abs(r.horizonDeltaPct))),
};

fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
console.table(results);
console.log(
  `disc ≤ ${summary.maxDiscDeltaPct.toFixed(2)}% · position σ ≤ ${summary.maxPositionShiftSdPct.toFixed(2)}% · ` +
  `azimuth 4° ≤ ${summary.maxHorizonDeltaPct.toFixed(2)}%`
);
