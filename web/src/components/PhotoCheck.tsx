import { useEffect, useMemo, useRef, useState } from "react";

type Meta = {
  side: number;
  stepKm: number;
  frames: { t: string; name: string }[];
  summary: {
    agreePct: number; alwaysDarkWouldAgreePct: number; n: number;
    photographedTransitions: number; transitions: number; medianAbsErrorH: number; within2hPct: number;
    survival7dAgreePct: number; survival7dMissions: number; whenWeSaySurvivesPhotosAgreePct: number;
  };
};

const COL = { outside: "#0c0c0f", noPhoto: "#232327", dark: "#1b2740", bright: "#f5c14a", agree: "#2b2b30", weBright: "#f64137", weDark: "#288bff" };

/**
 * Photograph against model, frame by frame: LROC's timestamped photographs of the south pole
 * (December 2009, one per orbit) beside what SUNLOCK predicts for the same minute, on the same
 * 1 km grid, and where the two differ. Data: web/scripts/validate-wac-movie.mjs.
 */
export default function PhotoCheck() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [cells, setCells] = useState<Uint8Array | null>(null);
  const [err, setErr] = useState(false);
  const [f, setF] = useState(60);
  const [playing, setPlaying] = useState(false);
  const refs = [useRef<HTMLCanvasElement>(null), useRef<HTMLCanvasElement>(null), useRef<HTMLCanvasElement>(null)];

  useEffect(() => {
    let alive = true;
    const base = `${import.meta.env.BASE_URL}terrain/`;
    Promise.all([
      fetch(`${base}wac-movie.json`).then((r) => { if (!r.ok) throw new Error(); return r.json(); }),
      fetch(`${base}wac-movie.bin`).then((r) => { if (!r.ok) throw new Error(); return r.arrayBuffer(); }),
    ]).then(([m, b]) => { if (alive) { setMeta(m); setCells(new Uint8Array(b)); } }).catch(() => alive && setErr(true));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!playing || !meta) return;
    const id = window.setInterval(() => setF((x) => (x + 1) % meta.frames.length), 140);
    return () => window.clearInterval(id);
  }, [playing, meta]);

  /** this frame: samples the photograph covers, how many agree, and each kind of disagreement */
  const stat = useMemo(() => {
    if (!meta || !cells) return null;
    const n2 = meta.side * meta.side;
    let n = 0, agree = 0, weBright = 0, weDark = 0;
    for (let i = 0; i < n2; i++) {
      const v = cells[f * n2 + i];
      if (v === 255 || (v & 3) === 0) continue;
      const photo = (v & 3) === 2, us = (v & 4) !== 0;
      n++;
      if (photo === us) agree++; else if (us) weBright++; else weDark++;
    }
    return { n, agree, weBright, weDark };
  }, [meta, cells, f]);

  useEffect(() => {
    if (!meta || !cells) return;
    const side = meta.side, n2 = side * side;
    refs.forEach((ref, which) => {
      const c = ref.current;
      if (!c) return;
      const px = 4;
      c.width = c.height = side * px;
      const g = c.getContext("2d")!;
      g.fillStyle = COL.outside;
      g.fillRect(0, 0, c.width, c.height);
      for (let i = 0; i < n2; i++) {
        const v = cells[f * n2 + i];
        if (v === 255) continue;
        const has = (v & 3) !== 0, photo = (v & 3) === 2, us = (v & 4) !== 0;
        g.fillStyle = which === 0 ? (!has ? COL.noPhoto : photo ? COL.bright : COL.dark)
          : which === 1 ? (us ? COL.bright : COL.dark)
          : !has ? COL.noPhoto : photo === us ? COL.agree : us ? COL.weBright : COL.weDark;
        g.fillRect((i % side) * px, Math.floor(i / side) * px, px, px);
      }
      // the pole
      g.strokeStyle = "rgba(255,255,255,0.7)";
      g.lineWidth = 1;
      const m = (side * px) / 2;
      g.beginPath(); g.moveTo(m - 5, m); g.lineTo(m + 5, m); g.moveTo(m, m - 5); g.lineTo(m, m + 5); g.stroke();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, cells, f]);

  if (err) return <p className="fineprint">The photograph comparison data could not be loaded.</p>;
  if (!meta || !cells) return <p className="fineprint">Loading the photograph comparison…</p>;
  const s = meta.summary, fr = meta.frames[f];
  const when = new Date(fr.t).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return (
    <div className="pc">
      <p>
        <b>Shadow timing against photographs</b> (exploratory, not pre-registered). NASA's LROC camera photographed the south
        pole about every two hours. Below, each of the {meta.frames.length} photographs from December 2009 is beside what SUNLOCK
        predicts for the same minute, at {Math.round(s.n / meta.frames.length).toLocaleString("en-GB")} points on a {meta.stepKm} km grid within 24 km of the pole.
      </p>
      <div className="pc-grids">
        {(["Photograph", "SUNLOCK", "Where they differ"] as const).map((t, i) => (
          <figure key={t}>
            <canvas ref={refs[i]} role="img" aria-label={`${t}, ${when} UTC`} />
            <figcaption>{t}</figcaption>
          </figure>
        ))}
      </div>
      <div className="pc-bar">
        <button className={playing ? "tp-btn tp-play tp-on" : "tp-btn tp-play"} onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>
          <svg viewBox="0 0 12 12" aria-hidden>
            {playing ? <path d="M2,1 h3 v10 H2z M7,1 h3 v10 H7z" fill="currentColor" /> : <path d="M2,1 L11,6 L2,11z" fill="currentColor" />}
          </svg>
          {playing ? "Pause" : "Play"}
        </button>
        <input type="range" min={0} max={meta.frames.length - 1} step={1} value={f} onChange={(e) => { setPlaying(false); setF(Number(e.target.value)); }}
               aria-label="Photograph" aria-valuetext={`${when} UTC`} />
        <span className="pc-when">{when} UTC</span>
      </div>
      <div className="pc-legend">
        <span><i style={{ background: COL.bright }} /> sunlit</span>
        <span><i style={{ background: COL.dark }} /> dark</span>
        <span><i style={{ background: COL.weBright }} /> we say sunlit, photo dark</span>
        <span><i style={{ background: COL.weDark }} /> we say dark, photo sunlit</span>
        <span><i style={{ background: COL.noPhoto }} /> outside the photo</span>
      </div>
      {stat && (
        <p className="pc-frame" role="status">
          This photograph: {stat.n ? <><b>{((100 * stat.agree) / stat.n).toFixed(1)}%</b> of {stat.n.toLocaleString("en-GB")} points agree
          ({stat.weBright} we call sunlit but the photo is dark, {stat.weDark} the other way).</> : "no points inside the photograph."}
        </p>
      )}
      <ul className="pc-sum">
        <li><b>{s.agreePct.toFixed(1)}%</b> of all {s.n.toLocaleString("en-GB")} samples agree. Most samples are dark, so calling everything dark would score {s.alwaysDarkWouldAgreePct.toFixed(1)}%.</li>
        <li>Of {s.photographedTransitions.toLocaleString("en-GB")} photographed sunrises and sunsets, we match {s.transitions.toLocaleString("en-GB")} within a day; for those the median timing error is <b>{s.medianAbsErrorH} h</b> ({s.within2hPct.toFixed(0)}% within 2 h; photographs are about 1.9 h apart). The other {(s.photographedTransitions - s.transitions).toLocaleString("en-GB")} have no match.</li>
        <li>7-day missions run on the photographed light and on ours agree {s.survival7dAgreePct.toFixed(1)}% of the time ({s.survival7dMissions.toLocaleString("en-GB")} missions). When we say a lander survives, the photographs agree <b>{s.whenWeSaySurvivesPhotosAgreePct.toFixed(1)}%</b> of the time. 14-day stays could not be tested with this month of photographs.</li>
      </ul>
      <p className="fineprint">
        "Sunlit" in a photograph means brighter than a threshold set from the photographs alone; for SUNLOCK here it means at least half the Sun's
        disc is above the skyline (a pixel only reads bright with substantial direct light). One month in southern summer; a slope facing away
        from a low Sun can read dark in a photo while the Sun is above the skyline. Source: LROC WAC_POLE_MOVIE_SOUTH; up is toward 0°E, the cross marks the pole.
      </p>
    </div>
  );
}
