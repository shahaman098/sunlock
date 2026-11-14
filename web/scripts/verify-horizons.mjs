/**
 * Independent cross-check of SUNLOCK against JPL Horizons.
 *
 * Two separate questions:
 *
 *   1. GEOMETRY — are the Sun and Earth in the right direction as seen from the
 *      Moon? Compared with Horizons astrometric RA/Dec (observer = Moon centre).
 *
 *   2. FRAME — is our lunar body-fixed frame the same frame Horizons uses?
 *      Compared with Horizons sub-observer and sub-solar longitude/latitude
 *      (quantities 14 and 15). This tests the IAU rotation model, not just the
 *      ephemeris, and it runs against the module the app ships (`.build/selene.js`).
 *
 * Run: npm run verify
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as A from "astronomy-engine";
import { skyAt } from "../.build/selene.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "../public/terrain/verification.json");

const START = "2027-01-01";
const STOP = "2027-06-30";
const STEP = "16 d";
const D = Math.PI / 180;

const MON = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
              Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function horizons(command, center, quantities) {
  const url =
    "https://ssd.jpl.nasa.gov/api/horizons.api?format=json" +
    "&OBJ_DATA='NO'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'" +
    `&START_TIME='${START}'&STOP_TIME='${STOP}'&STEP_SIZE='${STEP}'` +
    `&COMMAND='${command}'&CENTER='${center}'&QUANTITIES='${quantities}'`;

  // Horizons throttles; retry with backoff rather than failing the whole check.
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 503 || res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
      if (!res.ok) throw new Error(`Horizons HTTP ${res.status}`);
      const j = await res.json();
      if (!j.result) throw new Error("empty Horizons response");
      const i = j.result.indexOf("$$SOE");
      const k = j.result.indexOf("$$EOE");
      if (i < 0 || k < 0) throw new Error("no ephemeris block");
      return j.result.slice(i + 5, k).trim().split("\n").map((l) => l.trim());
    } catch (err) {
      lastErr = err;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr;
}

const isoDate = ([y, mon, d]) => `${y}-${MON[mon]}-${d}`;

function parseRaDec(lines) {
  return lines.map((line) => {
    const m = line.match(
      /^(\d{4}-\w{3}-\d{2})\s+(\d{2}):(\d{2})\s+(\d+)\s+(\d+)\s+([\d.]+)\s+([+-]?\d+)\s+(\d+)\s+([\d.]+)/
    );
    if (!m) return null;
    const [, date, hh, mm, rah, ram, ras, dd, dm, ds] = m;
    const ra = (Number(rah) + Number(ram) / 60 + Number(ras) / 3600) * 15;
    const sign = dd.startsWith("-") ? -1 : 1;
    const dec = sign * (Math.abs(Number(dd)) + Number(dm) / 60 + Number(ds) / 3600);
    return { iso: `${isoDate(date.split("-"))}T${hh}:${mm}:00Z`, ra, dec };
  }).filter(Boolean);
}

function parseSubPoints(lines) {
  return lines.map((line) => {
    const m = line.match(
      /^(\d{4}-\w{3}-\d{2})\s+(\d{2}):(\d{2})\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/
    );
    if (!m) return null;
    const [, date, hh, mm, obsLon, obsLat, sunLon, sunLat] = m;
    return {
      iso: `${isoDate(date.split("-"))}T${hh}:${mm}:00Z`,
      obsLon: Number(obsLon), obsLat: Number(obsLat),
      sunLon: Number(sunLon), sunLat: Number(sunLat),
    };
  }).filter(Boolean);
}

function radecOf(v) {
  const len = Math.hypot(v.x, v.y, v.z);
  return { ra: ((Math.atan2(v.y, v.x) / D) + 360) % 360, dec: Math.asin(v.z / len) / D };
}

function separationArcsec(a, b) {
  const r1 = a.ra * D, d1 = a.dec * D, r2 = b.ra * D, d2 = b.dec * D;
  const dot = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(r1 - r2);
  return Math.acos(Math.min(1, Math.max(-1, dot))) * (180 / Math.PI) * 3600;
}

/** Our J2000 direction of the Sun and Earth from the Moon (same construction the app uses). */
function ourGeometry(date) {
  const sun = A.GeoVector(A.Body.Sun, date, true);
  const moon = A.GeoVector(A.Body.Moon, date, false);
  return {
    sun: radecOf({ x: sun.x - moon.x, y: sun.y - moon.y, z: sun.z - moon.z }),
    earth: radecOf({ x: -moon.x, y: -moon.y, z: -moon.z }),
  };
}

const wrap180 = (x) => ((x + 540) % 360) - 180;
const max = (rows, fn) => Math.max(...rows.map(fn));

// Sequential, with a pause — Horizons returns 503 on bursts.
const sunRows = await horizons("10", "@301", "1");
await sleep(1200);
const earthRows = await horizons("399", "@301", "1");
await sleep(1200);
const subRows = await horizons("301", "500@399", "14,15");

const sun = parseRaDec(sunRows);
const earth = parseRaDec(earthRows);
const subs = parseSubPoints(subRows);

const rows = [];
for (const s of sun) {
  const e = earth.find((r) => r.iso === s.iso);
  const sp = subs.find((r) => r.iso === s.iso);
  if (!e || !sp) continue;

  const date = new Date(s.iso);
  const geo = ourGeometry(date);
  const sky = skyAt(date); // shipped module, compiled from src/lib/selene.ts

  rows.push({
    epoch: s.iso,
    geometryArcsec: {
      sun: +separationArcsec(geo.sun, s).toFixed(1),
      earth: +separationArcsec(geo.earth, e).toFixed(1),
    },
    frameDeg: {
      earthLon: +Math.abs(wrap180(sky.subEarth.lon - sp.obsLon)).toFixed(4),
      earthLat: +Math.abs(sky.subEarth.lat - sp.obsLat).toFixed(4),
      sunLon: +Math.abs(wrap180(sky.subSun.lon - sp.sunLon)).toFixed(4),
      sunLat: +Math.abs(sky.subSun.lat - sp.sunLat).toFixed(4),
    },
  });
}

const summary = {
  generated: new Date().toISOString(),
  source: "JPL Horizons API (ssd-api.jpl.nasa.gov) — astrometric RA/Dec, sub-observer and sub-solar lon/lat",
  epochs: rows.length,
  geometry: {
    maxSunArcsec: max(rows, (r) => r.geometryArcsec.sun),
    maxEarthArcsec: max(rows, (r) => r.geometryArcsec.earth),
  },
  frame: {
    maxEarthLonDeg: max(rows, (r) => r.frameDeg.earthLon),
    maxEarthLatDeg: max(rows, (r) => r.frameDeg.earthLat),
    maxSunLonDeg: max(rows, (r) => r.frameDeg.sunLon),
    maxSunLatDeg: max(rows, (r) => r.frameDeg.sunLat),
  },
  rows,
};

fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
console.log(`geometry  max Sun ${summary.geometry.maxSunArcsec}"  max Earth ${summary.geometry.maxEarthArcsec}"`);
console.log(`frame     max |Δlon| ${summary.frame.maxSunLonDeg}°  max |Δlat| ${summary.frame.maxSunLatDeg}°`);
