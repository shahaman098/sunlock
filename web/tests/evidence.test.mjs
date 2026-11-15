// The numbers the app and the submission quote, checked against their pre-registered
// thresholds and the shipped data files. Regenerate with npm run validate / sites / verify.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../public/terrain/${p}`, import.meta.url), "utf8"));
const v = read("validation.json");
const sites = read("sites.json").sites;
const jpl = read("verification.json");

test("pre-registered H1: sunlight vs NASA LOLA map, r >= 0.90 and |bias| <= 5 pp", () => {
  assert.ok(v.mapWide.r >= 0.9, `r = ${v.mapWide.r}`);
  assert.ok(Math.abs(v.mapWide.biasPp) <= 5, `bias = ${v.mapWide.biasPp}`);
  assert.ok(v.mapWide.n >= 1500, "pre-registered sample size (2,000 points) actually used");
  assert.equal(v.mapWide.stepHours, 1, "pre-registered hourly step");
});

test("pre-registered H2: permanent shadow vs NASA LPSR, IoU >= 0.80", () => {
  assert.ok(v.mapWide.shadow.iou >= 0.8, `IoU = ${v.mapWide.shadow.iou}`);
});

test("pre-registered H4: Earth visibility vs NASA map, r >= 0.90 (catches the east-west mirror)", () => {
  assert.ok(v.mapWide.earth.r >= 0.9, `r = ${v.mapWide.earth.r}`);
  assert.ok(v.earthAtLandingSites.r >= 0.9, `landing sites r = ${v.earthAtLandingSites.r}`);
});

test("JPL Horizons cross-check within stated tolerances", () => {
  assert.ok(jpl.geometry.maxSunArcsec < 30 && jpl.geometry.maxEarthArcsec < 30);
  assert.ok(jpl.frame.maxSunLonDeg < 0.01 && jpl.frame.maxEarthLonDeg < 0.01);
});

test("all nine current NASA Artemis III regions are present, with complete horizons", () => {
  const nine = ["Peak near Cabeus B", "Haworth", "Malapert Massif", "Mons Mouton Plateau", "Mons Mouton",
    "Nobile Rim 1", "Nobile Rim 2", "de Gerlache Rim 2", "Slater Plain"];
  for (const n of nine) {
    const s = sites.find((x) => x.name === n);
    assert.ok(s, `missing ${n}`);
    assert.equal(s.current, true);
    assert.equal(s.horizonDeg.length, 360);
    assert.deepEqual(s.heights.map((h) => h.heightM), [0, 2, 10]);
  }
});

test("each site's shown value agrees with NASA's map where the map exists (selection rule)", () => {
  for (const s of sites) {
    if (s.longRun.nasaSunPct === null) continue;
    assert.ok(Math.abs(s.longRun.sunPct - s.longRun.nasaSunPct) <= 5, `${s.name}: ${s.longRun.sunPct} vs ${s.longRun.nasaSunPct}`);
  }
});

test("notable landings: Apollo, CLPS and other countries present; planned targets labelled approximate", () => {
  const m = JSON.parse(fs.readFileSync(new URL("../public/terrain/missions.json", import.meta.url))).missions;
  for (const id of ["apollo-11", "apollo-17", "im-1", "blue-ghost-1", "chandrayaan-3", "change-4"]) assert.ok(m.some((x) => x.id === id), id);
  for (const x of m) {
    assert.equal(x.horizonDeg.length, 360, x.id);
    assert.equal(x.terrain, x.lat <= -80, `${x.id}: terrain horizon only inside the 80-90 S map`);
    if (x.approx) assert.match(x.blurb, /approximate/, `${x.id} must say it is approximate`);
  }
  assert.ok(m.some((x) => x.approx), "planned mission targets present");
});
