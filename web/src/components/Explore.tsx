import type { ReactNode } from "react";
import TimelineStrip from "./TimelineStrip";
import type { Sample } from "../lib/analysis";

export type ExploreSite = { id: string; name: string; lit: boolean; survives: boolean | null };

type Props = {
  /** the 3D scene, drawn edge to edge behind everything else */
  scene: ReactNode;
  sceneMode: "moon" | "surface";
  onSceneMode: (m: "moon" | "surface") => void;
  /** why the surface view is unavailable for this site, or null when it is available */
  surfaceBlocked: string | null;

  site: { name: string; kind: string; coords: string; blurb: string } | null;
  verdict: { state: "ok" | "bad" | "none"; title: string; detail: string };
  now: { lit: boolean; comm: boolean; sunNote: string; earthNote: string } | null;
  yearStats: { year: number; sunPct: number; earthPct: number; darkDays: number } | null;
  landerLine: string;
  windows: { start: number; label: string; meta: string }[];

  sites: ExploreSite[];
  selectedId: string;
  onSelect: (id: string) => void;
  landLabel: string;

  currentMs: number;
  dateText: string;
  timeText: string;
  months: { label: string; pct: number }[];
  samples: Sample[];
  playing: boolean;
  speedH: number;
  onPlay: () => void;
  onSpeed: (h: number) => void;
  onStep: (ms: number) => void;
  onTime: (ms: number) => void;

  onCamera: (to: "pole" | "earth" | "terminator" | "site") => void;
  onConsole: () => void;
  onMethod: () => void;
  onTour: () => void;
  onCopy: () => void;
  copied: boolean;
};

const H = 3600000;

/**
 * The 3D way in: the Moon fills the window, and the answer for the chosen site, the list of
 * sites and the clock float over it. Everything shown is the same state the mission console
 * works on, so switching between the two keeps the site, the date and the lander.
 */
