// Battery model: hand-checkable cases and consistency between the two code paths
// (the single-landing check and the porkchop grid).
import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateMission, porkchopRow, arrayPowerPerM2, sizeToSurvive, stressTest } from "../.build/power.js";
import { visibleDiscFraction } from "../.build/selene.js";

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
  // 8000 Wh / 100 W = exactly 80 h after landing
  assert.equal(r.lostAt, 80 * 3600000);
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
  assert.equal(r.soc[159], 0, "the failure step records the empty battery");
  assert.ok(r.soc.slice(160).every(Number.isNaN), "later charge is unevaluated after loss");
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
  // always dark: 100 W load + 60 W heaters empties 8000 Wh in exactly 50 h
  const dark = series(48 * 3, () => ({ lit: false, sunElev: -2 }));
  const r = simulateMission(dark, 0, dark.length, STEP_MIN, "tracking", { ...spec, heaterW: 60 });
  assert.equal(r.lostAt, 50 * 3600000);
});

test("sizing: the smallest battery found is the survival threshold", () => {
  // 3 days lit, 4 days dark, repeated: 96 h of darkness at 100 W needs 9600 Wh usable = 12 kWh at 80% DoD
  const s = series(48 * 14, (i) => ((i / 48) % 7 < 3 ? { lit: true, sunElev: 1 } : { lit: false, sunElev: -1 }));
  const { batteryWh, thresholdBatteryWh, arrayM2 } = sizeToSurvive(s, 0, s.length, STEP_MIN, "tracking", spec);
  assert.ok(Math.abs(thresholdBatteryWh - 12000) / 12000 < 0.001, `threshold ${thresholdBatteryWh}`);
  // exactly 12,000 Wh reaches zero at the very end of the night (lost), so the smallest
  // typeable value that survives is the next 100 Wh step
  assert.equal(simulateMission(s, 0, s.length, STEP_MIN, "tracking", { ...spec, batteryWh: 12000 }).survives, false);
  assert.equal(batteryWh, 12100, "recommended battery is the smallest 100 Wh step that survives");
  assert.equal(simulateMission(s, 0, s.length, STEP_MIN, "tracking", { ...spec, batteryWh: thresholdBatteryWh * 0.98 }).survives, false);
  // no panel area can carry a 10 kWh battery through a 4-day night
  assert.equal(arrayM2, null);
});

test("visible solar disc: none, half and full; power rises smoothly as the Sun clears a flat skyline", () => {
  assert.equal(visibleDiscFraction(-0.3), 0);
  assert.ok(Math.abs(visibleDiscFraction(0) - 0.5) < 1e-12);
  assert.equal(visibleDiscFraction(0.3), 1);
  let prev = -1;
  for (let h = -0.3; h <= 0.3; h += 0.01) {
    const p = arrayPowerPerM2(1, visibleDiscFraction(h), "tracking");
    assert.ok(p >= prev - 1e-9, `power must not fall as the Sun rises (h=${h.toFixed(2)})`);
    prev = p;
  }
  // a sliver of Sun gives a sliver of power, not full output
  assert.ok(arrayPowerPerM2(1, visibleDiscFraction(-0.25), "tracking") < 0.02 * arrayPowerPerM2(1, 1, "tracking"));
});

test("every displayed sizing fix passes when applied exactly, and the step below fails", () => {
  // irregular light: 2.6 days lit, 3.4 days dark
  const s = series(48 * 14, (i) => ((i / 48) % 6 < 2.6 ? { lit: true, sunElev: 1, sunFrac: 1 } : { lit: false, sunElev: -1, sunFrac: 0 }));
  const small = { ...spec, batteryWh: 3000, arrayM2: 2 };
  const z = sizeToSurvive(s, 0, s.length, STEP_MIN, "tracking", small);
  assert.ok(z.batteryWh !== null);
  assert.equal(simulateMission(s, 0, s.length, STEP_MIN, "tracking", { ...small, batteryWh: z.batteryWh }).survives, true);
  assert.equal(simulateMission(s, 0, s.length, STEP_MIN, "tracking", { ...small, batteryWh: z.batteryWh - 100 }).survives, false);
  if (z.arrayM2 !== null) assert.equal(simulateMission(s, 0, s.length, STEP_MIN, "tracking", { ...small, arrayM2: z.arrayM2 }).survives, true);
});

test("Earth-outage requirement: a mission with no Earth contact fails only when contact is required", () => {
  const s = series(48 * 7, () => ({ lit: true, sunElev: 1, sunFrac: 1, comm: false }));
  const free = simulateMission(s, 0, s.length, STEP_MIN, "tracking", spec, { maxEarthOutageH: null });
  assert.equal(free.survives, true);
  const need = simulateMission(s, 0, s.length, STEP_MIN, "tracking", spec, { maxEarthOutageH: 24 });
  assert.equal(need.survives, false);
  assert.equal(need.failure, "earth");
  assert.equal(need.earthFailAt, 24 * 3600000);
});

