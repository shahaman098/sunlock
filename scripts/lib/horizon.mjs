/**
 * Shared terrain-horizon code for the LOLA LDEM_80S_80M product.
 *
 * Used by scripts/build-terrain.mjs (app assets) and web/scripts/select-sites.mjs
 * (site selection), so the two cannot drift apart. The validator
 * (web/scripts/validate-lola.mjs) implements the same "converged" convention.
 *
 * Conventions:
 *   shipped   — nearest-neighbour samples every 160 m out to 64 km
 *   converged — bilinear samples every 40 m out to 150 km (scores r = 0.995
 *               against NASA's 18.6-year LOLA visibility map)
 */
import fs from "node:fs";

export const N = 7600;
export const PIX_M = 80;
export const R_MOON_M = 1737400;
export const CENTER = (N - 1) / 2;
export const M_PER_DN = 0.5;
const D = Math.PI / 180;

export function loadDem(file) {
  const buf = fs.readFileSync(file);
  if (buf.length !== N * N * 2) throw new Error(`${file}: unexpected size ${buf.length}`);
  return new Int16Array(buf.buffer, buf.byteOffset, N * N);
}

/** lat/lon (deg, planetocentric, east-positive) -> fractional pixel */
export function project(lat, lon) {
  const colat = (90 - Math.abs(lat)) * D;
  const r = (2 * R_MOON_M * Math.tan(colat / 2)) / PIX_M;
  const a = lon * D;
  return { x: CENTER + r * Math.sin(a), y: CENTER - r * Math.cos(a) };
}

/** pixel -> lat/lon (lon in 0..360) */
export function unproject(x, y) {
  const dx = x - CENTER;
  const dy = y - CENTER;
  const rM = Math.hypot(dx, dy) * PIX_M;
  const colat = 2 * Math.atan(rM / (2 * R_MOON_M));
  const lat = -(90 - colat / D);
  let lon = Math.atan2(dx, -dy) / D;
  if (lon < 0) lon += 360;
  return { lat, lon };
}

export function sampler(dem) {
  const nearest = (x, y) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= N || yi >= N) return null;
    return dem[yi * N + xi] * M_PER_DN;
  };
  const bilinear = (x, y) => {
    if (x < 0 || y < 0 || x >= N - 1 || y >= N - 1) return null;
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const p00 = dem[yi * N + xi], p10 = dem[yi * N + xi + 1];
    const p01 = dem[(yi + 1) * N + xi], p11 = dem[(yi + 1) * N + xi + 1];
    return (p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy) * M_PER_DN;
  };
  return { nearest, bilinear };
}

export const CONVENTIONS = {
  shipped: { interp: "nearest", stepM: 160, maxKm: 64 },
  converged: { interp: "bilinear", stepM: 40, maxKm: 150 },
};

/**
 * 360-bin horizon elevation profile (degrees, geographic azimuth, 0 = north).
 * The raster's line/sample axes run opposite to the standard stereographic x/y
 * convention for this product, so the image-space direction is negated
 * (found by validating against NASA's LOLA visibility map).
 */
/**
 * Unit image-space step for a geographic azimuth (0 = north, i.e. away from the pole;
 * 90 = east) at longitude `lon`. Consistent with project(): north is (sin lon, -cos lon)
 * and east is (cos lon, sin lon). Two earlier bugs (a 180-degree flip, then an
 * east-west mirror) lived exactly here; tests/geometry.test.mjs pins it down.
 */
export function azimuthToImageDir(az, lon) {
  const ang = (az + lon) * D;
  return { dx: Math.sin(ang), dy: -Math.cos(ang) };
}

/** heightM raises the observer above the surface (a mast or a tall lander). */
export function horizonProfile(dem, lat, lon, convention = "converged", bins = 360, heightM = 0) {
  const c = CONVENTIONS[convention];
  const g = sampler(dem)[c.interp];
  const { x: x0, y: y0 } = project(lat, lon);
  const ground = g(x0, y0);
  if (ground === null) return null;
  const e0 = ground + heightM;
  const stepPx = c.stepM / PIX_M;
  const nSteps = Math.floor((c.maxKm * 1000) / c.stepM);
  const prof = new Float32Array(bins);
  for (let b = 0; b < bins; b++) {
    const az = (b * 360) / bins;
    const { dx, dy } = azimuthToImageDir(az, lon);
    let best = -1e9;
    for (let k = 1; k <= nSteps; k++) {
      const h = g(x0 + dx * k * stepPx, y0 + dy * k * stepPx);
      if (h === null) break;
      const d = k * c.stepM;
      const s = (h - e0 - (d * d) / (2 * R_MOON_M)) / d;
      if (s > best) best = s;
    }
    prof[b] = best === -1e9 ? 0 : Math.atan(best) / D;
  }
  return { prof, elevationM: ground };
}

