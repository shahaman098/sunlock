import { siteBasis, type Site, type Sky } from "./selene";

export type TerrainMeta = {
  source: string;
  moonRadiusM: number;
  grid: { size: number; pixM: number };
  overview: { size: number };
  shadow: { size: number; azimuthBins: number };
  sites: Site[];
};

const R_MOON = 1737400;
const PIX_M = 80;
const GRID = 7600;

/** Fractional pixel in the source LOLA stereographic raster. */
export function projectToGrid(lat: number, lon: number) {
  const colat = ((90 - Math.abs(lat)) * Math.PI) / 180;
  const r = (2 * R_MOON * Math.tan(colat / 2)) / PIX_M;
  const a = (lon * Math.PI) / 180;
  const c = (GRID - 1) / 2;
  return { x: c + r * Math.sin(a), y: c - r * Math.cos(a) };
}

/** Normalised map coordinates: [-1, 1], centred on the pole. */
export function projectToUnit(lat: number, lon: number) {
  const { x, y } = projectToGrid(lat, lon);
  const c = (GRID - 1) / 2;
  return { x: (x - c) / (GRID / 2), y: (y - c) / (GRID / 2) };
}

export type ElevationGrid = {
  size: number;
  pixM: number;
  data: Int16Array; // metres
};

export async function loadTerrain(): Promise<{
  meta: TerrainMeta;
  shadows: Uint8Array;
  elevation: ElevationGrid;
}> {
  const [metaRes, shadowRes, elevRes] = await Promise.all([
    fetch(`${import.meta.env.BASE_URL}terrain/sites.json`),
    fetch(`${import.meta.env.BASE_URL}terrain/shadowgrid.bin`),
    fetch(`${import.meta.env.BASE_URL}terrain/elevgrid.bin`),
  ]);
  const meta: TerrainMeta = await metaRes.json();
  const buf = await shadowRes.arrayBuffer();
  const elevBuf = await elevRes.arrayBuffer();
  return {
    meta,
    shadows: new Uint8Array(buf),
    elevation: { size: 1024, pixM: (GRID * PIX_M) / 1024, data: new Int16Array(elevBuf) },
  };
}

/** Convert normalised map coordinates (-1..1, pole-centred) back to lat/lon. */
export function unprojectFromUnit(u: { x: number; y: number }) {
  const gx = u.x * (GRID / 2) + (GRID - 1) / 2;
  const gy = u.y * (GRID / 2) + (GRID - 1) / 2;
  const c = (GRID - 1) / 2;
  const dx = gx - c;
  const dy = gy - c;
  const rM = Math.hypot(dx, dy) * PIX_M;
  const colat = 2 * Math.atan(rM / (2 * R_MOON));
  const lat = -(90 - colat / (Math.PI / 180));
  let lon = (Math.atan2(dx, -dy) * 180) / Math.PI;
  if (lon < 0) lon += 360;
  return { lat, lon, inside: rM <= 3800 * PIX_M };
}

/** Terrain horizon at an arbitrary point, ray-marched on the 1024^2 elevation grid. */
export function customHorizon(grid: ElevationGrid, lat: number, lon: number) {
  const { size, pixM, data } = grid;
  const p = projectToGrid(lat, lon);
  const gx = (p.x / GRID) * size;
  const gy = (p.y / GRID) * size;
  const idx = (x: number, y: number) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= size || yi >= size) return null;
    return data[yi * size + xi];
  };
  const e0 = idx(gx, gy);
  if (e0 === null) return { horizon: new Array(360).fill(0), elevationM: 0, inside: false };

  const R = 1737400;
  const horizon: number[] = [];
  for (let a = 0; a < 360; a++) {
    const ang = ((a - lon) * Math.PI) / 180;
    // image-space direction matching geographic azimuth a
    const dx = Math.sin(ang);
    const dy = Math.cos(ang);
    let best = -1e9;
    for (let k = 1; k <= 100; k++) {
      const h = idx(gx + dx * k, gy + dy * k);
      if (h === null) break;
      const d = k * pixM;
      const slope = (h - e0 - (d * d) / (2 * R)) / d;
      if (slope > best) best = slope;
    }
    horizon.push(best === -1e9 ? 0 : (Math.atan(best) * 180) / Math.PI);
  }
  return { horizon, elevationM: Math.round(e0), inside: true };
}

export type ShadowField = {
  size: number;
  bins: number;
  up: Float32Array;    // size*size*3, lunar body-fixed unit vectors
  east: Float32Array;
  north: Float32Array;
  horizon: Uint8Array; // size*size*bins, tan(angle)*100
  mask: Uint8Array;    // 1 where inside the DEM footprint
};

/** Precompute per-pixel frames so shadow rendering is a few dot products. */
export function buildShadowField(meta: TerrainMeta, horizon: Uint8Array): ShadowField {
  const n = meta.shadow.size;
  const bins = meta.shadow.azimuthBins;
  const up = new Float32Array(n * n * 3);
  const east = new Float32Array(n * n * 3);
  const north = new Float32Array(n * n * 3);
  const mask = new Uint8Array(n * n);

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      // invert the stereographic projection for this pixel centre
      const gx = ((x + 0.5) / n) * GRID;
      const gy = ((y + 0.5) / n) * GRID;
      const c = (GRID - 1) / 2;
      const dx = gx - c;
      const dy = gy - c;
      const rM = Math.hypot(dx, dy) * PIX_M;
      const inside = rM <= 3800 * PIX_M;
      mask[i] = inside ? 1 : 0;
      if (!inside) continue;
      const colat = 2 * Math.atan(rM / (2 * R_MOON));
      const lat = -(90 - (colat * 180) / Math.PI);
      let lon = (Math.atan2(dx, -dy) * 180) / Math.PI;
      if (lon < 0) lon += 360;
      const b = siteBasis(lat, lon);
      up.set([b.up.x, b.up.y, b.up.z], i * 3);
      east.set([b.east.x, b.east.y, b.east.z], i * 3);
      north.set([b.north.x, b.north.y, b.north.z], i * 3);
    }
  }
  return { size: n, bins, up, east, north, horizon, mask };
}

export type ShadowView = {
  lit: Uint8Array;   // 0 dark, 1 lit
  frac: number;      // illuminated fraction
};

/** Sunlit mask for a given sky state. Deterministic, ~a few ms at 512^2. */
export function computeShadow(field: ShadowField, sky: Sky): ShadowView {
  const { size: n, bins, up, east, north, horizon, mask } = field;
  const lit = new Uint8Array(n * n);
  const sx = sky.sun.x, sy = sky.sun.y, sz = sky.sun.z;
  let litCount = 0;
  let valid = 0;

  for (let i = 0; i < n * n; i++) {
    if (!mask[i]) continue;
    valid++;
    const k = i * 3;
    const sinElev = sx * up[k] + sy * up[k + 1] + sz * up[k + 2];
    const elDeg = (Math.asin(Math.max(-1, Math.min(1, sinElev))) * 180) / Math.PI;

    let az = Math.atan2(sx * east[k] + sy * east[k + 1] + sz * east[k + 2],
                        sx * north[k] + sy * north[k + 1] + sz * north[k + 2]);
    if (az < 0) az += Math.PI * 2;
    const bin = Math.min(bins - 1, Math.floor((az / (Math.PI * 2)) * bins));
    // byte encodes degrees as (deg + 32) * 4
    const hDeg = (horizon[i * bins + bin] - 128) / 4;
    if (elDeg > hDeg) {
      lit[i] = 1;
      litCount++;
    }
  }
  return { lit, frac: valid ? litCount / valid : 0 };
}
