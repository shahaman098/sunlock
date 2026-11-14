import { useEffect, useRef } from "react";
import type { Sample } from "../lib/analysis";

type Props = {
  samples: Sample[];
  currentMs: number;
  onScrub: (ms: number) => void;
  height?: number;
};

export default function TimelineStrip({ samples, currentMs, onScrub, height = 96 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || samples.length < 2) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = wrap.clientWidth;
    const h = height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const t0 = samples[0].t;
    const t1 = samples[samples.length - 1].t;
    const span = t1 - t0 || 1;
    const xOf = (t: number) => ((t - t0) / span) * w;

    const barTop = 22;
    const barH = h - 46;

    ctx.clearRect(0, 0, w, h);

    // illumination ribbon
    for (let i = 0; i < samples.length - 1; i++) {
      const a = xOf(samples[i].t);
      const b = xOf(samples[i + 1].t);
      const s = samples[i];
      ctx.fillStyle = s.lit ? "#f2b45c" : "#101728";
      ctx.fillRect(a, barTop, Math.max(0.6, b - a), barH);
    }

    // comm band
    for (let i = 0; i < samples.length - 1; i++) {
      const a = xOf(samples[i].t);
      const b = xOf(samples[i + 1].t);
      ctx.fillStyle = samples[i].comm ? "#3fc7f0" : "#1a2233";
      ctx.fillRect(a, barTop + barH + 4, Math.max(0.6, b - a), 8);
    }

    // day ticks
    const start = new Date(t0);
    const dayMs = 86400000;
    let day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    if (day.getTime() < t0) day = new Date(day.getTime() + dayMs);
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "rgba(160,178,204,0.75)";
    ctx.strokeStyle = "rgba(90,110,140,0.25)";
    for (let d = day; d.getTime() <= t1; d = new Date(d.getTime() + dayMs)) {
      const x = xOf(d.getTime());
      ctx.beginPath();
      ctx.moveTo(x, barTop - 4);
      ctx.lineTo(x, barTop + barH + 12);
      ctx.strokeStyle = "rgba(90,110,140,0.18)";
      ctx.stroke();
      const dom = d.getUTCDate();
      if (dom === 1 || d.getTime() === day.getTime()) {
        const label = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
        ctx.fillText(label, x + 3, h - 4);
      }
    }

    // playhead
    const px = xOf(currentMs);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, barTop - 8);
    ctx.lineTo(px, barTop + barH + 16);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(px, barTop - 8, 3, 0, Math.PI * 2);
    ctx.fill();
  }, [samples, currentMs, height]);

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