test("Earth and battery failures are ordered within the same half-hour interval", () => {
  const s = series(30, () => ({ lit: false, sunElev: -1, comm: false }));
  for (const [batteryHours, failure, earthHours] of [
    [11.75, "battery", null],
    [12, "battery", null],
    [12.25, "earth", 12],
    [13.25, "earth", 12],
  ]) {
    const lander = { ...spec, batteryWh: batteryHours * 100, dod: 1 };
    const r = simulateMission(s, 0, s.length, STEP_MIN, "tracking", lander, { maxEarthOutageH: 12 });
    assert.equal(r.failure, failure, `battery lasts ${batteryHours} h`);
    assert.equal(r.lostAt, batteryHours * 3600000);
    assert.equal(r.earthFailAt, earthHours === null ? null : earthHours * 3600000);
    assert.equal(r.longestEarthOutageH, batteryHours);
  }
});

test("Earth contact returning exactly at the outage limit keeps the requirement satisfied", () => {
  const s = series(30, (i) => ({ lit: true, sunElev: 1, comm: i >= 24 }));
  const req = { maxEarthOutageH: 12 };
  for (const steps of [24, 30]) {
    const r = simulateMission(s, 0, steps, STEP_MIN, "tracking", spec, req);
    assert.equal(r.survives, true);
    assert.equal(r.earthFailAt, null);
    assert.equal(r.longestEarthOutageH, 12);
  }
});

test("a battery already at or below reserve fails at landing even in sunlight", () => {
  const s = series(4, () => ({ lit: true, sunElev: 1 }));
  for (const initialSocPct of [10, 20]) {
    const r = simulateMission(s, 0, s.length, STEP_MIN, "tracking", spec, { initialSocPct, reservePct: 20 });
    assert.equal(r.survives, false);
    assert.equal(r.failure, "battery");
    assert.equal(r.lostAt, 0);
    assert.equal(r.minSocPct, initialSocPct);
    assert.equal(r.soc[0], initialSocPct);
    assert.ok(r.soc.slice(1).every(Number.isNaN));
  }
});

test("reserve-failure CSV records the reserve and leaves subsequent charge cells blank", async () => {
  const { missionCsv } = await import("../.build/export.js");
  const s = series(20, () => ({ lit: false, sunElev: -1, comm: true, earthElev: 1 }));
  const lander = { ...spec, batteryWh: 1000 };
  const req = { reservePct: 20 };
  const r = simulateMission(s, 0, s.length, STEP_MIN, "tracking", lander, req);
  assert.equal(r.lostAt, 6.4 * 3600000);
  assert.equal(r.minSocPct, 20);
  assert.equal(r.endSocPct, 20);
  assert.equal(r.soc[12], 20);
  assert.ok(r.soc.slice(13).every(Number.isNaN));
  const site = { id: "test", name: "Test", lat: -89, lon: 0, elevationM: 0, horizonDeg: [] };
  const csv = missionCsv({ site, samples: s, startIdx: 0, steps: s.length, soc: r.soc, mode: "tracking", spec: lander, heightM: 0, result: r, req, stress: [] });
  const rows = csv.trimEnd().split("\n").filter((line) => !line.startsWith("#")).slice(1);
  assert.equal(rows[12].split(",").at(-1), "20.0");
  assert.ok(rows.slice(13).every((line) => line.endsWith(",")));
  assert.doesNotMatch(csv, /NaN/);
});

test("stress test: a marginal plan fails when the battery starts part-charged, and says so", () => {
  // the dark spell needs 7600 Wh of an 8000 Wh usable battery: fine full, not at 80%
  const s = series(48 * 10, (i) => (i < 48 * 4 ? { lit: false, sunElev: -1, sunFrac: 0 } : { lit: true, sunElev: 1, sunFrac: 1 }).valueOf())
    .map((x, i) => (i < 152 ? { ...x, lit: false, sunFrac: 0 } : { ...x, lit: true, sunFrac: 1 }));
  const cases = stressTest(s, 0, 48 * 5, STEP_MIN, "tracking", spec);
  const by = Object.fromEntries(cases.map((c) => [c.id, c.result]));
  assert.equal(by.nominal.survives, true);
  assert.equal(by.charge.survives, false);
  assert.equal(by.charge.failure, "battery");
});

