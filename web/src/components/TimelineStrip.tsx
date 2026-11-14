import { useEffect, useRef } from "react";
import type { Sample } from "../lib/analysis";

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
export default function TimelineStrip({ samples, currentMs, onScrub, height = 96 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const ribbon = useRef<HTMLCanvasElement | null>(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });

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
    const barTop = 22;
    const barH = h - 46;

    for (let i = 0; i < samples.length - 1; i++) {
      const a = xOf(samples[i].t);
      const b = xOf(samples[i + 1].t);
      ctx.fillStyle = samples[i].lit ? "#f2b45c" : "#101728";
      ctx.fillRect(a, barTop, Math.max(0.6, b - a), barH);
      ctx.fillStyle = samples[i].comm ? "#3fc7f0" : "#1a2233";
      ctx.fillRect(a, barTop + barH + 4, Math.max(0.6, b - a), 8);
    }

    // day grid + labels
    const start = new Date(t0);
    const dayMs = 86400000;
    let day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    if (day.getTime() < t0) day = new Date(day.getTime() + dayMs);
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    for (let d = day; d.getTime() <= t1; d = new Date(d.getTime() + dayMs)) {
      const x = xOf(d.getTime());
      ctx.strokeStyle = "rgba(90,110,140,0.18)";
      ctx.beginPath();
      ctx.moveTo(x, barTop - 4);
      ctx.lineTo(x, barTop + barH + 12);
      ctx.stroke();
      if (d.getUTCDate() === 1 || d.getTime() === day.getTime()) {
        ctx.fillStyle = "rgba(160,178,204,0.75)";
        ctx.fillText(
          d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
          x + 3,
          h - 4
        );
      }
    }
  };

  useEffect(() => {
    drawRibbon();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => drawRibbon());
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
    const barTop = 22 * dpr;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(px, barTop - 8 * dpr);
    ctx.lineTo(px, barTop + (h - 46) * dpr + 16 * dpr);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(px, barTop - 8 * dpr, 3 * dpr, 0, Math.PI * 2);
    ctx.fill();
  }, [currentMs, samples, height]);

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
