import { useEffect, useRef, useState } from "react";

export type PorkchopRow = { id: string; name: string; values: Float32Array };

type Props = {
  rows: PorkchopRow[];
  /** time of column 0, ms */
  t0: number;
  /** time between columns, ms */
  colMs: number;
  currentMs: number;
  selectedId: string;
  onPick: (siteId: string, ms: number) => void;
};

const LOST = [92, 14, 10];
const LOW = [245, 175, 12]; // --sun: survives, but only just
const HIGH = [71, 218, 132]; // --ok: survives with margin
const EMPTY = [35, 35, 39];

function colour(v: number): number[] {
  if (Number.isNaN(v)) return EMPTY;
  if (v < 0) return LOST;
  const t = Math.min(1, Math.max(0, v / 100));
  return LOW.map((a, i) => Math.round(a + (HIGH[i] - a) * t));
}

const fmtDay = (ms: number) =>
  new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Landing porkchop: rows are landing regions, columns are landing times, each cell
 * is whether the lander survives the whole mission from that landing and with how
 * much battery to spare. The mission-design idiom of a launch/arrival porkchop plot,
 * applied to lunar polar landing.
 */
export default function Porkchop({ rows, t0, colMs, currentMs, selectedId, onPick }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ r: number; c: number; x: number; y: number } | null>(null);
  const cols = rows[0]?.values.length ?? 0;
  const ROW_H = 18;
  const H = rows.length * ROW_H;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = ref.current;
    if (!c || !width || !cols) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(width * dpr);
    c.height = Math.round(H * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, H);
    const cw = width / cols;
    rows.forEach((row, r) => {
      for (let k = 0; k < cols; k++) {
        const [R, G, B] = colour(row.values[k]);
        ctx.fillStyle = `rgb(${R},${G},${B})`;
        ctx.fillRect(k * cw, r * ROW_H + 1, Math.ceil(cw) + 0.5, ROW_H - 2);
      }
      if (row.id === selectedId) {
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, r * ROW_H + 0.5, width - 1, ROW_H - 1);
      }
    });
    const x = ((currentMs - t0) / colMs) * cw;
    if (x >= 0 && x <= width) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(Math.round(x) - 1, 0, 2, H);
    }
  }, [rows, width, cols, H, currentMs, t0, colMs, selectedId]);

  const cellAt = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const c = Math.min(cols - 1, Math.max(0, Math.floor((x / rect.width) * cols)));
    const r = Math.min(rows.length - 1, Math.max(0, Math.floor(y / ROW_H)));
    return { r, c, x, y };
  };

  const hv = hover ? rows[hover.r]?.values[hover.c] : undefined;
  // share of landing dates (that fit in the data) the lander survives, per site
  const share = rows.map((r) => {
    let ok = 0, n = 0;
    for (const v of r.values) if (!Number.isNaN(v)) { n++; if (v >= 0) ok++; }
    return n ? Math.round((100 * ok) / n) : 0;
  });

  return (
    <div className="porkchop" id="porkchop">
      <div className="pc-labels" style={{ height: H }}>
        {rows.map((r) => (
          <button
            key={r.id}
            className={r.id === selectedId ? "pc-label pc-label-on" : "pc-label"}
            style={{ height: ROW_H }}
            onClick={() => onPick(r.id, currentMs)}
          >
            {r.name}
          </button>
        ))}
      </div>
      <div className="pc-plot" ref={wrapRef}>
        <canvas
          ref={ref}
          style={{ width: "100%", height: H, display: "block", cursor: "crosshair" }}
          role="img"
          aria-label="Landing porkchop: survival by landing date and region"
          onMouseMove={(e) => setHover(cellAt(e))}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            const { r, c } = cellAt(e);
            onPick(rows[r].id, t0 + c * colMs);
          }}
        />
        {hover && hv !== undefined && (
          <div
            className="pc-tip"
            style={{ left: Math.min(Math.max(hover.x, 70), width - 70), top: hover.y + 14 }}
          >
            <b>{rows[hover.r].name}</b> · land {fmtDay(t0 + hover.c * colMs)}
            <br />
            {Number.isNaN(hv) ? "mission runs past the data" : hv < 0 ? "lander lost" : `survives · lowest charge ${hv.toFixed(0)}%`}
          </div>
        )}
        <div className="pc-axis">
          {Array.from({ length: 7 }, (_, i) => {
            const ms = t0 + ((cols - 1) * colMs * i) / 6;
            return <span key={i}>{fmtDay(ms)}</span>;
          })}
        </div>
      </div>
      <div className="pc-share" style={{ height: H }} aria-label="Share of landing dates the lander survives, per site">
        {rows.map((r, i) => (
          <span key={r.id} style={{ height: ROW_H }} className={share[i] === 0 ? "pc-share-v is-zero" : "pc-share-v"}
                title={`${r.name}: survives ${share[i]}% of landing dates`}>
            {share[i]}%
          </span>
        ))}
      </div>
    </div>
  );
}