test("battery reserve: falling to the reserve fails, and the sizing answer respects it", () => {
  const s = series(48 * 14, (i) => ((i / 48) % 7 < 3 ? { lit: true, sunElev: 1, sunFrac: 1 } : { lit: false, sunElev: -1, sunFrac: 0 }));
  const req = { reservePct: 20 };
  const z = sizeToSurvive(s, 0, s.length, STEP_MIN, "tracking", spec, req);
  // 9600 Wh of night must fit in 80% of the usable charge: 12 kWh / 0.8 = 15 kWh, next 100 Wh step
  assert.equal(z.batteryWh, 15100);
  const ok = simulateMission(s, 0, s.length, STEP_MIN, "tracking", { ...spec, batteryWh: z.batteryWh }, req);
  assert.equal(ok.survives, true);
  assert.ok(ok.minSocPct >= 20);
  assert.equal(simulateMission(s, 0, s.length, STEP_MIN, "tracking", { ...spec, batteryWh: 15000 }, req).survives, false);
});

test("robust options: each single change passes every stress case when applied", async () => {
  const { robustOptions } = await import("../.build/power.js");
  // a marginal plan: 3.2 days lit, 3.3 days dark, repeating
  const s = series(48 * 30, (i) => ((i / 48) % 6.5 < 3.2 ? { lit: true, sunElev: 1, sunFrac: 1, comm: true } : { lit: false, sunElev: -1, sunFrac: 0, comm: true }));
  const steps = 48 * 10, small = { ...spec, batteryWh: 9000 };
  const base = stressTest(s, 0, steps, STEP_MIN, "tracking", small);
  assert.ok(base.some((c) => c.result && !c.result.survives), "the plan should be marginal");
  const o = robustOptions(s, 0, steps, STEP_MIN, "tracking", small);
  const allPass = (sp, start) => stressTest(s, start, steps, STEP_MIN, "tracking", sp).every((c) => c.result !== null && c.result.survives);
  assert.ok(o.batteryWh !== null && allPass({ ...small, batteryWh: o.batteryWh }, 0));
  assert.equal(allPass({ ...small, batteryWh: o.batteryWh - 100 }, 0), false);
  if (o.landIdx !== null) assert.ok(allPass(small, o.landIdx));
});

test("earliest landing: every half hour is checked, so a single viable start is found", async () => {
  const { earliestSurvivable } = await import("../.build/power.js");
  // dark everywhere except a lit block; a 2-day mission survives only if it starts within it
  // at starts 100-101 (one dark half hour at most), which a 6-hour scan (0, 12, 24, ...) skips
  const s = series(48 * 20, (i) => (i >= 101 && i < 101 + 96 ? { lit: true, sunElev: 1, sunFrac: 1 } : { lit: false, sunElev: -1, sunFrac: 0 }));
  const steps = 96, tiny = { ...spec, batteryWh: 125 }; // 100 Wh usable: 1 hour of darkness
  const i = earliestSurvivable(s, 0, s.length - steps, steps, STEP_MIN, "tracking", tiny);
  assert.equal(i, 100);
  for (let j = 0; j < s.length - steps; j += 12) assert.equal(simulateMission(s, j, steps, STEP_MIN, "tracking", tiny, {}, false).survives, false);
});

test("stress cases past the data are unknown, never a pass", async () => {
  const { allCasesPass } = await import("../.build/power.js");
  const s = series(48 * 12, () => ({ lit: true, sunElev: 1, sunFrac: 1, comm: true }));
  const steps = 48 * 10; // 3-day late landing would need 13 days of data
  const cases = stressTest(s, 0, steps, STEP_MIN, "tracking", spec);
  const late = cases.find((c) => c.id === "slip3d");
  assert.equal(late.result, null);
  assert.ok(cases.filter((c) => c.result).every((c) => c.result.survives));
  assert.equal(allCasesPass(cases), false);
  assert.equal(allCasesPass(stressTest(series(48 * 14, () => ({ lit: true, sunElev: 1, sunFrac: 1, comm: true })), 0, steps, STEP_MIN, "tracking", spec)), true);
});

test("CSV states the real failure reason and the requirements", async () => {
  const { missionCsv } = await import("../.build/export.js");
  const s = series(48 * 3, () => ({ lit: true, sunElev: 1, sunFrac: 1, comm: false, earthElev: -1 }));
  const req = { maxEarthOutageH: 12, reservePct: 20 };
  const r = simulateMission(s, 0, s.length, STEP_MIN, "tracking", spec, req);
  assert.equal(r.failure, "earth");
  const site = { id: "x", name: "Test", lat: -89, lon: 0, elevationM: 0, blurb: "", horizonDeg: [] };
  const csv = missionCsv({ site, samples: s, startIdx: 0, steps: s.length, soc: r.soc, mode: "tracking", spec, heightM: 0, result: r, req, stress: stressTest(s, 0, s.length, STEP_MIN, "tracking", spec, req) });
  assert.match(csv, /# result,fails: Earth hidden longer than 12 h/);
  assert.doesNotMatch(csv, /battery dies/);
  assert.match(csv, /reserve to keep 20%/);
  assert.match(csv, /longest time without Earth in view 12 h/);
  assert.match(csv, /battery charge at landing 100%/);
  assert.match(csv, /# stress cases,0 of 7 pass \(3 unknown\)/);
});