/**
 * Surface slope (degrees) at a point: least-squares plane over a 3x3 window of
 * 80 m posts (Horn's method), i.e. slope at the DEM's own baseline (~240 m).
 */
export function slopeDeg(dem, lat, lon) {
  const { x, y } = project(lat, lon);
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 1 || yi < 1 || xi >= N - 1 || yi >= N - 1) return null;
  const z = (dx, dy) => dem[(yi + dy) * N + (xi + dx)] * M_PER_DN;
  const gx = ((z(1, -1) + 2 * z(1, 0) + z(1, 1)) - (z(-1, -1) + 2 * z(-1, 0) + z(-1, 1))) / (8 * PIX_M);
  const gy = ((z(-1, 1) + 2 * z(0, 1) + z(1, 1)) - (z(-1, -1) + 2 * z(0, -1) + z(1, -1))) / (8 * PIX_M);
  return Math.atan(Math.hypot(gx, gy)) / D;
}

/** Linear interpolation into a 360-bin profile. */
export function horizonAt(prof, az) {
  const n = prof.length;
  const a = ((((az % 360) + 360) % 360) * n) / 360;
  const i = Math.floor(a) % n;
  const j = (i + 1) % n;
  const t = a - Math.floor(a);
  return prof[i] * (1 - t) + prof[j] * t;
}

// ------------------------------------------------------------ 20 m near-pole terrain
export const N20 = 7584;
export const PIX20 = 20;
const C20 = (N20 - 1) / 2;

export function loadDem20(file) {
  const buf = fs.readFileSync(file);
  if (buf.length !== N20 * N20 * 2) throw new Error(`${file}: unexpected size ${buf.length}`);
  return new Int16Array(buf.buffer, buf.byteOffset, N20 * N20);
}

/**
 * Hybrid horizon for sites inside the 20 m LDEM_875S_20M tile (87.5–90°S): the near
 * field is marched on 20 m terrain (bilinear, 10 m steps) until the ray leaves the tile
 * or reaches nearKm, then continued on the 80 m model out to 150 km. Returns null when
 * the site is outside the 20 m tile.
 */
export function horizonProfileHybrid(dem80, dem20, lat, lon, heightM = 0, nearKm = 30, bins = 360) {
  const colat = (90 - Math.abs(lat)) * D;
  const rM = 2 * R_MOON_M * Math.tan(colat / 2);
  const a = lon * D;
  const x20 = C20 + (rM / PIX20) * Math.sin(a), y20 = C20 - (rM / PIX20) * Math.cos(a);
  const bil20 = (x, y) => {
    if (x < 0 || y < 0 || x >= N20 - 1 || y >= N20 - 1) return null;
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const v00 = dem20[yi * N20 + xi], v10 = dem20[yi * N20 + xi + 1];
    const v01 = dem20[(yi + 1) * N20 + xi], v11 = dem20[(yi + 1) * N20 + xi + 1];
    if (v00 === -32768 || v10 === -32768 || v01 === -32768 || v11 === -32768) return null;
    return (v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy) * M_PER_DN;
  };
  const g80 = sampler(dem80).bilinear;
  const ground = bil20(x20, y20);
  if (ground === null) return null;
  const e0 = ground + heightM;
  const { x: x80, y: y80 } = project(lat, lon);
  const prof = new Float32Array(bins);
  for (let b = 0; b < bins; b++) {
    const { dx, dy } = azimuthToImageDir((b * 360) / bins, lon);
    let best = -1e9, d = 0;
    const near = 10; // metres per step on the 20 m grid
    for (d = near; d <= nearKm * 1000; d += near) {
      const h = bil20(x20 + (dx * d) / PIX20, y20 + (dy * d) / PIX20);
      if (h === null) break;
      const s = (h - e0 - (d * d) / (2 * R_MOON_M)) / d;
      if (s > best) best = s;
    }
    for (; d <= 150000; d += 40) {
      const h = g80(x80 + (dx * d) / PIX_M, y80 + (dy * d) / PIX_M);
      if (h === null) break;
      const s = (h - e0 - (d * d) / (2 * R_MOON_M)) / d;
      if (s > best) best = s;
    }
    prof[b] = best === -1e9 ? 0 : Math.atan(best) / D;
  }
  return { prof, elevationM: ground };
}