export default function Explore(p: Props) {
  return (
    <div className="ex">
      <div className={p.sceneMode === "surface" ? "ex-scene is-surface" : "ex-scene"}>{p.scene}</div>

      <header className="ex-top">
        <div className="cx-brand">
          <span className="brand-mark" aria-hidden />
          <div>
            <h1>SUNLOCK</h1>
            <p>Will your Moon lander survive at the south pole?</p>
          </div>
        </div>
        <div className="ex-actions">
          <button className="cx-btn" onClick={p.onCopy} title="Copy a link to exactly this view: site, date and lander">{p.copied ? "Link copied" : "Copy link"}</button>
          <button className="cx-btn" onClick={p.onMethod}>How it works</button>
          <button className="cx-btn" onClick={p.onTour}>Take the tour</button>
          <button className="cx-btn ex-primary" onClick={p.onConsole} title="Charts, lander set-up, site finder and the evidence behind every number">
            Mission console
            <svg viewBox="0 0 12 12" aria-hidden><path d="M2 6h7M6 2.5 9.5 6 6 9.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
          </button>
        </div>
      </header>

      <nav className="ex-sites ex-panel" aria-label="Landing sites">
        <span className="ex-k">NASA's Artemis III sites</span>
        <span className="ex-sub">if you land {p.landLabel}</span>
        <ul>
          {p.sites.map((s) => (
            <li key={s.id}>
              <button className={s.id === p.selectedId ? "ex-site is-on" : "ex-site"} onClick={() => p.onSelect(s.id)} aria-pressed={s.id === p.selectedId}
                      title={`${s.name}: ${s.lit ? "in sunlight" : "in shadow"} now${s.survives === null ? "" : s.survives ? "; your lander survives" : "; your lander does not survive"}`}>
                <i className={s.lit ? "ex-dot is-lit" : "ex-dot"} aria-hidden />
                <span className="ex-site-name">{s.name}</span>
                <span className={s.survives === null ? "ex-mark" : s.survives ? "ex-mark ok" : "ex-mark bad"} aria-hidden>{s.survives === null ? "–" : s.survives ? "✓" : "✗"}</span>
              </button>
            </li>
          ))}
        </ul>
        <span className="ex-legend">
          <span><i className="ex-dot is-lit" aria-hidden /> sunlit now</span>
          <span><i className="ex-dot" aria-hidden /> in shadow</span>
          <span>✓ ✗ your lander survives or not</span>
        </span>
      </nav>

      {p.site && (
        <aside className="ex-card ex-panel" aria-label="Selected site" aria-live="polite">
          <div className="ex-card-head">
            <span className="ex-chip">{p.site.kind}</span>
            <span className="ex-coords">{p.site.coords}</span>
          </div>
          <h2>{p.site.name}</h2>
          <div className={`ex-verdict is-${p.verdict.state}`}>
            <span className="ex-k">{p.landerLine}</span>
            <strong>{p.verdict.title}</strong>
            <p>{p.verdict.detail}</p>
          </div>
          {p.now && (
            <div className="ex-now">
              <div>
                <span className="ex-k">Sunlight</span>
                <b className={p.now.lit ? "is-sun" : ""}>{p.now.lit ? "In sun" : "In shadow"}</b>
                <small>{p.now.sunNote}</small>
              </div>
              <div>
                <span className="ex-k">Earth</span>
                <b className={p.now.comm ? "is-comm" : ""}>{p.now.comm ? "In view" : "Hidden"}</b>
                <small>{p.now.earthNote}</small>
              </div>
            </div>
          )}
          {p.yearStats && (
            <dl className="ex-stats">
              <div><dt>Sunlight in {p.yearStats.year}</dt><dd>{p.yearStats.sunPct.toFixed(0)}%</dd></div>
              <div><dt>Earth in view</dt><dd>{p.yearStats.earthPct.toFixed(0)}%</dd></div>
              <div><dt>Longest dark</dt><dd>{p.yearStats.darkDays.toFixed(1)} d</dd></div>
            </dl>
          )}
          {p.windows.length > 0 && (
            <div className="ex-windows">
              <span className="ex-k">Best landing dates here</span>
              {p.windows.map((w) => (
                <button key={w.start} className="ex-window" onClick={() => p.onTime(w.start)} title="Jump to this landing">
                  <b>{w.label}</b><span>{w.meta}</span>
                </button>
              ))}
            </div>
          )}
          <p className="ex-blurb">{p.site.blurb}</p>
          <button className="cx-btn ex-wide" onClick={p.onConsole}>Open the full analysis</button>
        </aside>
      )}

      <div className="ex-cam">
        <div className="segmented" role="group" aria-label="Scene">
          <button className={p.sceneMode === "moon" ? "seg seg-on" : "seg"} onClick={() => p.onSceneMode("moon")} aria-pressed={p.sceneMode === "moon"}>Moon</button>
          <button className={p.sceneMode === "surface" ? "seg seg-on" : "seg"} onClick={() => p.onSceneMode("surface")} aria-pressed={p.sceneMode === "surface"}
                  disabled={!!p.surfaceBlocked} title={p.surfaceBlocked ?? "Stand at the site: the LOLA terrain around it, with the Sun and Earth where they are in its sky"}>
            Surface
          </button>
        </div>
        {p.sceneMode === "moon" && (
          <div className="segmented" role="group" aria-label="Fly the camera to">
            <button className="seg" onClick={() => p.onCamera("site")}>Site</button>
            <button className="seg" onClick={() => p.onCamera("pole")}>South pole</button>
            <button className="seg" onClick={() => p.onCamera("earth")}>From Earth</button>
            <button className="seg" onClick={() => p.onCamera("terminator")}>Day–night line</button>
          </div>
        )}
      </div>

      <section className="ex-time" aria-label="Time">
        <div className="ex-clock">
          <div className="ex-transport">
            <button className="tp-btn" onClick={() => p.onStep(-24 * H)} aria-label="Back one day" title="Back one day (Shift ←)">−1 d</button>
            <button className="tp-btn" onClick={() => p.onStep(-6 * H)} aria-label="Back six hours" title="Back 6 hours (←)">−6 h</button>
          </div>
          <div className="ex-date" role="status">
            <b>{p.dateText}</b>
            <span>{p.timeText} UTC</span>
          </div>
          <div className="ex-transport">
            <button className="tp-btn" onClick={() => p.onStep(6 * H)} aria-label="Forward six hours" title="Forward 6 hours (→)">+6 h</button>
            <button className="tp-btn" onClick={() => p.onStep(24 * H)} aria-label="Forward one day" title="Forward one day (Shift →)">+1 d</button>
          </div>
          <button className={p.playing ? "tp-btn tp-play tp-on" : "tp-btn tp-play"} onClick={p.onPlay} aria-pressed={p.playing} title="Play or pause (Space)">
            <svg viewBox="0 0 12 12" aria-hidden>
              {p.playing ? <path d="M2,1 h3 v10 H2z M7,1 h3 v10 H7z" fill="currentColor" /> : <path d="M2,1 L11,6 L2,11z" fill="currentColor" />}
            </svg>
            {p.playing ? "Pause" : "Play"}
          </button>
          <div className="segmented" role="group" aria-label="Playback speed">
            {[6, 24, 72].map((h) => (
              <button key={h} className={p.speedH === h ? "seg seg-on" : "seg"} onClick={() => p.onSpeed(h)} aria-pressed={p.speedH === h}
                      title={h < 24 ? `${h} hours per second` : `${h / 24} day${h > 24 ? "s" : ""} per second`}>
                {h === 6 ? "Slow" : h === 24 ? "Normal" : "Fast"}
              </button>
            ))}
          </div>
        </div>
        <div className="ex-ribbon">
          <div className="ex-months" aria-hidden>
            {p.months.map((m) => <span key={m.label} style={{ left: `${m.pct}%` }}>{m.label}</span>)}
          </div>
          {p.samples.length > 1 && <TimelineStrip samples={p.samples} currentMs={p.currentMs} onScrub={p.onTime} height={30} />}
          <span className="ex-ribbon-key"><i className="k-sun" /> sunlight at {p.site?.name ?? "the site"} <i className="k-comm" /> Earth in view · drag to change the date</span>
        </div>
      </section>
    </div>
  );
}
