// Battery model: hand-checkable cases and consistency between the two code paths
// (the single-landing check and the porkchop grid).
import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateMission, porkchopRow, arrayPowerPerM2, sizeToSurvive } from "../.build/power.js";

const STEP_MIN = 30;
const spec = { loadW: 100, arrayM2: 4, batteryWh: 10000, dod: 0.8 }; // 8000 Wh usable
const series = (n, f) => Array.from({ length: n }, (_, i) => ({ t: i * STEP_MIN * 60000, ...f(i) }));

test("always in sunlight: never lost, battery stays full", () => {
  const s = series(48 * 14, () => ({ lit: true, sunElev: 1 }));
  const r = simulateMission(s, 0, s.length, STEP_MIN, "tracking", spec);
  assert.equal(r.survives, true);
  assert.equal(r.lostAt, null);
  assert.ok(r.minSocPct > 99.9);
});

test("always dark: lost exactly when usable energy / load hours have passed", () => {
  const s = series(48 * 14, () => ({ lit: false, sunElev: -2 }));
  const r = simulateMission(s, 0, s.length, STEP_MIN, "tracking", spec);
  assert.equal(r.survives, false);
  // 8000 Wh / 100 W = 80 h = sample 159 (0-based) at 30-min steps
  assert.equal(r.lostAt, 159 * STEP_MIN * 60000);
});

test("panel output: no power in shadow, flat panel nearly useless at a 1.5 degree Sun", () => {
  assert.equal(arrayPowerPerM2(1.5, false, "tracking"), 0);
  const flat = arrayPowerPerM2(1.5, true, "horizontal"), facing = arrayPowerPerM2(1.5, true, "tracking");
  assert.ok(flat / facing < 0.03, `flat/facing = ${flat / facing}`);
});

test("porkchop cell equals the full simulation for the same landing", () => {
  // days 0-30: 3 days lit / 2.5 days dark (survivable, < 80 h usable);
  // days 30-60: 3 days lit / 4 days dark (fatal): early landings survive, late ones do not
  const s = series(48 * 60, (i) => {
    const day = i / 48;
    const [lit, dark] = day < 30 ? [3, 2.5] : [3, 4];
    return (day % (lit + dark)) < lit ? { lit: true, sunElev: 1 } : { lit: false, sunElev: -1 };
  });
  const steps = 48 * 14, stride = 12;
  const row = porkchopRow(s, steps, stride, STEP_MIN, "tracking", spec);
  let checked = 0;
  for (let c = 0; c < row.length; c++) {
    if (Number.isNaN(row[c])) continue;
    const full = simulateMission(s, c * stride, steps, STEP_MIN, "tracking", spec);
    if (full.survives) assert.ok(Math.abs(row[c] - full.minSocPct) < 1e-6, `col ${c}`);
    else assert.equal(row[c], -1, `col ${c}`);
    checked++;
  }
  assert.ok(checked > 50);
  assert.ok(row.some((v) => v === -1) && row.some((v) => v > 0), "pattern should contain both outcomes");
});

test("a lander that runs flat stays lost when the Sun returns", () => {
  // 4 days dark (lost after 80 h), then 10 days of sunlight
  const s = series(48 * 14, (i) => (i < 48 * 4 ? { lit: false, sunElev: -2 } : { lit: true, sunElev: 1 }));
  const r = simulateMission(s, 0, s.length, STEP_MIN, "tracking", spec);
  assert.equal(r.survives, false);
  assert.equal(r.minSocPct, 0);
  assert.ok(r.soc.slice(160).every((v) => v === 0), "battery trace must stay at zero after loss");
});

test("vertical panels on four faces give 25-35% of a Sun-tracking panel", () => {
  const facing = arrayPowerPerM2(1.5, true, "tracking");
  for (const az of [0, 20, 45, 90, 135, 200, 315]) {
    const r = arrayPowerPerM2(1.5, true, "vertical", az) / facing;
    assert.ok(r >= 0.249 && r <= 0.354, `az ${az}: ${r}`);
  }
  assert.equal(arrayPowerPerM2(1.5, false, "vertical", 45), 0);
});

test("survival heaters drain the battery only in the dark", () => {
  // always lit: heaters never switch on
  const lit = series(48 * 3, () => ({ lit: true, sunElev: 1 }));
  assert.ok(simulateMission(lit, 0, lit.length, STEP_MIN, "tracking", { ...spec, heaterW: 500 }).minSocPct > 99.9);
  // always dark: 100 W load + 60 W heaters empties 8000 Wh in 50 h = sample 99
  const dark = series(48 * 3, () => ({ lit: false, sunElev: -2 }));
  const r = simulateMission(dark, 0, dark.length, STEP_MIN, "tracking", { ...spec, heaterW: 60 });
  assert.equal(r.lostAt, 99 * STEP_MIN * 60000);
});

test("sizing: the smallest battery found is the survival threshold", () => {
  // 3 days lit, 4 days dark, repeated: 96 h of darkness at 100 W needs 9600 Wh usable = 12 kWh at 80% DoD
  const s = series(48 * 14, (i) => ((i / 48) % 7 < 3 ? { lit: true, sunElev: 1 } : { lit: false, sunElev: -1 }));
  const { batteryWh, arrayM2 } = sizeToSurvive(s, 0, s.length, STEP_MIN, "tracking", spec);
  assert.ok(Math.abs(batteryWh - 12000) / 12000 < 0.01, `battery ${batteryWh}`);
  assert.equal(simulateMission(s, 0, s.length, STEP_MIN, "tracking", { ...spec, batteryWh: batteryWh * 0.98 }).survives, false);
  // no panel area can carry a 10 kWh battery through a 4-day night
  assert.equal(arrayM2, null);
});
