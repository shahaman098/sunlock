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

export async function loadTerrain(): Promise<{
  meta: TerrainMeta;
  shadows: Uint8Array;
}> {
  const [metaRes, shadowRes] = await Promise.all([
    fetch(`${import.meta.env.BASE_URL}terrain/sites.json`),
    fetch(`${import.meta.env.BASE_URL}terrain/shadowgrid.bin`),
  ]);
  const meta: TerrainMeta = await metaRes.json();
  const buf = await shadowRes.arrayBuffer();
  return { meta, shadows: new Uint8Array(buf) };
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
