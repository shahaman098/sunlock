// Decision-level checks on real site data: every alternative the stress card offers must pass
// every tested case when applied, including a terrain case calibrated on that exact spot.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildSkies, siteSeries, raisedTerrain } from "../.build/analysis.js";
import { stressTest, robustOptions } from "../.build/power.js";
import { offsetPoint, nearbyHorizon, customHorizon } from "../.build/terrain.js";

const read = (p) => fs.readFileSync(new URL(`../public/terrain/${p}`, import.meta.url));
const meta = JSON.parse(read("sites.json"));
const buf = read("elevgrid.bin");
const grid = { size: meta.elevation.size, pixM: meta.elevation.pixM, data: new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2) };

const STEP_MIN = 30, START = Date.UTC(2027, 0, 1), YEAR_N = 365 * 48 + 1, DROP = 6.8;
const skies = buildSkies(new Date(START), 365 + 31, STEP_MIN);
const spec = { loadW: 100, arrayM2: 4, batteryWh: 10000, dod: 0.8, heaterW: 0 }; // the app's default lander
const steps = 14 * 48;
const land = Math.round((Date.UTC(2027, 1, 15) - START) / (STEP_MIN * 60000));
const current = meta.sites.filter((s) => s.current !== false);
const dgr2 = meta.sites.find((s) => s.id === "de-gerlache-rim-2");

const litPct = (ser) => { let n = 0; for (let i = 0; i < YEAR_N; i++) n += ser[i].lit ? 1 : 0; return (100 * n) / YEAR_N; };
const terrainFor = (s) => ({ samples: raisedTerrain(s, skies, YEAR_N, DROP).samples, label: "terrain" });
const allPass = (ser, s, sp = spec, start = land) =>
  stressTest(ser, start, steps, STEP_MIN, "tracking", sp, {}, terrainFor(s)).every((c) => c.result !== null && c.result.survives);

test("terrain case is calibrated on each site: sunlight falls by 6.8 points and never rises", () => {
  for (const s of current) {
    const base = siteSeries(s, skies), raised = raisedTerrain(s, skies, YEAR_N, DROP);
    const drop = litPct(base) - litPct(raised.samples);
    assert.ok(Math.abs(drop - DROP) < 0.15, `${s.name}: drop ${drop.toFixed(2)}`);
    for (let i = 0; i < YEAR_N; i++) if (raised.samples[i].lit) assert.ok(base[i].lit, `${s.name}: raising the hills added sunlight`);
  }
});

test("nearby skyline: identical to the site at zero distance; offsets land at the stated distance", () => {
  const z = nearbyHorizon(grid, dgr2, dgr2.lat, dgr2.lon);
  assert.deepEqual(z.horizon, dgr2.horizonDeg);
  assert.equal(z.elevationM, dgr2.elevationM);
  const D = Math.PI / 180, R = 1737400;
  for (const az of [0, 90, 225]) {
    const p = offsetPoint(dgr2.lat, dgr2.lon, az, 1000);
    const c = Math.sin(dgr2.lat * D) * Math.sin(p.lat * D) + Math.cos(dgr2.lat * D) * Math.cos(p.lat * D) * Math.cos((dgr2.lon - p.lon) * D);
    assert.ok(Math.abs(Math.acos(Math.min(1, c)) * R - 1000) < 0.5);
  }
  // the adjustment is exactly the coarse-grid change between the two points
  const p = offsetPoint(dgr2.lat, dgr2.lon, 90, 2000);
  const h = nearbyHorizon(grid, dgr2, p.lat, p.lon);
  const a = customHorizon(grid, dgr2.lat, dgr2.lon), b = customHorizon(grid, p.lat, p.lon);
  for (const i of [0, 90, 180, 270]) assert.ok(Math.abs(h.horizon[i] - dgr2.horizonDeg[i] - (b.horizon[i] - a.horizon[i])) < 1e-9);
});

test("de Gerlache Rim 2, 15 Feb 2027: marginal plan, and every offered fix passes all 8 cases", () => {
  const ser = siteSeries(dgr2, skies);
  const cases = stressTest(ser, land, steps, STEP_MIN, "tracking", spec, {}, terrainFor(dgr2));
  assert.equal(cases.length, 8);
  assert.equal(cases[0].result.survives, true, "nominal should pass");
  assert.equal(cases.filter((c) => c.result.survives).length, 5);

  const o = robustOptions(ser, land, steps, STEP_MIN, "tracking", spec, {}, terrainFor(dgr2), YEAR_N - 1 - steps);
  assert.ok(o.batteryWh !== null);
  assert.ok(allPass(ser, dgr2, { ...spec, batteryWh: o.batteryWh }), "offered battery passes");
  assert.equal(allPass(ser, dgr2, { ...spec, batteryWh: o.batteryWh - 100 }), false, "100 Wh less fails");
  assert.ok(o.landIdx !== null && allPass(ser, dgr2, spec, o.landIdx), "offered landing time passes");

  // other sites are offered only if they pass every case with their own terrain case
  const offered = current.filter((s) => s.id !== dgr2.id && allPass(siteSeries(s, skies), s));
  assert.ok(offered.length > 0);
  for (const s of offered) assert.ok(allPass(siteSeries(s, skies), s), s.name);
});

test("nearby positions around a narrow sunlit crest lose sunlight, so none rescues this plan", () => {
  // de Gerlache Rim 2 sits on a local high: 1-2 km away the ground is 50-600 m lower
  const ser0 = siteSeries(dgr2, skies);
  let passing = 0, lower = 0;
  for (const km of [1, 2]) for (let az = 0; az < 360; az += 45) {
    const p = offsetPoint(dgr2.lat, dgr2.lon, az, km * 1000);
    const h = nearbyHorizon(grid, dgr2, p.lat, p.lon);
    const s = { ...dgr2, ...p, horizonDeg: h.horizon, elevationM: h.elevationM };
    const ser = siteSeries(s, skies);
    if (litPct(ser) < litPct(ser0)) lower++;
    if (allPass(ser, s)) passing++;
  }
  assert.equal(passing, 0);
  assert.ok(lower >= 14, `${lower} of 16 positions are darker`);
});
