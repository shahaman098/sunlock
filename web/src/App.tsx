import { useEffect, useMemo, useState } from "react";
import MapView from "./components/MapView";
import TimelineStrip from "./components/TimelineStrip";
import { buildShadowField, loadTerrain, computeShadow, type ShadowField, type TerrainMeta } from "./lib/terrain";
import { buildSkies, findWindows, siteSeries, statsFor, type Sample, type SiteStats } from "./lib/analysis";
import { skyAt } from "./lib/selene";

const START = new Date(Date.UTC(2027, 0, 1));
const DAYS = 180;
const STEP_MIN = 30;

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  }) + " UTC";

const fmtDay = (ms: number) =>
  new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export default function App() {
  const [meta, setMeta] = useState<TerrainMeta | null>(null);
  const [field, setField] = useState<ShadowField | null>(null);
  const [hillshade, setHillshade] = useState<HTMLImageElement | null>(null);
  const [selectedId, setSelectedId] = useState("peak-shackleton");
  const [currentMs, setCurrentMs] = useState(START.getTime() + 14 * 86400000);
  const [missionDays, setMissionDays] = useState(14);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadTerrain()
      .then(({ meta, shadows }) => {
        if (!alive) return;
        setMeta(meta);
        setField(buildShadowField(meta, shadows));
        const img = new Image();
        img.onload = () => alive && setHillshade(img);
        img.src = `${import.meta.env.BASE_URL}terrain/hillshade.jpg`;
      })
      .catch((e) => setError(String(e)));
    return () => { alive = false; };
  }, []);

  const skies = useMemo(() => buildSkies(START, DAYS, STEP_MIN), []);
  const series = useMemo(() => {
    if (!meta) return new Map<string, Sample[]>();
    return new Map(meta.sites.map((s) => [s.id, siteSeries(s, skies)]));
  }, [meta, skies]);
  const stats = useMemo(() => {
    if (!meta) return new Map<string, SiteStats>();
    return new Map(meta.sites.map((s) => [s.id, statsFor(series.get(s.id)!, STEP_MIN)]));
  }, [meta, series]);

  const sites = meta?.sites ?? [];
  const selected = sites.find((s) => s.id === selectedId) ?? sites[0];
  const selSeries = selected ? series.get(selected.id) ?? [] : [];
  const selStats = selected ? stats.get(selected.id) : undefined;

  const currentSky = useMemo(() => skyAt(new Date(currentMs)), [currentMs]);
  const shadow = useMemo(() => (field ? computeShadow(field, currentSky) : null), [field, currentSky]);

  const windows = useMemo(() => {
    if (!selected) return [];
    return findWindows(selected, skies, STEP_MIN, missionDays, 4);
  }, [selected, skies, missionDays]);

  const ranked = [...sites].sort((a, b) => (stats.get(b.id)?.score ?? 0) - (stats.get(a.id)?.score ?? 0));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <div>
            <h1>SUNLOCK</h1>
            <p>The lunar south pole landing-window navigator</p>
          </div>
        </div>
        <div className="provenance">
          LRO&nbsp;LOLA 80&nbsp;m DEM · IAU&nbsp;2015 lunar frame · JPL-grade ephemeris
        </div>
      </header>

      {error && <div className="error">Failed to load terrain: {error}</div>}

      <main className="layout">
        <section className="map-panel">
          <MapView
            hillshade={hillshade}
            field={field}
            shadow={shadow}
            sites={sites}
            selectedId={selectedId}
            onSelect={setSelectedId}
            sky={currentSky}
          />
          <div className="scrubber">
            <div className="scrub-head">
              <span className="scrub-date">{fmtDate(currentMs)}</span>
              <span className="scrub-meta">
                {shadow ? `${(shadow.frac * 100).toFixed(0)}% of the region sunlit` : "computing…"}
              </span>
            </div>
            <input
              type="range"
              min={START.getTime()}
              max={START.getTime() + DAYS * 86400000}
              step={30 * 60000}
              value={currentMs}
              onChange={(e) => setCurrentMs(Number(e.target.value))}
              aria-label="Time"
            />
          </div>
        </section>

        <aside className="side">
          <div className="card site-card">
            <div className="card-head">
              <h2>{selected?.name ?? "—"}</h2>
              <span className="coord">
                {selected ? `${Math.abs(selected.lat).toFixed(2)}°S ${selected.lon.toFixed(1)}°E` : ""}
              </span>
            </div>
            {selected && <p className="blurb">{selected.blurb}</p>}

            <div className="statgrid">
              <Stat label="Sunlight" value={selStats ? `${selStats.illumPct.toFixed(0)}%` : "…"} hint="of the 180-day window" />
              <Stat label="Longest night" value={selStats ? `${(selStats.longestDarkH / 24).toFixed(1)} d` : "…"} hint="continuous darkness" />
              <Stat label="Earth link" value={selStats ? `${selStats.commPct.toFixed(0)}%` : "…"} hint="line-of-sight to Earth" />
              <Stat label="Elevation" value={selected ? `${selected.elevationM} m` : "…"} hint="above 1737.4 km datum" />
            </div>

            {selected && selStats && (
              <div className="verdict">
                {selStats.illumPct > 65 && selStats.commPct > 90
                  ? "Survivable baseline: near-continuous power and a reliable Earth link."
                  : selStats.longestDarkH > 24 * 4
                    ? "Marginal: the site loses the Sun for days at a time. Power and thermal design dominate."
                    : "Workable with a battery buffer; comm windows need scheduling."}
              </div>
            )}

            {windows.length > 0 && (
              <button className="cta" onClick={() => setCurrentMs(windows[0].start)}>
                Jump to the best {missionDays}-day window → {fmtDay(windows[0].start)}
              </button>
            )}
          </div>

          <div className="card">
            <h3 className="card-title">Site ranking</h3>
            <div className="rank">
              {ranked.map((s, i) => {
                const st = stats.get(s.id);
                return (
                  <button
                    key={s.id}
                    className={s.id === selectedId ? "rank-row rank-active" : "rank-row"}
                    onClick={() => setSelectedId(s.id)}
                  >
                    <span className="rank-i">{String(i + 1).padStart(2, "0")}</span>
                    <span className="rank-name">{s.name}</span>
                    <span className="rank-sun">{st ? `${st.illumPct.toFixed(0)}%` : "…"}</span>
                    <span className="rank-score">{st?.score ?? "—"}</span>
                  </button>
                );
              })}
            </div>
            <p className="fineprint">Score blends illumination, Earth-link duty cycle, array output and the longest dark interval.</p>
          </div>
        </aside>
      </main>

      <section className="ribbon">
        <div className="ribbon-head">
          <h3>{selected?.name}: half a lunar year of light</h3>
          <div className="legend-inline">
            <span className="chip chip-sun" /> sunlight
            <span className="chip chip-dark" /> shadow
            <span className="chip chip-comm" /> Earth link
          </div>
        </div>
        {selSeries.length > 1 && (
          <TimelineStrip samples={selSeries} currentMs={currentMs} onScrub={setCurrentMs} />
        )}

        <div className="finder">
          <label>
            Mission length
            <select value={missionDays} onChange={(e) => setMissionDays(Number(e.target.value))}>
              {[1, 3, 7, 14, 21, 30].map((d) => (
                <option key={d} value={d}>{d} Earth days</option>
              ))}
            </select>
          </label>
          <div className="windows">
            {windows.map((w) => (
              <button key={w.start} className="window" onClick={() => setCurrentMs(w.start)}>
                <span className="w-date">{fmtDay(w.start)}</span>
                <span className="w-meta">{w.illumPct.toFixed(0)}% sun · {w.commPct.toFixed(0)}% link</span>
              </button>
            ))}
            {windows.length === 0 && <span className="fineprint">No window fits that length in this range.</span>}
          </div>
        </div>
      </section>

      <footer className="method">
        <details>
          <summary>Method, data and limitations</summary>
          <div className="method-body">
            <p>
              Terrain: NASA <b>LRO LOLA</b> gridded elevation model <code>LDEM_80S_80M</code> (PDS Geosciences
              Node, LRO-L-LOLA-4-GDR-V1.0), 80 m/pixel, south polar stereographic, referenced to a 1737.4 km
              sphere. The local horizon at each site is ray-marched over 360 azimuths for up to 64 km.
            </p>
            <p>
              Ephemeris: Sun and Earth vectors from <b>Astronomy Engine</b> (VSOP87/ELP-based), rotated into
              the lunar body-fixed frame using the IAU WGCCRE 2015 mean Earth/polar axis model. A site is
              sunlit when the solar elevation exceeds its terrain horizon in that azimuth; the Earth link is
              counted while Earth is above the horizon, allowing for its ~0.95° angular radius.
            </p>
            <p className="limits">
              <b>Limitations.</b> No atmospheric refraction, no terrain self-shadowing between distant
              peaks, no physical libration, no thermal or power-system model, 80 m terrain resolution. This
              is a planning aid for comparison and intuition, not a flight-qualified analysis tool.
            </p>
          </div>
        </details>
      </footer>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-hint">{hint}</span>
    </div>
  );
}
