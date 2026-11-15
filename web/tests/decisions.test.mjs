// Decision-level checks on real site data: every alternative the stress card offers must pass
// every tested case when applied, including a terrain case calibrated on that exact spot.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildSkies, siteSeries, raisedTerrain } from "../.build/analysis.js";
import { stressTest, robustOptions } from "../.build/power.js";

const read = (p) => fs.readFileSync(new URL(`../public/terrain/${p}`, import.meta.url));
const meta = JSON.parse(read("sites.json"));

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

const nearby = JSON.parse(read("nearby.json")).sites;

test("nearby positions: 16 per current site, at the stated distance, with their own 80 m skylines", () => {
  const D = Math.PI / 180, R = 1737400;
  for (const s of current) {
    assert.equal(nearby[s.id].length, 16, s.id);
    for (const n of nearby[s.id]) {
      const c = Math.sin(s.lat * D) * Math.sin(n.lat * D) + Math.cos(s.lat * D) * Math.cos(n.lat * D) * Math.cos((s.lon - n.lon) * D);
      assert.ok(Math.abs(Math.acos(Math.min(1, c)) * R - n.km * 1000) < 1, `${s.id} ${n.km} km ${n.dir}`);
      assert.equal(n.horizonDeg.length, 360);
    }
  }
});

test("nearby positions: darker over the year, yet a few pass this window; each is judged on its own skyline", () => {
  // de Gerlache Rim 2 sits on a local high, so all 16 positions 1-2 km away see less Sun over the
  // year; a few still happen to be lit through this particular 14-day window
  const ser0 = siteSeries(dgr2, skies);
  const passing = [];
  for (const n of nearby[dgr2.id]) {
    const s = { ...dgr2, lat: n.lat, lon: n.lon, horizonDeg: n.horizonDeg, elevationM: n.elevationM };
    const ser = siteSeries(s, skies);
    assert.ok(litPct(ser) < litPct(ser0), `${n.km} km ${n.dir} should be darker over the year`);
    if (allPass(ser, s)) passing.push(`${n.km} km ${n.dir}`);
  }
  assert.deepEqual(passing, ["1 km north-east", "2 km north", "2 km north-east"]);
});

test("independent evidence: nearby skylines agree with NASA's 18.6-year sunlight; the rejected shortcut did not", () => {
  const v = JSON.parse(fs.readFileSync(new URL("../../research/validation/nearby.json", import.meta.url)));
  const full = v.sunlight18y.B_vs_NASA, adjusted = v.sunlight18y.A_vs_NASA;
  assert.ok(v.sunlight18y.nNasa >= 90);
  assert.ok(full.r >= 0.9 && Math.abs(full.biasPp) <= 2 && full.rmsePp <= 6.8, JSON.stringify(full));
  assert.ok(adjusted.r < 0.5, "the adjusted shortcut is documented as failing");
  // the terrain case (-6.8 points) covers our error at >= 90% of published sites
  assert.ok(v.terrainCase.n === 105 && v.terrainCase.oursHigherByMoreThanCasePct <= 10);
});
