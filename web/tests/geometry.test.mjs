// Pins the geometric conventions that two earlier bugs broke (a 180-degree flip of the
// horizon, then an east-west mirror). If either comes back, these tests fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { project, unproject, azimuthToImageDir } from "../../scripts/lib/horizon.mjs";

const unit = (v) => { const n = Math.hypot(v.x, v.y); return { x: v.x / n, y: v.y / n }; };
const dirBetween = (a, b) => unit({ x: b.x - a.x, y: b.y - a.y });
const close = (a, b, tol = 1e-3) => Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol;

for (const [lat, lon] of [[-86, 0], [-88.45, 292.1], [-85.2, 33], [-89.4, 222.7], [-84, 120]]) {
  test(`azimuth 0 points north (away from the pole) at ${lat},${lon}`, () => {
    const here = project(lat, lon);
    const north = project(lat + 0.001, lon); // one step further from the south pole
    const d = azimuthToImageDir(0, lon);
    assert.ok(close({ x: d.dx, y: d.dy }, dirBetween(here, north)), "az 0 must step toward higher latitude");
  });

  test(`azimuth 90 points east at ${lat},${lon} (guards the east-west mirror)`, () => {
    const here = project(lat, lon);
    const east = project(lat, lon + 0.001);
    const d = azimuthToImageDir(90, lon);
    assert.ok(close({ x: d.dx, y: d.dy }, dirBetween(here, east)), "az 90 must step toward increasing east longitude");
  });

  test(`project/unproject round-trip at ${lat},${lon}`, () => {
    const p = project(lat, lon);
    const back = unproject(p.x, p.y);
    assert.ok(Math.abs(back.lat - lat) < 1e-6);
    assert.ok(Math.abs((((back.lon - lon) % 360) + 540) % 360 - 180) < 1e-6);
  });
}

// Values fetched from NASA JPL Horizons (api/horizons.api, CENTER='coord@301', QUANTITIES='4',
// apparent az/el) on 15 Nov 2026 for 2027-02-04 00:00 UTC. Our positions are geometric, so a
// few hundredths of a degree is the expected difference (aberration and light time).
const HORIZONS = [
  { name: "de Gerlache Rim 2", lat: -88.45, lon: 292.1409, sun: [277.473212, 0.367872], earth: [68.423842, -3.591223] },
  { name: "Apollo 11", lat: 0.6741, lon: 23.473, sun: [274.689453, -83.831077], earth: [278.44799, 66.879303] },
];
for (const h of HORIZONS) {
  test(`Sun and Earth match JPL Horizons at ${h.name} (Earth seen from the surface)`, async () => {
    const { skyAt, siteBasis, lookAngles, earthFromSurface } = await import("../.build/selene.js");
    const b = siteBasis(h.lat, h.lon);
    const sky = skyAt(new Date(Date.UTC(2027, 1, 4)));
    const s = lookAngles(sky.sun, b), e = lookAngles(earthFromSurface(sky, b.up), b);
    const near = (a, x, tol, what) => assert.ok(Math.abs(a - x) < tol, `${what}: ours ${a.toFixed(4)} vs Horizons ${x}`);
    near(s.az, h.sun[0], 0.02, "Sun az"); near(s.elev, h.sun[1], 0.02, "Sun el");
    near(e.az, h.earth[0], 0.02, "Earth az"); near(e.elev, h.earth[1], 0.02, "Earth el");
  });
}
