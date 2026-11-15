import { useEffect, useRef, useState } from "react";
import type { Sample } from "../lib/analysis";

const BAR_TOP = 0;
const COMM_H = 10;
const COMM_GAP = 3;

type Props = {
  samples: Sample[];
  currentMs: number;
  onScrub: (ms: number) => void;
  height?: number;
};

/**
 * Illumination ribbon plus Earth-link band. The ribbon is expensive to draw
 * (~17k rects), so it is cached to an offscreen canvas and only the playhead
 * is redrawn while scrubbing.
 */
export default function TimelineStrip({ samples, currentMs, onScrub, height = 64 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const ribbon = useRef<HTMLCanvasElement | null>(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const [resizeTick, setResizeTick] = useState(0);

  const drawRibbon = () => {
    const wrap = wrapRef.current;
    if (!wrap || samples.length < 2) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = wrap.clientWidth;
    const h = height;
    size.current = { w, h, dpr };

    const c = ribbon.current ?? document.createElement("canvas");
    ribbon.current = c;
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const t0 = samples[0].t;
    const t1 = samples[samples.length - 1].t;
    const span = t1 - t0 || 1;
    const xOf = (t: number) => ((t - t0) / span) * w;
    const barTop = BAR_TOP;
    const barH = h - BAR_TOP - COMM_GAP - COMM_H;

    for (let i = 0; i < samples.length - 1; i++) {
      const a = xOf(samples[i].t);
      const b = xOf(samples[i + 1].t);
      ctx.fillStyle = samples[i].lit ? "#f5af0c" : "#232327";
      ctx.fillRect(a, barTop, Math.max(0.6, b - a), barH);
      ctx.fillStyle = samples[i].comm ? "#42dbc2" : "#232327";
      ctx.fillRect(a, barTop + barH + COMM_GAP, Math.max(0.6, b - a), COMM_H);
    }

    // week and month lines only; the dates are on the shared axis above the ribbon
    const dayMs = 86400000;
    const start = new Date(t0);
    let day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    if (day.getTime() < t0) day = new Date(day.getTime() + dayMs);
    for (let d = day; d.getTime() <= t1; d = new Date(d.getTime() + dayMs)) {
      const month = d.getUTCDate() === 1;
      if (!month && d.getUTCDay() !== 1) continue;
      const x = Math.round(xOf(d.getTime())) + 0.5;
      ctx.strokeStyle = month ? "rgba(0,0,0,0.75)" : "rgba(0,0,0,0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  };

  useEffect(() => {
    drawRibbon();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      drawRibbon();
      setResizeTick((t) => t + 1); // re-blit at the new backing-store size
    });
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samples, height]);

  useEffect(() => {
    const canvas = ref.current;
    const { w, h, dpr } = size.current;
    if (!canvas || !ribbon.current || w === 0 || samples.length < 2) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(ribbon.current, 0, 0);

    const t0 = samples[0].t;
    const t1 = samples[samples.length - 1].t;
    const px = ((currentMs - t0) / (t1 - t0 || 1)) * w * dpr;
    ctx.fillStyle = "#000";
    ctx.fillRect(Math.round(px) - 2 * dpr, 0, 4 * dpr, h * dpr);
    ctx.fillStyle = "#fff";
    ctx.fillRect(Math.round(px) - dpr, 0, 2 * dpr, h * dpr);
  }, [currentMs, samples, height, resizeTick]);

  const handle = (clientX: number) => {
    const wrap = wrapRef.current;
    if (!wrap || samples.length < 2) return;
    const rect = wrap.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const t0 = samples[0].t;
    const t1 = samples[samples.length - 1].t;
    onScrub(t0 + frac * (t1 - t0));
  };

  return (
    <div
      className="timeline"
      ref={wrapRef}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        handle(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) handle(e.clientX);
      }}
    >
      <canvas ref={ref} />
    </div>
  );
}
