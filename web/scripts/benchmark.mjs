/**
 * Sensitivity benchmarks for SUNLOCK.
 *
 * Answers three questions a reviewer should ask:
 *
 *   1. How much does the finite size of the Sun change the illumination numbers?
 *   2. How sensitive is a site's result to where exactly you put the lander (±250 m)?
 *   3. How much does the horizon sampling step change the answer?
 *
 * Run against the shipped modules:  npm run bench
 * Writes public/terrain/benchmarks.json and prints a summary.
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

/** Mean fraction of the solar disc above the skyline, given centre elevation and horizon. */
function discFraction(sunElev, horizon, sunRadius = 0.266) {
  const x = (sunElev + sunRadius - horizon) / (2 * sunRadius);
  return Math.min(1, Math.max(0, x));
}

function horizonAt(profile, az) {
  const a = ((az % 360) + 360) % 360;
  const i = Math.floor(a) % 360;
  const j = (i + 1) % 360;
  const t = a - Math.floor(a);
  return profile[i] * (1 - t) + profile[j] * t;
}

const skies = buildSkies(new Date(Date.UTC(2027, 0, 1)), DAYS, STEP_MIN);
const SUN_R = 0.266;

/** Interpolate a coarse (every `everyDeg`) horizon profile back to 1-degree samples. */
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

  // 1. finite solar disc — fraction of the disc above the local skyline
  let discSum = 0;
  for (const sky of skies) {
    const r = readSite(site, sky);
    const f = (r.sunElev + SUN_R - r.sunHorizon) / (2 * SUN_R);
    discSum += Math.min(1, Math.max(0, f));
  }
  const discPct = (discSum / skies.length) * 100;

  // 2. position sensitivity — move the landing point 250 m in 8 directions
  const radiusDeg = 250 / 1737400 / D;
  const illum = [stats.illumPct];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * 2 * Math.PI;
    const moved = {
      ...site,
      lat: site.lat + Math.cos(a) * radiusDeg,
      lon: site.lon + (Math.sin(a) * radiusDeg) / Math.max(0.05, Math.cos(site.lat * D)),
    };
    illum.push(statsFor(siteSeries(moved, skies), STEP_MIN).illumPct);
  }
  const mean = illum.reduce((a, b) => a + b, 0) / illum.length;
  const sd = Math.sqrt(illum.reduce((a, b) => a + (b - mean) ** 2, 0) / illum.length);

  // 3. horizon sampling — keep only every 4th azimuth, interpolate back, re-run
  const coarse = expandHorizon(site.horizonDeg.filter((_, i) => i % 4 === 0), 4);
  const coarsePct = statsFor(siteSeries({ ...site, horizonDeg: coarse }, skies), STEP_MIN).illumPct;

  results.push({
    site: site.name,
    illumPct: +stats.illumPct.toFixed(2),
    discPct: +discPct.toFixed(2),
    discDeltaPct: +(discPct - stats.illumPct).toFixed(2),
    positionShiftSdPct: +sd.toFixed(2),
    horizon4degPct: +coarsePct.toFixed(2),
    horizonDeltaPct: +(coarsePct - stats.illumPct).toFixed(2),
  });
}

const summary = {
  generated: new Date().toISOString(),
  window: { days: DAYS, stepMin: STEP_MIN, start: "2027-01-01" },
  model: {
    sunAngularRadiusDeg: 0.266,
    earthAngularRadiusDeg: 0.95,
    positionShiftRadiusM: 250,
    coarseHorizonSamplingDeg: 4,
  },
  sites: results,
  maxPositionShiftSdPct: Math.max(...results.map((r) => Math.abs(r.positionShiftSdPct))),
  maxHorizonDeltaPct: Math.max(...results.map((r) => Math.abs(r.horizonDeltaPct))),
  maxDiscDeltaPct: Math.max(...results.map((r) => Math.abs(r.discDeltaPct))),
};

fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
console.table(results);
console.log(
  `worst position-shift σ ${summary.maxPositionShiftSdPct.toFixed(2)}% · ` +
  `worst 4°-horizon error ${summary.maxHorizonDeltaPct.toFixed(2)}% · ` +
  `max solar-disc effect ${summary.maxDiscDeltaPct.toFixed(2)}%`
);
