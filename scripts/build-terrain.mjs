/**
 * Build terrain assets from the LRO LOLA polar DEM (LDEM_80S_80M.IMG).
 *
 * Source: NASA PDS Geosciences Node, LRO-L-LOLA-4-GDR-V1.0,
 *         product LDEM_80S_80M, 80 m/pixel, south polar stereographic,
 *         planetocentric latitude, HEIGHT = DN * 0.5 m relative to a 1737.4 km sphere.
 *
 * Outputs (web/public/terrain):
 *   hillshade.png  - overview relief for the app basemap
 *   shadowgrid.bin - per-pixel terrain horizon by azimuth, for real-time shadows
 *   sites.json     - horizon profiles + elevation for candidate landing regions
 *
 * All azimuths are geographic: 0 deg = grid north (toward the pole), 90 deg = east.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "data/raw/ldem_80s_80m.img");
const OUT = path.join(ROOT, "web/public/terrain");
fs.mkdirSync(OUT, { recursive: true });

const N = 7600;
const PIX_M = 80;
const R_MOON_M = 1737400;
const CENTER = (N - 1) / 2;
const M_PER_DN = 0.5;
const COVER = 3800; // pixels from centre with valid data

const buf = fs.readFileSync(SRC);
if (buf.length !== N * N * 2) throw new Error(`unexpected size ${buf.length}`);
const dem = new Int16Array(buf.buffer, buf.byteOffset, N * N);

const D = Math.PI / 180;

/** lat/lon (deg, planetocentric, east-positive) -> fractional pixel */
function project(lat, lon) {
  const colat = (90 - Math.abs(lat)) * D;
  const r = (2 * R_MOON_M * Math.tan(colat / 2)) / PIX_M;
  const a = lon * D;
  return { x: CENTER + r * Math.sin(a), y: CENTER - r * Math.cos(a) };
}

/** pixel -> lat/lon */
function unproject(x, y) {
  const dx = x - CENTER;
  const dy = y - CENTER;
  const rM = Math.hypot(dx, dy) * PIX_M;
  const colat = 2 * Math.atan(rM / (2 * R_MOON_M));
  const lat = -(90 - colat / D);
  let lon = Math.atan2(dx, -dy) / D;
  if (lon < 0) lon += 360;
  return { lat, lon };
}

function elevAt(x, y) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= N || yi >= N) return null;
  return dem[yi * N + xi] * M_PER_DN;
}

/**
 * Horizon elevation (degrees) looking along geographic azimuth `az`.
 * In this image geographic north (away from the pole) is (sin lon, -cos lon) and
 * east is (cos lon, sin lon); combining them gives (sin(az+lon), -cos(az+lon)).
 */
function horizonAlong(x, y, lon, az, maxSteps, stepPx) {
  const e0 = elevAt(x, y);
  if (e0 === null) return 0;
  // geographic azimuth -> image direction: north (az 0) is (sin lon, -cos lon), east is (cos lon, sin lon), consistent with project() above.
  // Checked against NASA's LOLA maps (PGDA product 69): the Sun map fixes north/south
  // (an earlier 180-degree error) and the Earth map fixes east/west, which the Sun map
  // cannot see because solar elevation is symmetric about the site's meridian.
  const a = (az + lon) * D;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  let best = -1e9;
  let px = x;
  let py = y;
  for (let k = 1; k <= maxSteps; k++) {
    px += dx * stepPx;
    py += dy * stepPx;
    const xi = Math.round(px);
    const yi = Math.round(py);
    if (xi < 0 || yi < 0 || xi >= N || yi >= N) break;
    const d = k * stepPx * PIX_M;
    // apparent height drop from the Moon's curvature
    const drop = (d * d) / (2 * R_MOON_M);
    const slope = (dem[yi * N + xi] * M_PER_DN - e0 - drop) / d;
    if (slope > best) best = slope;
  }
  if (best === -1e9) return 0;
  return Math.atan(best) / D;
}

