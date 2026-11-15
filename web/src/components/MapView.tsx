import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { projectToUnit, unprojectFromUnit, type ElevationGrid, type ShadowField, type ShadowView } from "../lib/terrain";
import type { Site, Sky } from "../lib/selene";
import { cellAtUnit, finderHalfUnit, type Finder, type FinderLimits, type FinderSpot } from "../lib/finder";

const SIZE = 1024;

export type MapLayers = { shadow: boolean; labels: boolean; refs: boolean; grid: boolean };
const ALL_LAYERS: MapLayers = { shadow: true, labels: true, refs: true, grid: true };

/** The map is a polar stereographic disc from the pole out to 80°S, 608 km across. */
const MAP_KM = 608;
const CANVAS_FRAC = 0.948; // the canvas is inset inside the wrap to leave room for the outer ring
const GRID_LATS = [-88, -86, -84, -82];
const GRID_LONS = Array.from({ length: 12 }, (_, i) => i * 30);

const LAYER_DEFS: [keyof MapLayers, string, string][] = [
  ["shadow", "Sunlight and shadow", "Live, from LRO LOLA terrain"],
  ["labels", "Site names", "NASA Artemis III sites"],
  ["refs", "Older sites", "Dropped by NASA in 2024"],
  ["grid", "Latitude and longitude", "Every 2° and every 30°"],
];

/**
 * What is under the pointer. Kept outside React state so moving the mouse
 * re-renders only the status bar, not the map or the rest of the console.
 */
type Cursor = { lat: number; lon: number; elevM: number | null; lit: boolean | null; cell?: FinderSpot | null } | null;
let cursor: Cursor = null;
const cursorSubs = new Set<() => void>();
const setCursor = (c: Cursor) => {
  cursor = c;
  cursorSubs.forEach((f) => f());
};
const subscribeCursor = (f: () => void) => {
  cursorSubs.add(f);
  return () => { cursorSubs.delete(f); };
};

const pct = (lat: number, lon: number) => {
  const p = projectToUnit(lat, lon);
  return { x: ((p.x + 1) / 2) * 100, y: ((p.y + 1) / 2) * 100 };
};

type Props = {
  hillshade: HTMLImageElement | null;
  field: ShadowField | null;
  shadow: ShadowView | null;
  sites: Site[];
  selectedId: string;
  onSelect: (id: string) => void;
  sky: Sky | null;
  onPick?: (u: { x: number; y: number }) => void;
  custom?: { lat: number; lon: number } | null;
  layers?: MapLayers;
  elevation?: ElevationGrid | null;
  /** site-finder mode: the classified grid replaces the live shadows */
  finder?: { data: Finder; canvas: HTMLCanvasElement; limits: FinderLimits } | null;
  /** corner read-outs drawn over the map square */
  children?: ReactNode;
};

type Placed = { site: Site; x: number; y: number; lx: number; ly: number; anchor: "start" | "end"; hidden?: boolean };

/**
 * Greedy label placement so site names never overlap. NASA's current regions are
 * placed first; a reference site whose label cannot fit is drawn without one
 * (its name still shows when it is selected).
 */
