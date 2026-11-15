/**
 * Notable lunar landings, for comparison with the Artemis III candidate regions.
 *
 * Coordinates are published landing positions (NASA NSSDC / LROC for Apollo and CLPS,
 * the agencies' published values for the others). Inside our 80 m LOLA terrain
 * (80-90 deg S) the horizon is ray-marched from the terrain exactly as for the Artemis
 * sites; elsewhere the horizon is the edge of the lunar sphere (0 deg), which the app
 * states plainly, since we do not carry a global terrain model.
 *
 * Run: npm run missions   (writes web/public/terrain/missions.json)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDem, horizonProfile } from "../../scripts/lib/horizon.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

// lat (deg, + north), lon (deg, + east)
const MISSIONS = [
  { id: "apollo-11", name: "Apollo 11", group: "Apollo", agency: "NASA", year: 1969, lat: 0.6741, lon: 23.473, where: "Mare Tranquillitatis", src: "NASA NSSDC" },
  { id: "apollo-12", name: "Apollo 12", group: "Apollo", agency: "NASA", year: 1969, lat: -3.0124, lon: -23.4216, where: "Oceanus Procellarum", src: "NASA NSSDC" },
  { id: "apollo-14", name: "Apollo 14", group: "Apollo", agency: "NASA", year: 1971, lat: -3.6453, lon: -17.4714, where: "Fra Mauro", src: "NASA NSSDC" },
  { id: "apollo-15", name: "Apollo 15", group: "Apollo", agency: "NASA", year: 1971, lat: 26.1322, lon: 3.6339, where: "Hadley–Apennine", src: "NASA NSSDC" },
  { id: "apollo-16", name: "Apollo 16", group: "Apollo", agency: "NASA", year: 1972, lat: -8.973, lon: 15.5002, where: "Descartes Highlands", src: "NASA NSSDC" },
  { id: "apollo-17", name: "Apollo 17", group: "Apollo", agency: "NASA", year: 1972, lat: 20.1908, lon: 30.7717, where: "Taurus–Littrow", src: "NASA NSSDC" },
  { id: "im-1", name: "IM-1 Odysseus", group: "CLPS and commercial", agency: "Intuitive Machines / NASA CLPS", year: 2024, lat: -80.13, lon: 1.44, where: "near Malapert A, south pole", src: "NASA LRO image release" },
  { id: "im-2", name: "IM-2 Athena (target)", group: "CLPS and commercial", agency: "Intuitive Machines / NASA CLPS", year: 2025, lat: -84.78, lon: 29.13, where: "Mons Mouton, south pole", src: "LROC (intended site; landed ~250-400 m away in a crater)" },
  { id: "blue-ghost-1", name: "Blue Ghost Mission 1", group: "CLPS and commercial", agency: "Firefly / NASA CLPS", year: 2025, lat: 18.56, lon: 61.81, where: "Mare Crisium, near Mons Latreille", src: "LROC" },
  { id: "chandrayaan-3", name: "Chandrayaan-3", group: "Other countries", agency: "ISRO", year: 2023, lat: -69.373, lon: 32.319, where: "southern highlands", src: "ISRO" },
  { id: "slim", name: "SLIM", group: "Other countries", agency: "JAXA", year: 2024, lat: -13.316, lon: 25.251, where: "near Shioli crater", src: "JAXA" },
  { id: "change-4", name: "Chang'e 4", group: "Other countries", agency: "CNSA", year: 2019, lat: -45.4446, lon: 177.5991, where: "Von Kármán crater, far side", src: "published landing position" },
  { id: "change-6", name: "Chang'e 6", group: "Other countries", agency: "CNSA", year: 2024, lat: -41.6385, lon: -153.9852, where: "Apollo basin, far side", src: "published landing position" },
  // Planned missions: no exact landing point has been published for any of these (checked
  // 15 Nov 2026), so each marks the named target area and says so.
  { id: "griffin-1", name: "Griffin Mission One (area)", group: "Planned: target areas", agency: "Astrobotic / NASA CLPS", year: "planned", lat: -84.6, lon: 31.0, where: "Nobile crater region near Mons Mouton", src: "approximate: Mons Mouton area; Astrobotic has not published the exact point", approx: true },
  { id: "blue-moon-mk1", name: "Blue Moon MK1 (area)", group: "Planned: target areas", agency: "Blue Origin", year: "planned", lat: -89.527, lon: 205.41, where: "Shackleton connecting ridge", src: "approximate: a published landing spot on the connecting ridge (Wueller et al. 2026, site CR01) stands in for Blue Origin's undisclosed point", approx: true },
  { id: "change-7", name: "Chang'e 7 (area)", group: "Planned: target areas", agency: "CNSA", year: "planned", lat: -88.8, lon: 123.4, where: "rim of Shackleton crater", src: "approximate: reported, not confirmed by CNSA", approx: true },
  { id: "im-3", name: "IM-3 (area)", group: "Planned: target areas", agency: "Intuitive Machines / NASA CLPS", year: "planned", lat: 7.5, lon: -59.0, where: "Reiner Gamma swirl", src: "approximate: centre of the Reiner Gamma feature; the exact point is not published", approx: true },
];

const dem = loadDem(path.join(ROOT, "data/raw/ldem_80s_80m.img"));

const out = MISSIONS.map((m) => {
  const terrain = m.lat <= -80;
  let horizonDeg = new Array(360).fill(0);
  let elevationM = null;
  if (terrain) {
    const hz = horizonProfile(dem, m.lat, m.lon, "converged");
    horizonDeg = Array.from(hz.prof, (v) => +v.toFixed(2));
    elevationM = Math.round(hz.elevationM);
  }
  const lon360 = m.lon < 0 ? +(m.lon + 360).toFixed(4) : m.lon;
  return {
    id: m.id,
    name: m.name,
    group: m.group,
    mission: true,
    current: false,
    lat: m.lat,
    lon: lon360,
    elevationM: elevationM ?? 0,
    terrain,
    approx: !!m.approx,
    blurb: `${m.agency}, ${m.year === "planned" ? "planned" : m.year}: ${m.where}. ${
      terrain
        ? `Inside our south-pole terrain map, so the horizon is real LOLA terrain${
            m.lat > -81 ? ` (it sits ${Math.round((Math.abs(m.lat) - 80) * 30.3)} km from the map's 80°S edge, so hills further north are left out and sunlight may be overstated)` : ""
          }.`
        : "Outside our south-pole terrain map, so the horizon here is the edge of the lunar sphere (no hills). Near the equator the Sun climbs high, so hills shift sunrise and sunset by hours rather than days."
    } Position: ${m.src}.`,
    horizonDeg,
  };
});

const file = path.join(ROOT, "web/public/terrain/missions.json");
fs.writeFileSync(file, JSON.stringify({ source: "web/scripts/build-missions.mjs", missions: out }));
for (const m of out) console.log(m.name.padEnd(24), m.lat.toFixed(3).padStart(8), String(m.lon).padStart(9), m.terrain ? `terrain, max horizon ${Math.max(...m.horizonDeg).toFixed(2)} deg, ${m.elevationM} m` : "sphere");
console.log(`wrote ${out.length} missions to ${path.relative(ROOT, file)}`);