function selftest() {
  const probes = [
    ["Malapert Massif (86.0S, 0E) should be high", 86.0, 0],
    ["Cabeus crater floor (84.9S, 35.5W) should be low", 84.9, -35.5],
  ];
  for (const [label, la, lo] of probes) {
    const { x, y } = project(la, lo);
    console.error(`${label} -> ${elevAt(x, y)} m`);
  }
  const m = elevAt(...Object.values(project(86, 0)));
  const c = elevAt(...Object.values(project(84.9, -35.5)));
  if (!(m > c)) throw new Error("projection orientation failed");
  // round-trip check
  const p = project(-89.5, 123.4);
  const back = unproject(p.x, p.y);
  console.error(`round-trip: -89.500,123.400 -> ${back.lat.toFixed(3)},${back.lon.toFixed(3)}`);
}

selftest();

// ---------------------------------------------------------------- hillshade
const OV = 2048;
const step = N / OV;
const elev = new Float32Array(OV * OV);
for (let y = 0; y < OV; y++) {
  for (let x = 0; x < OV; x++) {
    const rx = (x + 0.5) * step - CENTER;
    const ry = (y + 0.5) * step - CENTER;
    if (Math.hypot(rx, ry) > COVER) { elev[y * OV + x] = NaN; continue; }
    const block = 4;
    let sum = 0, n = 0;
    const x0 = Math.floor(x * step), y0 = Math.floor(y * step);
    for (let dy = 0; dy < block; dy++) {
      const yy = y0 + dy;
      if (yy >= N) break;
      for (let dx = 0; dx < block; dx++) {
        const xx = x0 + dx;
        if (xx >= N) break;
        sum += dem[yy * N + xx]; n++;
      }
    }
    elev[y * OV + x] = n ? (sum / n) * M_PER_DN : NaN;
  }
}

let lo = Infinity, hi = -Infinity;
for (const v of elev) { if (!Number.isNaN(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
console.error(`elevation range: ${lo.toFixed(0)} .. ${hi.toFixed(0)} m`);

const PX_PER_M = 1 / (PIX_M * step);
const AZ_LIGHT = 300 * D, ALT_LIGHT = 25 * D;
const lx = Math.cos(ALT_LIGHT) * Math.sin(AZ_LIGHT);
const ly = Math.cos(ALT_LIGHT) * Math.cos(AZ_LIGHT);
const lz = Math.sin(ALT_LIGHT);

const rgb = Buffer.alloc(OV * OV * 3);
for (let y = 0; y < OV; y++) {
  for (let x = 0; x < OV; x++) {
    const v = elev[y * OV + x];
    const i = (y * OV + x) * 3;
    if (Number.isNaN(v)) { rgb[i] = rgb[i + 1] = rgb[i + 2] = 5; continue; }
    const xl = Math.max(0, x - 1), xr = Math.min(OV - 1, x + 1);
    const yu = Math.max(0, y - 1), yd = Math.min(OV - 1, y + 1);
    const dzdx = (elev[y * OV + xr] - elev[y * OV + xl]) / ((xr - xl) / PX_PER_M);
    const dzdy = (elev[yd * OV + x] - elev[yu * OV + x]) / ((yd - yu) / PX_PER_M);
    let sh = 0.5;
    if (Number.isFinite(dzdx) && Number.isFinite(dzdy)) {
      const nx = -dzdx, ny = -dzdy, nz = 1;
      const L = Math.hypot(nx, ny, nz);
      sh = Math.max(0, Math.min(1, 0.16 + 0.98 * ((nx * lx + ny * ly + nz * lz) / L)));
    }
    const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
    const base = 40 + 185 * t;
    rgb[i] = Math.min(255, base * (0.5 + 0.7 * sh) * 0.92);
    rgb[i + 1] = Math.min(255, base * (0.5 + 0.7 * sh) * 0.95);
    rgb[i + 2] = Math.min(255, base * (0.5 + 0.7 * sh) * 1.02);
  }
}

let crcTable = null;
function crc32(b) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}
function png(width, height, rgbBuf) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgbBuf.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}
const pngPath = path.join(OUT, "hillshade.png");
fs.writeFileSync(pngPath, png(OV, OV, rgb));
console.error("wrote hillshade.png");

// The app loads hillshade.jpg. Convert with sips (macOS); otherwise the PNG stays and
// the app will not find its basemap, so say so loudly.
try {
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "82", pngPath, "--out", path.join(OUT, "hillshade.jpg")], { stdio: "ignore" });
  fs.unlinkSync(pngPath);
  console.error("wrote hillshade.jpg (converted with sips)");
} catch {
  console.error("WARNING: could not convert hillshade.png to hillshade.jpg (sips unavailable).");
  console.error("         Run: sips -s format jpeg -s formatOptions 82 " + pngPath + " --out " + path.join(OUT, "hillshade.jpg"));
}