function layout(sites: Site[], selectedId: string): Placed[] {
  const prio = (s: Site) => (s.id === selectedId ? 0 : s.current === false ? 2 : 1);
  const items = sites
    .map((site) => {
      const p = projectToUnit(site.lat, site.lon);
      return { site, x: ((p.x + 1) / 2) * 100, y: ((p.y + 1) / 2) * 100 };
    })
    .sort((a, b) => prio(a.site) - prio(b.site) || a.y - b.y);

  // every pin is an obstacle, so labels never sit on another site's marker
  // (the selected pin carries a halo and a reticle, so it blocks a wider square)
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = items.map((it) => {
    const r = it.site.id === selectedId ? 4.8 : 2.0;
    return { x0: it.x - r, y0: it.y - r, x1: it.x + r, y1: it.y + r };
  });
  const out: Placed[] = [];

  for (const it of items) {
    if (it.site.current === false && it.site.id !== selectedId) {
      out.push({ ...it, lx: it.x, ly: it.y, anchor: "start", hidden: true });
      continue;
    }
    const w = it.site.name.length * 1.12 + 0.9;
    const gap = it.site.id === selectedId ? 5.4 : 2.9;
    // Candidate spots, nearest first: beside the pin, then stepping further above and below
    // (a leader line joins a label to its pin once it moves away).
    const options: [number, number, "start" | "end"][] = [[gap, 0.8, "start"], [-gap, 0.8, "end"]];
    for (const dy of [-1.8, 3.4, -4.2, 6.0, -6.8, 8.6, -9.4, 11.2]) {
      const dx = Math.abs(dy) < 3 ? gap : Math.max(1.6, gap - 2.4);
      options.push([dx, dy, "start"], [-dx, dy, "end"]);
    }
    type Box = { x0: number; y0: number; x1: number; y1: number };
    const boxAt = ([dx, dy, anchor]: [number, number, "start" | "end"]): Box => {
      const lx = it.x + dx, ly = it.y + dy;
      const x0 = anchor === "start" ? lx : lx - w;
      return { x0, y0: ly - 2.1, x1: x0 + w, y1: ly + 0.9 };
    };
    // overlap area with everything already placed; leaving the map is never allowed
    const cost = (box: Box) => {
      if (box.x0 < 1 || box.x1 > 99 || box.y0 < 1 || box.y1 > 99) return Infinity;
      let a = 0;
      for (const b of boxes) a += Math.max(0, Math.min(box.x1, b.x1) - Math.max(box.x0, b.x0)) * Math.max(0, Math.min(box.y1, b.y1) - Math.max(box.y0, b.y0));
      return a;
    };
    let best = options[0];
    let bestBox: Box | null = null;
    let bestCost = Infinity;
    for (const o of options) {
      const box = boxAt(o);
      const c = cost(box);
      if (c === 0) { best = o; bestBox = box; bestCost = 0; break; }
      if (c < bestCost) { best = o; bestBox = box; bestCost = c; }
    }
    if (bestCost > 0 && it.site.current === false && it.site.id !== selectedId) {
      out.push({ ...it, lx: it.x, ly: it.y, anchor: "start", hidden: true });
      continue;
    }
    if (!bestBox) bestBox = boxAt(best);
    boxes.push(bestBox);
    out.push({ ...it, lx: it.x + best[0], ly: it.y + best[1], anchor: best[2] });
  }
  return out;
}

