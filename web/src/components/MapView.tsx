import { useEffect, useMemo, useRef } from "react";
import { projectToUnit, type ShadowField, type ShadowView } from "../lib/terrain";
import type { Site, Sky } from "../lib/selene";

const SIZE = 1024;

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
};

type Placed = { site: Site; x: number; y: number; lx: number; ly: number; anchor: "start" | "end" };

/** Greedy label placement so site names never overlap. */
function layout(sites: Site[]): Placed[] {
  const items = sites
    .map((site) => {
      const p = projectToUnit(site.lat, site.lon);
      return { site, x: ((p.x + 1) / 2) * 100, y: ((p.y + 1) / 2) * 100 };
    })
    .sort((a, b) => a.y - b.y);

  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const out: Placed[] = [];

  for (const it of items) {
    const w = it.site.name.length * 0.62;
    const h = 2.6;
    const options: [number, number, "start" | "end"][] = [
      [2.4, 0.8, "start"],
      [-2.4, 0.8, "end"],
      [2.4, -1.6, "start"],
      [-2.4, -1.6, "end"],
      [0, 2.6, "start"],
      [0, -2.8, "start"],
    ];
    let best = options[0];
    let bestBox = null as null | { x0: number; y0: number; x1: number; y1: number };
    for (const [dx, dy, anchor] of options) {
      const lx = it.x + dx;
      const ly = it.y + dy;
      const x0 = anchor === "start" ? lx : lx - w;
      const box = { x0, y0: ly - h / 2, x1: x0 + w, y1: ly + h / 2 };
      const hit = boxes.some((b) => !(box.x1 < b.x0 || box.x0 > b.x1 || box.y1 < b.y0 || box.y0 > b.y1));
      if (!hit) {
        best = [dx, dy, anchor];
        bestBox = box;
        break;
      }
    }
    if (!bestBox) {
      const [dx, dy, anchor] = best;
      const lx = it.x + dx;
      const ly = it.y + dy;
      const x0 = anchor === "start" ? lx : lx - w;
      bestBox = { x0, y0: ly - h / 2, x1: x0 + w, y1: ly + h / 2 };
    }
    boxes.push(bestBox);
    out.push({ ...it, lx: it.x + best[0], ly: it.y + best[1], anchor: best[2] });
  }
  return out;
}

export default function MapView({ hillshade, field, shadow, sites, selectedId, onSelect, sky, onPick, custom }: Props) {
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
    ctx.drawImage(hillshade, 0, 0, SIZE, SIZE);
    if (overlay) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(overlay, 0, 0, SIZE, SIZE);
    }
  }, [hillshade, overlay]);

  const placed = useMemo(() => layout(sites), [sites]);
  const sunBearing = sky ? sky.subSun.lon : 0;
  const sunElev = sky ? -sky.subSun.lat : 0;

  return (
    <div className="map-wrap">
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        className="map-canvas"
        aria-label="Sunlit terrain map of the lunar south pole. Click anywhere to analyse that point."
        onClick={(e) => {
          if (!onPick) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
          onPick({ x: nx, y: ny });
        }}
      />

      <svg className="map-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
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
        {placed.map(({ site, x, y, lx, ly, anchor }) => {
          const active = site.id === selectedId;
          return (
            <g key={site.id} onClick={() => onSelect(site.id)} className="marker">
              {active && <circle cx={x} cy={y} r={3.2} className="pin-halo" />}
              <circle cx={x} cy={y} r={active ? 1.9 : 1.25} className={active ? "pin pin-active" : "pin"} />
              <text
                x={lx}
                y={ly}
                textAnchor={anchor}
                className={active ? "pin-label pin-label-active" : "pin-label"}
              >
                {site.name}
              </text>
            </g>
          );
        })}
      </svg>

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
            SUN {sunElev >= 0 ? "+" : ""}{sunElev.toFixed(1)}°
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

      <div className="map-legend">
        <span className="dot dot-lit" /> sunlit
        <span className="dot dot-dark" /> shadowed
        <span className="map-hint">click the terrain to analyse any point</span>
      </div>
    </div>
  );
}
