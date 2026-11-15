/**
 * Site finder: cells of ~600 m within 5 deg of the pole, from NASA's own LOLA products
 * (web/scripts/build-finder.mjs). Each cell keeps every 60 m spot that no other spot in the
 * cell beats on Sun, Earth, slope and distance to permanent shadow (at the sliders' steps)
 * while ranking at least as high, so a cell passes exactly when any of its 60 m pixels passes,
 * and the best passing pixel is always kept. All values of a spot belong to that one spot, and
 * its exact position is kept, so a shortlisted spot opens exactly where its numbers come from.
 */
import { unprojectFromUnit } from "./terrain";

/** Half-width of the app's map square in metres (7600 px x 80 m / 2). */
const MAP_HALF_M = 304000;

export type Finder = { n: number; b: number; cellM: number; halfM: number; pixM: number; off: number; index: Uint32Array; data: Uint8Array };
export type FinderLimits = { sunPct: number; earthPct: number; slopeDeg: number; shadowKm: number | null };
export type FinderSpot = { sunPct: number; earthPct: number; slopeDeg: number; shadowKm: number | null; lat: number; lon: number };

export async function loadFinder(): Promise<Finder> {
  const base = import.meta.env.BASE_URL;
  const [m, b] = await Promise.all([fetch(`${base}terrain/finder.json`), fetch(`${base}terrain/finder.bin`)]);
  if (!m.ok || !b.ok) throw new Error(`site finder data failed: HTTP ${m.status}/${b.status}`);
  const meta = await m.json();
  const buf = await b.arrayBuffer();
  const cells = meta.n * meta.n;
  if (buf.byteLength !== 4 * (cells + 1) + meta.spots * meta.bytesPerCandidate) throw new Error("site finder data has the wrong size");
  const index = new Uint32Array(buf, 0, cells + 1);
  const data = new Uint8Array(buf, 4 * (cells + 1));
  return { n: meta.n, b: meta.bytesPerCandidate, cellM: meta.cellM, halfM: meta.halfM, pixM: meta.pixM, off: meta.off, index, data };
}

/** The finder square as a share of the map square (both centred on the pole). */
export const finderHalfUnit = (f: Finder) => f.halfM / MAP_HALF_M;

/** Spot number `s` (global), in cell (i, j), with the exact position of its 60 m pixel. */
export function candidate(f: Finder, i: number, j: number, s: number): FinderSpot | null {
  const o = s * f.b, d = f.data;
  if (s < f.index[j * f.n + i] || s >= f.index[j * f.n + i + 1]) return null;
  const x0 = -f.halfM + i * f.cellM, y0 = -f.halfM + j * f.cellM;
  const a = Math.floor(f.off + x0 / f.pixM) + d[o + 4], b = Math.floor(f.off + y0 / f.pixM) + d[o + 5];
  const xm = (a + 0.5 - f.off) * f.pixM, ym = (b + 0.5 - f.off) * f.pixM;
  const { lat, lon } = unprojectFromUnit({ x: xm / MAP_HALF_M, y: ym / MAP_HALF_M });
  return { sunPct: d[o], earthPct: d[o + 1], slopeDeg: d[o + 2] / 4, shadowKm: d[o + 3] === 255 ? null : d[o + 3] / 20, lat, lon };
}

function failsAt(f: Finder, o: number, L: FinderLimits) {
  const d = f.data;
  if (d[o] === 255) return 9;
  let n = 0;
  if (d[o] < L.sunPct) n++;
  if (d[o + 1] < L.earthPct) n++;
  if (d[o + 2] / 4 > L.slopeDeg) n++;
  if (L.shadowKm !== null && (d[o + 3] === 255 || d[o + 3] / 20 > L.shadowKm)) n++;
  return n;
}

/** The best candidate of the cell under a point given in map units, for the pointer read-out. */
export function cellAtUnit(f: Finder, ux: number, uy: number, L: FinderLimits): FinderSpot | null {
  const h = finderHalfUnit(f);
  const i = Math.floor(((ux + h) / (2 * h)) * f.n), j = Math.floor(((uy + h) / (2 * h)) * f.n);
  if (i < 0 || j < 0 || i >= f.n || j >= f.n) return null;
  let best = -1, bestFails = 99;
  const c0 = j * f.n + i;
  for (let s = f.index[c0]; s < f.index[c0 + 1]; s++) {
    const m = failsAt(f, s * f.b, L);
    if (m < bestFails) { bestFails = m; best = s; }
  }
  return best < 0 ? null : candidate(f, i, j, best);
}

/**
 * Colour every cell (green: one of its spots passes every limit; amber: the best spot fails
 * one) and list the best passing spots, sunniest first, at least `minSepKm` apart.
 */
export function classify(f: Finder, L: FinderLimits, topN = 6, minSepKm = 8) {
  const { n, b, data: d, index } = f;
  const img = new ImageData(n, n);
  const px = img.data;
  let passCells = 0, valid = 0;
  const passing: { i: number; j: number; c: number; key: number }[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let bestFails = 99, bestC = -1, bestKey = -1;
      const c0 = j * n + i;
      for (let c = index[c0]; c < index[c0 + 1]; c++) {
        const o = c * b;
        const m = failsAt(f, o, L);
        const key = d[o] * 65536 + d[o + 1] * 256 + (255 - d[o + 2]);
        if (m < bestFails || (m === bestFails && key > bestKey)) { bestFails = m; bestC = c; bestKey = key; }
      }
      if (bestFails === 9 || bestC < 0) continue;
      valid++;
      const o = (j * n + i) * 4;
      if (bestFails === 0) {
        passCells++;
        passing.push({ i, j, c: bestC, key: bestKey });
        px[o] = 71; px[o + 1] = 218; px[o + 2] = 132; px[o + 3] = 235;
      } else if (bestFails === 1) {
        px[o] = 245; px[o + 1] = 175; px[o + 2] = 12; px[o + 3] = 120;
      } else {
        px[o + 3] = 120;
      }
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = n;
  canvas.getContext("2d")?.putImageData(img, 0, 0);

  passing.sort((x, y) => y.key - x.key);
  const sep = (minSepKm * 1000) / f.cellM;
  const chosen: typeof passing = [];
  for (const p of passing) {
    if (chosen.every((c) => Math.hypot(c.i - p.i, c.j - p.j) >= sep)) chosen.push(p);
    if (chosen.length >= topN) break;
  }
  const top = chosen.map((p) => candidate(f, p.i, p.j, p.c)!).filter(Boolean);
  return { canvas, passCells, valid, cellKm: f.cellM / 1000, top };
}