export default function MapView({ hillshade, field, shadow, sites, selectedId, onSelect, sky, onPick, custom, layers = ALL_LAYERS, elevation, finder, children }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const overlay = useMemo(() => {
    if (!shadow || !field) return null;
    const c = document.createElement("canvas");
    c.width = field.size;
    c.height = field.size;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const img = ctx.createImageData(field.size, field.size);
    const d = img.data;
    for (let i = 0; i < field.size * field.size; i++) {
      if (!field.mask[i] || shadow.lit[i]) continue;
      const k = i * 4;
      d[k] = 3;
      d[k + 1] = 6;
      d[k + 2] = 14;
      d[k + 3] = 226;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }, [shadow, field]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hillshade) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    if (finder) {
      // the finder covers 85-90 deg S; the terrain outside it is dimmed
      ctx.globalAlpha = 0.45;
      ctx.drawImage(hillshade, 0, 0, SIZE, SIZE);
      ctx.globalAlpha = 1;
      const h = finderHalfUnit(finder.data);
      const x0 = ((1 - h) / 2) * SIZE, w = h * SIZE;
      ctx.drawImage(hillshade, x0, x0, w, w, x0, x0, w, w);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(finder.canvas, x0, x0, w, w);
      ctx.imageSmoothingEnabled = true;
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, (w / 2) * 0.9998, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    ctx.drawImage(hillshade, 0, 0, SIZE, SIZE);
    if (overlay && layers.shadow) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(overlay, 0, 0, SIZE, SIZE);
    }
  }, [hillshade, overlay, layers.shadow, finder]);

  const placed = useMemo(() => layout(sites, selectedId), [sites, selectedId]);
  const sunBearing = sky ? sky.subSun.lon : 0;
  const sunElev = sky ? -sky.subSun.lat : 0;

  return (
    <div className="map-wrap">
      {/* in site-finder mode the view zooms to 85-90 deg S, the area NASA's maps cover */}
      <div className={finder ? "map-zoom is-zoomed" : "map-zoom"} style={finder ? ({ "--zoom": String(1 / finderHalfUnit(finder.data)) } as React.CSSProperties) : undefined}>
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        className="map-canvas"
        aria-label="Map of sunlight and shadow at the lunar south pole. Click anywhere to check that spot."
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const fx = (e.clientX - rect.left) / rect.width;
          const fy = (e.clientY - rect.top) / rect.height;
          const { lat, lon, inside } = unprojectFromUnit({ x: fx * 2 - 1, y: fy * 2 - 1 });
          if (!inside) { setCursor(null); return; }
          const cell = (n: number) => {
            const x = Math.min(n - 1, Math.max(0, Math.floor(fx * n)));
            const y = Math.min(n - 1, Math.max(0, Math.floor(fy * n)));
            return y * n + x;
          };
          const fi = field ? cell(field.size) : -1;
          setCursor({
            lat,
            lon,
            elevM: elevation ? elevation.data[cell(elevation.size)] : null,
            lit: field && shadow && field.mask[fi] ? shadow.lit[fi] === 1 : null,
            cell: finder ? cellAtUnit(finder.data, fx * 2 - 1, fy * 2 - 1, finder.limits) : undefined,
          });
        }}
        onMouseLeave={() => setCursor(null)}
        onClick={(e) => {
          if (!onPick) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
          onPick({ x: nx, y: ny });
        }}
      />

      <svg className="map-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {layers.grid && (
          <g className="graticule">
            {GRID_LATS.map((lat) => (
              <circle key={lat} cx="50" cy="50" r={50 - pct(lat, 0).y} />
            ))}
            {GRID_LONS.map((lon) => {
              const a = pct(-88, lon), b = pct(-80.02, lon);
              return <line key={lon} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
            })}
            <line x1="49" y1="50" x2="51" y2="50" className="pole" />
            <line x1="50" y1="49" x2="50" y2="51" className="pole" />
            {GRID_LATS.map((lat) => {
              const p = pct(lat, 45);
              return <text key={lat} x={p.x + 0.5} y={p.y - 0.5}>{-lat}°S</text>;
            })}
            {[0, 90, 180, 270].map((lon) => {
              const p = pct(-81.1, lon);
              return (
                <text key={lon} x={p.x + (lon === 0 || lon === 180 ? 0.7 : 0)} y={p.y + (lon === 90 || lon === 270 ? -0.7 : 0.6)} textAnchor={lon === 90 ? "end" : "start"}>
                  {lon === 0 ? "0°" : lon === 180 ? "180°" : `${lon}°E`}
                </text>
              );
            })}
          </g>
        )}
        {custom && (() => {
          const p = projectToUnit(custom.lat, custom.lon);
          const cx = ((p.x + 1) / 2) * 100;
          const cy = ((p.y + 1) / 2) * 100;
          return (
            <g className="custom-pin">
              <circle cx={cx} cy={cy} r="2.6" className="custom-ring" />
              <line x1={cx - 3.6} y1={cy} x2={cx + 3.6} y2={cy} className="custom-cross" />
              <line x1={cx} y1={cy - 3.6} x2={cx} y2={cy + 3.6} className="custom-cross" />
            </g>
          );
        })()}
        {placed.map(({ site, x, y, lx, ly, anchor, hidden }) => {
          const active = site.id === selectedId;
          const ref = site.current === false;
          return (
            <g key={site.id} onClick={() => onSelect(site.id)} className="marker">
              {active && <circle cx={x} cy={y} r={3.2} className="pin-halo" />}
              {active && (
                <path
                  className="pin-reticle"
                  d={`M${x - 4.6},${y - 3.2}v-1.4h1.4 M${x + 3.2},${y - 4.6}h1.4v1.4 M${x + 4.6},${y + 3.2}v1.4h-1.4 M${x - 3.2},${y + 4.6}h-1.4v-1.4`}
                />
              )}
              <circle cx={x} cy={y} r={active ? 1.9 : ref ? 0.9 : 1.25} className={active ? "pin pin-active" : ref ? "pin pin-ref" : "pin"} />
              {!hidden && (layers.labels || active) && Math.abs(ly - y) > 3 && (
                <line x1={x} y1={y} x2={lx} y2={ly + (ly > y ? -1.4 : 0.6)} className="pin-leader" />
              )}
              {!hidden && (layers.labels || active) && <text
                x={lx}
                y={ly}
                textAnchor={anchor}
                className={active ? "pin-label pin-label-active" : ref ? "pin-label pin-label-ref" : "pin-label"}
              >
                {site.name}
              </text>}
            </g>
          );
        })}
      </svg>
      </div>

      {sky && (
        <div className="sun-dial" title="Direction of the Sun from the south pole">
          <svg viewBox="-12 -12 24 24">
            <circle r="10" className="dial-ring" />
            <g transform={`rotate(${sunBearing + 180})`}>
              <line x1="0" y1="0" x2="0" y2="-8.4" className="dial-ray" />
              <circle cy="-8.4" r="1.5" className="dial-sun" />
            </g>
            <circle r="0.9" className="dial-centre" />
          </svg>
          <span className="dial-label">
            Sun {sunElev >= 0 ? "+" : ""}{sunElev.toFixed(1)}° high
          </span>
        </div>
      )}

      {!hillshade && (
        <div className="map-loading">
          <span className="spinner" aria-hidden />
          <div>
            <strong>Loading LRO terrain</strong>
            <span>80 m elevation model · 2.6 MB</span>
          </div>
        </div>
      )}

      {(() => {
        // the bar keeps a sensible length when the finder zooms in: 100 km normally, 50 km zoomed
        const zoom = finder ? 1 / finderHalfUnit(finder.data) : 1;
        const km = finder ? 50 : 100;
        return (
      <div className="map-scale" style={{ width: `${((km / MAP_KM) * CANVAS_FRAC * 100 * zoom).toFixed(2)}%` }} aria-hidden>
        <span>{km} km</span>
      </div>
        );
      })()}
      {children}
    </div>
  );
}

