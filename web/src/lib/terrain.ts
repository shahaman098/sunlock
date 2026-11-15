import { siteBasis, type Site, type Sky } from "./selene";

export type TerrainMeta = {
  source: string;
  moonRadiusM: number;
  grid: { size: number; pixM: number };
  overview: { size: number };
  shadow: { size: number; azimuthBins: number };
  elevation: { size: number; pixM: number };
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

/**
 * Load what the first frame needs (site data and the shadow grid). The elevation grid is
 * only needed for clicked points and the cursor read-out, so it arrives as a separate
 * promise and never holds up the map.
 */
export async function loadTerrain(): Promise<{
  meta: TerrainMeta;
  shadows: Uint8Array;
  elevation: Promise<ElevationGrid>;
}> {
  const base = import.meta.env.BASE_URL;
  const elevFetch = fetch(`${base}terrain/elevgrid.bin`);
  const [metaRes, shadowRes] = await Promise.all([
    fetch(`${base}terrain/sites.json`),
    fetch(`${base}terrain/shadowgrid.bin`),
  ]);
  for (const [name, res] of [["sites.json", metaRes], ["shadowgrid.bin", shadowRes]] as const) {
    if (!res.ok) throw new Error(`${name} failed: HTTP ${res.status}`);
  }
  const meta: TerrainMeta = await metaRes.json();
  const buf = await shadowRes.arrayBuffer();
  const elevMeta = meta.elevation ?? { size: 1024, pixM: (GRID * PIX_M) / 1024 };
  const elevation = elevFetch.then(async (res) => {
    if (!res.ok) throw new Error(`elevgrid.bin failed: HTTP ${res.status}`);
    const elevBuf = await res.arrayBuffer();
    if (elevBuf.byteLength !== elevMeta.size * elevMeta.size * 2) {
      throw new Error(`elevgrid.bin size mismatch: ${elevBuf.byteLength} bytes`);
    }
    return { size: elevMeta.size, pixM: elevMeta.pixM, data: new Int16Array(elevBuf) };
  });
  return { meta, shadows: new Uint8Array(buf), elevation };
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
  // bilinear sampling of the coarse grid (null outside it)
  const at = (x: number, y: number) => {
    if (x < 0 || y < 0 || x > size - 1.001 || y > size - 1.001) return null;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const a = data[y0 * size + x0], b = data[y0 * size + x0 + 1], c = data[(y0 + 1) * size + x0], d = data[(y0 + 1) * size + x0 + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
  const e0 = at(gx, gy);
  if (e0 === null) return { horizon: new Array(360).fill(0), elevationM: 0, inside: false };

  const R = 1737400;
  // same reach as the named sites (150 km), half-cell steps, curvature drop subtracted
  const stepCells = 0.5;
  const maxK = Math.ceil(150000 / (pixM * stepCells));
  const horizon: number[] = [];
  for (let a = 0; a < 360; a++) {
    // geographic azimuth -> image direction: north (az 0) is (sin lon, -cos lon), east is (cos lon, sin lon)
    const ang = ((a + lon) * Math.PI) / 180;
    const dx = Math.sin(ang) * stepCells;
    const dy = -Math.cos(ang) * stepCells;
    let best = -1e9;
    for (let k = 1; k <= maxK; k++) {
      const h = at(gx + dx * k, gy + dy * k);
      if (h === null) break;
      const d = k * stepCells * pixM;
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
    // same definition as the site results and NASA's maps: any part of the solar disc (0.266 deg) clears the skyline
    if (elDeg + 0.266 > hDeg) {
      lit[i] = 1;
      litCount++;
    }
  }
  return { lit, frac: valid ? litCount / valid : 0 };
}

/** The point `distM` from (lat, lon) toward geographic azimuth `azDeg` (great circle, east-positive longitude). */
export function offsetPoint(lat: number, lon: number, azDeg: number, distM: number) {
  const D = Math.PI / 180, d = distM / R_MOON, f1 = lat * D, l1 = lon * D, a = azDeg * D;
  const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(a));
  const l2 = l1 + Math.atan2(Math.sin(a) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
  return { lat: f2 / D, lon: ((((l2 / D) % 360) + 360) % 360) };
}

/**
 * REJECTED shortcut, kept only so scripts/validate-nearby.mjs can document why: a named site's
 * 80 m skyline plus the change our ~600 m grid sees. Against NASA's 18.6-year sunlight at 96
 * nearby points it scored r = 0.17 (full 80 m skylines: r = 0.96), so the app ships full
 * skylines for nearby positions instead (web/scripts/build-nearby.mjs).
 */
export function nearbyHorizon(grid: ElevationGrid, site: Pick<Site, "lat" | "lon" | "horizonDeg" | "elevationM">, lat: number, lon: number) {
  const here = customHorizon(grid, site.lat, site.lon);
  const there = customHorizon(grid, lat, lon);
  if (!here.inside || !there.inside) return null;
  const n = site.horizonDeg.length;
  const horizon = site.horizonDeg.map((h, i) => {
    const a = Math.floor((i * 360) / n) % 360;
    return h + (there.horizon[a] - here.horizon[a]);
  });
  return { horizon, elevationM: site.elevationM + (there.elevationM - here.elevationM) };
}