// ------------------------------------------------------------ shadow grid
const G = 384;
const AZ = 16;
const gstep = N / G;
const horizon = new Uint8Array(G * G * AZ);

for (let y = 0; y < G; y++) {
  for (let x = 0; x < G; x++) {
    const gx = (x + 0.5) * gstep;
    const gy = (y + 0.5) * gstep;
    if (Math.hypot(gx - CENTER, gy - CENTER) > COVER) continue;
    const { lon } = unproject(gx, gy);
    for (let a = 0; a < AZ; a++) {
      const az = (a * 360) / AZ;
      const deg = horizonAlong(gx, gy, lon, az, 120, 2);
      // encode degrees as (deg + 32) * 4 so negative horizons survive in a byte
      horizon[(y * G + x) * AZ + a] = Math.max(0, Math.min(255, Math.round(deg * 4 + 128)));
    }
  }
}
fs.writeFileSync(path.join(OUT, "shadowgrid.bin"), Buffer.from(horizon.buffer));
console.error("wrote shadowgrid.bin");

// ------------------------------------------------------- elevation grid (custom points)
// 1024^2 signed metres, bilinear-block averaged. Used to derive a horizon profile at any
// point the user clicks, so analysis is not limited to the preset regions.
const EG = 1024;
const egStep = N / EG;
const egrid = new Int16Array(EG * EG);
{
  const block = Math.max(1, Math.floor(egStep));
  for (let y = 0; y < EG; y++) {
    for (let x = 0; x < EG; x++) {
      const gx = (x + 0.5) * egStep;
      const gy = (y + 0.5) * egStep;
      if (Math.hypot(gx - CENTER, gy - CENTER) > COVER) { egrid[y * EG + x] = 0; continue; }
      let sum = 0, n = 0;
      const x0 = Math.floor(x * egStep), y0 = Math.floor(y * egStep);
      for (let dy = 0; dy < block; dy++) {
        const yy = y0 + dy;
        if (yy >= N) break;
        for (let dx = 0; dx < block; dx++) {
          const xx = x0 + dx;
          if (xx >= N) break;
          sum += dem[yy * N + xx]; n++;
        }
      }
      egrid[y * EG + x] = n ? Math.round((sum / n) * M_PER_DN) : 0;
    }
  }
}
fs.writeFileSync(path.join(OUT, "elevgrid.bin"), Buffer.from(egrid.buffer));
console.error(`wrote elevgrid.bin (${EG}x${EG}, ${((EG * EG * 2) / 1e6).toFixed(1)} MB)`);
console.error("wrote shadowgrid.bin");

// ------------------------------------------------------------ sites
// Landing sites are no longer chosen here. web/scripts/select-sites.mjs (npm run sites)
// evaluates the 130 published sites of Wueller et al. (2026) for NASA's Artemis III
// regions with the shared horizon code (scripts/lib/horizon.mjs) and fills `sites`.
// This script only (re)writes the grid metadata and keeps any sites already present.
{
  const sitesPath = path.join(OUT, "sites.json");
  const prev = fs.existsSync(sitesPath) ? JSON.parse(fs.readFileSync(sitesPath, "utf8")) : {};
  fs.writeFileSync(sitesPath, JSON.stringify({
    ...prev,
    source: "LRO LOLA LDEM_80S_80M (NASA PDS Geosciences Node)",
    moonRadiusM: R_MOON_M,
    grid: { size: N, pixM: PIX_M },
    overview: { size: OV },
    shadow: { size: G, azimuthBins: AZ },
    elevation: { size: 1024, pixM: (N * PIX_M) / 1024 },
    sites: prev.sites ?? [],
  }));
  console.error("wrote sites.json metadata (run `npm run sites` in web/ to fill sites)");
}
