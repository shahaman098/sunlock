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

test("site finder: each kept spot sits where its numbers come from, and no kept spot makes another redundant", () => {
  const meta = JSON.parse(fs.readFileSync(new URL("../public/terrain/finder.json", import.meta.url)));
  const buf = fs.readFileSync(new URL("../public/terrain/finder.bin", import.meta.url));
  const { n, spots, bytesPerCandidate: B, cellM, halfM, pixM, off } = meta;
  assert.equal(meta.layout, "pareto-v1");
  assert.equal(buf.length, 4 * (n * n + 1) + spots * B);
  const index = new Uint32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + 4 * (n * n + 1)));
  const bin = buf.subarray(4 * (n * n + 1));
  assert.equal(index[n * n], spots);
  // the NASA sunlight raster the finder was built from, if this machine has it
  const raw = new URL("../../research/validation/raw/AVGVISIB_85S_060M_201608.IMG", import.meta.url);
  const nasa = fs.existsSync(raw) ? new Int16Array(fs.readFileSync(raw).buffer) : null;
  const cls = (o) => [Math.floor(bin[o] / 5), Math.floor(bin[o + 1] / 5), Math.ceil(bin[o + 2] / 4), bin[o + 3] === 255 ? 99 : Math.ceil(bin[o + 3] / 10)];
  const rank = (o) => bin[o] * 65536 + bin[o + 1] * 256 + (255 - bin[o + 2]);
  let checked = 0, multi = 0;
  for (let j = 7; j < n; j += 23) {
    for (let i = 5; i < n; i += 19) {
      const c0 = j * n + i, s0 = index[c0], s1 = index[c0 + 1];
      assert.ok(s1 >= s0);
      if (s1 - s0 > 1) multi++;
      for (let s = s0; s < s1; s++) {
        const o = s * B;
        // the stored pixel lies inside its own cell
        const a = Math.floor(off + (-halfM + i * cellM) / pixM) + bin[o + 4];
        const b = Math.floor(off + (-halfM + j * cellM) / pixM) + bin[o + 5];
        const xm = (a + 0.5 - off) * pixM, ym = (b + 0.5 - off) * pixM;
        assert.ok(xm >= -halfM + i * cellM - pixM && xm <= -halfM + (i + 1) * cellM + pixM, "x inside cell");
        assert.ok(ym >= -halfM + j * cellM - pixM && ym <= -halfM + (j + 1) * cellM + pixM, "y inside cell");
        if (nasa) assert.equal(bin[o], Math.round(100 * nasa[b * (2 * off + 1) + a] * 0.00004), `cell ${i},${j} spot ${s}`);
        // no other kept spot passes every limit this one passes while ranking at least as high
        const cs = cls(o);
        for (let t = s0; t < s1; t++) {
          if (t === s) continue;
          const ct = cls(t * B);
          const dominates = ct[0] >= cs[0] && ct[1] >= cs[1] && ct[2] <= cs[2] && ct[3] <= cs[3] && rank(t * B) >= rank(o);
          assert.ok(!dominates, `cell ${i},${j}: spot ${s} is redundant`);
        }
        checked++;
      }
    }
  }
  assert.ok(checked > 500, `checked ${checked}`);
  assert.ok(multi > 100, "many cells keep several trade-off spots");
});
