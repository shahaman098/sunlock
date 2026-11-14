/**
 * Independent cross-check of SUNLOCK's sky geometry against JPL Horizons.
 *
 * For a set of epochs across the 2027 planning window, this compares the
 * apparent direction of the Sun and the Earth as seen from the Moon's centre:
 *   - ours: Astronomy Engine geocentric vectors, differenced to the Moon
 *   - theirs: JPL Horizons astrometric RA/Dec, observer = Moon body centre
 *
 * Output: scripts/verification.json, consumed by the app's provenance panel.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as A from "astronomy-engine";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/terrain/verification.json");

const START = "2027-01-01";
const STOP = "2027-06-30";
const STEP = "16 d";

const D = Math.PI / 180;

function parseBody(result) {
  const i = result.indexOf("$$SOE");
  const j = result.indexOf("$$EOE");
  if (i < 0 || j < 0) throw new Error("no ephemeris block");
  return result
    .slice(i + 5, j)
    .trim()
    .split("\n")
    .map((line) => {
      const m = line
        .trim()
        .match(
          /^(\d{4}-\w{3}-\d{2})\s+(\d{2}):(\d{2})\s+(\d+)\s+(\d+)\s+([\d.]+)\s+([+-]?\d+)\s+(\d+)\s+([\d.]+)/
        );
      if (!m) return null;
      const [, date, hh, mm, rah, ram, ras, dd, dm, ds] = m;
      const ra = (Number(rah) + Number(ram) / 60 + Number(ras) / 3600) * 15;
      const sign = dd.startsWith("-") ? -1 : 1;
      const dec = sign * (Math.abs(Number(dd)) + Number(dm) / 60 + Number(ds) / 3600);
      const MON = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
                    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
      const [y, mon, dd2] = date.split("-");
      return {
        iso: `${y}-${MON[mon]}-${dd2}T${hh}:${mm}:00Z`,
        ra,
        dec,
      };
    })
    .filter(Boolean);
}

async function horizons(target, center) {
  const url =
    `https://ssd.jpl.nasa.gov/api/horizons.api?format=json` +
    `&COMMAND='${target}'&OBJ_DATA='NO'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'` +
    `&CENTER='${center}'&START_TIME='${START}'&STOP_TIME='${STOP}'&STEP_SIZE='${STEP}'` +
    `&QUANTITIES='1'`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Horizons ${res.status}`);
  const j = await res.json();
  if (!j.result) throw new Error("empty Horizons response");
  return parseBody(j.result);
}

/** Unit vector -> RA/Dec in degrees. */
function radec(v) {
  const len = Math.hypot(v.x, v.y, v.z);
  const ra = (Math.atan2(v.y, v.x) / D + 360) % 360;
  const dec = Math.asin(v.z / len) / D;
  return { ra, dec };
}

function sepArcsec(a, b) {
  const r1 = a.ra * D, d1 = a.dec * D, r2 = b.ra * D, d2 = b.dec * D;
  const dot =
    Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(r1 - r2);
  return Math.acos(Math.min(1, Math.max(-1, dot))) * (180 / Math.PI) * 3600;
}

function ours(iso) {
  const date = new Date(iso);
  const sun = A.GeoVector(A.Body.Sun, date, true);
  const moon = A.GeoVector(A.Body.Moon, date, false);
  return {
    sun: radec({ x: sun.x - moon.x, y: sun.y - moon.y, z: sun.z - moon.z }),
    earth: radec({ x: -moon.x, y: -moon.y, z: -moon.z }),
  };
}

const [sunRows, earthRows] = await Promise.all([horizons("10", "@301"), horizons("399", "@301")]);

const rows = [];
for (const s of sunRows) {
  const e = earthRows.find((r) => r.iso === s.iso);
  if (!e) continue;
  const mine = ours(s.iso);
  rows.push({
    epoch: s.iso,
    sunArcsec: +sepArcsec(mine.sun, s).toFixed(2),
    earthArcsec: +sepArcsec(mine.earth, e).toFixed(2),
  });
}

const maxSun = Math.max(...rows.map((r) => r.sunArcsec));
const maxEarth = Math.max(...rows.map((r) => r.earthArcsec));

const out = {
  generated: new Date().toISOString(),
  source: "JPL Horizons API (ssd-api.jpl.nasa.gov), astrometric RA/Dec, observer = Moon body centre",
  epochs: rows.length,
  maxSunArcsec: +maxSun.toFixed(2),
  maxEarthArcsec: +maxEarth.toFixed(2),
  maxSunDeg: +(maxSun / 3600).toFixed(4),
  maxEarthDeg: +(maxEarth / 3600).toFixed(4),
  rows,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(
  `cross-checked ${rows.length} epochs: max Sun ${maxSun.toFixed(1)}" (${out.maxSunDeg}°), ` +
  `max Earth ${maxEarth.toFixed(1)}" (${out.maxEarthDeg}°)`
);
