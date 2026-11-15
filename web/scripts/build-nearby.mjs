/**
 * Full LOLA LDEM_80S_80M skylines (converged convention, 150 km, curvature) at the nearby
 * positions the stress card may offer: 1 and 2 km from each current Artemis III site in 8
 * directions. Computed exactly like the named sites' own skylines, so a nearby position is
 * judged on the same terrain model as the site it is compared with.
 *
 * Why not adjust the site's skyline with our coarse grid instead: scripts/validate-nearby.mjs
 * showed that shortcut overstates sunlight by 9.6 points on average (18 points RMS) against the
 * full skyline at the same point, and only 35% of the positions it would offer passed with the
 * full skyline.
 *
 * Output: web/public/terrain/nearby.json. Run: npm run nearby
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDem, horizonProfile } from "../../scripts/lib/horizon.mjs";
import { offsetPoint } from "../.build/terrain.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, "web/public/terrain/sites.json"), "utf8"));
const dem = loadDem(path.join(ROOT, "data/raw/ldem_80s_80m.img"));
const DIRS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

const out = {};
for (const s of meta.sites.filter((x) => x.current !== false)) {
  // sanity: the shared code reproduces the shipped skyline at the site itself
  const self = horizonProfile(dem, s.lat, s.lon, "converged");
  const err = Math.max(...s.horizonDeg.map((h, i) => Math.abs(h - self.prof[i])));
  if (err > 0.011) throw new Error(`${s.id}: site skyline differs by ${err.toFixed(3)} deg`);
  out[s.id] = [];
  for (const km of [1, 2]) {
    DIRS.forEach((dir, k) => {
      const p = offsetPoint(s.lat, s.lon, k * 45, km * 1000);
      const lat = Number(p.lat.toFixed(5)), lon = Number(p.lon.toFixed(5));
      const h = horizonProfile(dem, lat, lon, "converged");
      if (!h) return;
      out[s.id].push({ km, dir, lat, lon, elevationM: Math.round(h.elevationM), horizonDeg: Array.from(h.prof, (v) => +v.toFixed(2)) });
    });
  }
  process.stderr.write(`${s.id} `);
}
const file = path.join(ROOT, "web/public/terrain/nearby.json");
fs.writeFileSync(file, JSON.stringify({ source: "LOLA LDEM_80S_80M, converged convention (40 m bilinear steps, 150 km, curvature)", generated: new Date().toISOString(), sites: out }));
console.log(`\nwrote ${path.relative(ROOT, file)} (${(fs.statSync(file).size / 1e3).toFixed(0)} kB)`);