/**
 * Status bar under the map: legend, what is under the pointer, and the layer list.
 * Nothing here sits on top of the terrain.
 */
export function MapStatusBar({ layers, onLayers, finderMode = false }: { layers: MapLayers; onLayers: Dispatch<SetStateAction<MapLayers>>; finderMode?: boolean }) {
  const cur = useSyncExternalStore(subscribeCursor, () => cursor);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const hidden = LAYER_DEFS.filter(([k]) => !layers[k]).length;

  return (
    <div className="map-status">
      <div className="ms-legend">
        {finderMode ? (
          <>
            <span className="chip chip-ok" /> Passes all
            <span className="chip chip-low" /> Fails one
          </>
        ) : (
          <>
            <span className="dot dot-lit" /> Sunlight
            <span className="dot dot-dark" /> Shadow
          </>
        )}
      </div>
      <div className="ms-cursor">
        {cur ? (
          <>
            <span className="ms-v">{Math.abs(cur.lat).toFixed(2)}°S</span>
            <span className="ms-v">{cur.lon.toFixed(1).padStart(5, "\u2007")}°E</span>
            {cur.elevM !== null && (
              <>
                <span className="ms-k">Height</span>
                <span className="ms-v ms-wide">{cur.elevM < 0 ? "\u2212" : "+"}{Math.abs(cur.elevM).toLocaleString("en-GB")} m</span>
              </>
            )}
            {cur.cell !== undefined ? (
              cur.cell ? (
                <span className="ms-cell">
                  best spot here: sun {cur.cell.sunPct}% · Earth {cur.cell.earthPct}% · slope {cur.cell.slopeDeg.toFixed(1)}° · shadow {cur.cell.shadowKm !== null ? `${cur.cell.shadowKm.toFixed(1)} km` : "> 12.7 km"}
                </span>
              ) : <span className="ms-state">outside NASA's 85°S maps</span>
            ) : cur.lit !== null && <span className={cur.lit ? "ms-state ms-lit" : "ms-state"}>{cur.lit ? "In sunlight" : "In shadow"}</span>}
          </>
        ) : (
          <span className="ms-hint">
            <span className="hint-mouse">Point at the map for coordinates, click to check any spot</span>
            <span className="hint-touch">Tap the map to check any spot</span>
          </span>
        )}
      </div>
      <div className="layers" ref={boxRef}>
        <button className="layers-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="layer-list">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden>
            <path d="M8,2 L14,5 L8,8 L2,5Z M2,8 L8,11 L14,8 M2,11 L8,14 L14,11" />
          </svg>
          Layers{hidden > 0 && <span className="layers-count">{LAYER_DEFS.length - hidden}/{LAYER_DEFS.length}</span>}
        </button>
        {open && (
          <ul className="layers-list" id="layer-list">
            {LAYER_DEFS.map(([key, name, src]) => (
              <li key={key}>
                <button
                  className="layer"
                  aria-pressed={layers[key]}
                  title={layers[key] ? `Hide ${name.toLowerCase()}` : `Show ${name.toLowerCase()}`}
                  onClick={() => onLayers((l) => ({ ...l, [key]: !l[key] }))}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M1.5,8 C3.5,4.5 5.6,3.2 8,3.2 S12.5,4.5 14.5,8 C12.5,11.5 10.4,12.8 8,12.8 S3.5,11.5 1.5,8Z" />
                    <circle cx="8" cy="8" r="2" />
                    {!layers[key] && <path d="M2.5,13.5 L13.5,2.5" />}
                  </svg>
                  <span className="layer-name">{name}</span>
                  <span className="layer-src">{src}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
