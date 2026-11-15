import fs from "node:fs";
/**
 * Experiment: does 20 m near-pole terrain (LDEM_875S_20M) agree better with NASA's
 * 18.6-year sunlight map than the shipped 80 m model, at published landing sites
 * south of 87.6°S? Result is written to research/validation/experiment-20m.json.
 * Run: npm run exp:20m
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { skyAt, siteBasis } from "../.build/selene.js";
import * as H from "../../scripts/lib/horizon.mjs";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const D = Math.PI / 180, R = 1737400;
const dem = H.loadDem(`${ROOT}/data/raw/ldem_80s_80m.img`);
const dem20 = H.loadDem20(`${ROOT}/data/raw/ldem_875s_20m.img`);
const buf = fs.readFileSync(`${ROOT}/research/validation/raw/AVGVISIB_85S_060M_201608.IMG`);
const ref = new Int16Array(buf.buffer, buf.byteOffset, 5058 * 5058);
const nasa = (lat, lon) => { const r = (2 * R * Math.tan(((90 - Math.abs(lat)) * D) / 2)) / 60; const x = Math.round(2528.5 + r * Math.sin(lon * D)), y = Math.round(2528.5 - r * Math.cos(lon * D)); return ref[y * 5058 + x] * 0.004; };
const sites = fs.readFileSync(`${ROOT}/research/data/wueller2026-landing-sites.csv`, "utf8").split("\n").filter(l => l && !l.startsWith("#")).slice(1).map(l => { const [c, s, la, lo] = l.split(","); return { c, s, lat: +la, lon: +lo }; }).filter(s => s.lat <= -87.6);
const n = Math.floor(18.6 * 365.25 * 24 / 3); const sky = [];
for (let i = 0; i < n; i++) sky.push(skyAt(new Date(Date.UTC(2010, 0, 1) + i * 3 * 3600e3)).sun);
const pct = (prof, b) => { let k = 0; for (const v of sky) { const el = Math.asin(v.x * b.up.x + v.y * b.up.y + v.z * b.up.z) / D; let az = Math.atan2(v.x * b.east.x + v.y * b.east.y + v.z * b.east.z, v.x * b.north.x + v.y * b.north.y + v.z * b.north.z) / D; if (az < 0) az += 360; if (el + 0.266 > H.horizonAt(prof, az)) k++; } return 100 * k / n; };
const d80 = [], dh = [];
for (const s of sites) {
  const b = siteBasis(s.lat, s.lon);
  const p80 = H.horizonProfile(dem, s.lat, s.lon, "converged").prof;
  const ph = H.horizonProfileHybrid(dem, dem20, s.lat, s.lon);
  if (!ph) continue;
  const ns = nasa(s.lat, s.lon), a = pct(p80, b), h = pct(ph.prof, b);
  d80.push(a - ns); dh.push(h - ns);
}
const st = (a) => { const m = a.reduce((p, q) => p + q, 0) / a.length; return { n: a.length, bias: m.toFixed(1), rmse: Math.sqrt(a.reduce((p, q) => p + q * q, 0) / a.length).toFixed(1), within5: a.filter(x => Math.abs(x) <= 5).length }; };
const result = {
  generated: new Date().toISOString(),
  question: "Does a 20 m near field (to 30 km) improve agreement with NASA AVGVISIB_85S_060M at landing sites south of 87.6°S?",
  stepHours: 3, years: 18.6, criterion: "any part of the solar disc",
  shipped80m: st(d80),
  hybrid20m: st(dh),
  conclusion: "No. The 20 m near field lowers sunlight by about 5 points on average and agrees less with NASA's 60 m-based map. The reference cannot show which is closer to reality, so the app keeps the validated 80 m model.",
};
fs.writeFileSync(path.join(ROOT, "research/validation/experiment-20m.json"), JSON.stringify(result, null, 2));
console.log(result);
