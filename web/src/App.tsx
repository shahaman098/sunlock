import { useEffect, useMemo, useState } from "react";
import MapView from "./components/MapView";
import SkyView from "./components/SkyView";
import TimelineStrip from "./components/TimelineStrip";
import { buildShadowField, loadTerrain, computeShadow, customHorizon, unprojectFromUnit, type ElevationGrid, type ShadowField, type TerrainMeta } from "./lib/terrain";
import { buildSkies, commWindows, findWindows, siteSeries, statsFor, upcomingWindows, type Sample, type SiteStats } from "./lib/analysis";
import { skyAt, readSite, siteBasis, lookAngles, type Site } from "./lib/selene";
import { arrayPowerPerM2, batteryWh, energyWh, fmtEnergy, fmtPower, type ArrayMode } from "./lib/power";

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

const fmtDuration = (h: number) => {
  if (h >= 48) return `${(h / 24).toFixed(1)} d`;
  if (h >= 1) return `${h.toFixed(1)} h`;
  return `${Math.round(h * 60)} min`;
};

export default function App() {
  const [meta, setMeta] = useState<TerrainMeta | null>(null);
  const [field, setField] = useState<ShadowField | null>(null);
  const [hillshade, setHillshade] = useState<HTMLImageElement | null>(null);
  const [selectedId, setSelectedId] = useState("peak-shackleton");
  const [currentMs, setCurrentMs] = useState(START.getTime() + 14 * 86400000);
  const [missionDays, setMissionDays] = useState(14);
  const [arrayMode, setArrayMode] = useState<ArrayMode>("tracking");
  const [error, setError] = useState<string | null>(null);
  const [verify, setVerify] = useState<{
    epochs: number;
    geometry: { maxSunArcsec: number; maxEarthArcsec: number };
    frame: { maxSunLonDeg: number; maxSunLatDeg: number };
  } | null>(null);
  const [elevation, setElevation] = useState<ElevationGrid | null>(null);
  const [customSite, setCustomSite] = useState<Site | null>(null);

  useEffect(() => {
    let alive = true;
    loadTerrain()
      .then(({ meta, shadows, elevation }) => {
        if (!alive) return;
        setMeta(meta);
        setElevation(elevation);
        setField(buildShadowField(meta, shadows));
        const img = new Image();
        img.onload = () => alive && setHillshade(img);
        img.src = `${import.meta.env.BASE_URL}terrain/hillshade.jpg`;
      })
      .catch((e) => setError(String(e)));

    fetch(`${import.meta.env.BASE_URL}terrain/verification.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => { if (alive && v) setVerify(v); })
      .catch(() => {});

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

  const officialSites = useMemo(() => meta?.sites ?? [], [meta]);
  const sites = useMemo(
    () => (customSite ? [...officialSites, customSite] : officialSites),
    [officialSites, customSite]
  );
  const selected = sites.find((s) => s.id === selectedId) ?? officialSites[0];

  const customSeries = useMemo(
    () => (customSite ? siteSeries(customSite, skies) : []),
    [customSite, skies]
  );
  const customStats = useMemo(
    () => (customSite && customSeries.length ? statsFor(customSeries, STEP_MIN) : undefined),
    [customSite, customSeries]
  );

  const selSeries = useMemo(
    () =>
      selected
        ? selected.id === "custom"
          ? customSeries
          : series.get(selected.id) ?? []
        : [],
    [selected, customSeries, series]
  );
  const selStats = useMemo(
    () =>
      selected
        ? selected.id === "custom"
          ? customStats
          : stats.get(selected.id)
        : undefined,
    [selected, customStats, stats]
  );

  const pickPoint = (u: { x: number; y: number }) => {
    if (!elevation) return;
    const { lat, lon, inside } = unprojectFromUnit(u);
    if (!inside) return;
    const { horizon, elevationM } = customHorizon(elevation, lat, lon);
    setCustomSite({
      id: "custom",
      name: "Custom point",
      lat: Number(lat.toFixed(3)),
      lon: Number(lon.toFixed(3)),
      elevationM,
      blurb: "Picked on the map. Horizon ray-marched on the 1024² elevation grid (about 600 m per pixel), not the full 80 m model used for the preset regions.",
      horizonDeg: horizon,
    });
    setSelectedId("custom");
  };

  const currentSky = useMemo(() => skyAt(new Date(currentMs)), [currentMs]);
  const shadow = useMemo(() => (field ? computeShadow(field, currentSky) : null), [field, currentSky]);

  const reading = useMemo(
    () => (selected ? readSite(selected, currentSky) : null),
    [selected, currentSky]
  );

  // Sun track around the selected moment, for the sky panorama.
  const track = useMemo(() => {
    if (!selected) return [];
    const basis = siteBasis(selected.lat, selected.lon);
    const pts: { az: number; elev: number }[] = [];
    const dayMs = 86400000;
    for (let t = currentMs - 20 * dayMs; t <= currentMs + 20 * dayMs; t += 6 * 3600000) {
      const l = lookAngles(skyAt(new Date(t)).sun, basis);
      pts.push({ az: l.az, elev: Math.max(-6, Math.min(16, l.elev)) });
    }
    return pts;
  }, [selected, currentMs]);

  const windows = useMemo(
    () => (selSeries.length ? findWindows(selSeries, STEP_MIN, missionDays, 4) : []),
    [selSeries, missionDays]
  );

  const comms = useMemo(() => (selSeries.length ? commWindows(selSeries, STEP_MIN) : []), [selSeries]);
  const nextComms = useMemo(() => (comms.length ? upcomingWindows(comms, currentMs, 4) : []), [comms, currentMs]);

  const powerNow = reading ? arrayPowerPerM2(reading.sunElev, reading.lit, arrayMode) : 0;
  const altMode: ArrayMode = arrayMode === "tracking" ? "horizontal" : "tracking";
  const energyTotal = selSeries.length ? energyWh(selSeries, STEP_MIN, arrayMode, 1) : 0;
  const altTotal = selSeries.length ? energyWh(selSeries, STEP_MIN, altMode, 1) : 0;
  const energyPerDay = energyTotal / DAYS;
  const altPerDay = altTotal / DAYS;
  const battery = selStats ? batteryWh(selStats.longestDarkH, 100) : 0;

  const ranked = [...officialSites].sort((a, b) => (stats.get(b.id)?.score ?? 0) - (stats.get(a.id)?.score ?? 0));

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
          LRO&nbsp;LOLA 80&nbsp;m DEM · IAU&nbsp;2015 lunar frame
          {verify && <> · cross-checked vs JPL&nbsp;Horizons</>}
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
            onPick={pickPoint}
            custom={customSite}
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
              step={STEP_MIN * 60000}
              value={currentMs}
              onChange={(e) => setCurrentMs(Number(e.target.value))}
              aria-label="Time"
            />
          </div>

          {reading && (
            <SkyView
              horizon={selected.horizonDeg}
              sun={{ az: reading.sunAz, elev: reading.sunElev }}
              earth={{ az: reading.earthAz, elev: reading.earthElev }}
              track={track}
              sunLit={reading.lit}
              earthComm={reading.comm}
            />
          )}
        </section>

        <aside className="side">
          <div className="card site-card">
            <div className="card-head">
              <h2>
                {selected?.name ?? "—"}
                {selected?.id === "custom" && (
                  <button className="clear-custom" onClick={() => { setCustomSite(null); setSelectedId("peak-shackleton"); }}>
                    clear
                  </button>
                )}
              </h2>
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
            <div className="card-head">
              <h3 className="card-title">Power and storage</h3>
              <div className="segmented" role="group" aria-label="Array orientation">
                <button
                  className={arrayMode === "tracking" ? "seg seg-on" : "seg"}
                  onClick={() => setArrayMode("tracking")}
                >Sun-facing</button>
                <button
                  className={arrayMode === "horizontal" ? "seg seg-on" : "seg"}
                  onClick={() => setArrayMode("horizontal")}
                >Horizontal</button>
              </div>
            </div>

            <div className="statgrid">
              <Stat label="Now" value={fmtPower(powerNow)} hint="per m² of array" />
              <Stat label="Daily yield" value={energyPerDay ? `${(energyPerDay / 1000).toFixed(1)} kWh` : "…"} hint="per m², averaged" />
            </div>

            <div className="power-note">
              A {arrayMode === "tracking" ? "sun-facing" : "horizontal"} panel yields{" "}
              <b>{(energyPerDay / 1000).toFixed(2)} kWh/m²/day</b> here.{" "}
              {arrayMode === "horizontal"
                ? "At these Sun elevations a flat panel collects almost nothing — which is why polar arrays are mounted vertically."
                : "Tracking the Sun is the only way to make a polar array useful; the alternative gathers "}
              {arrayMode !== "horizontal" && <b>{(altPerDay / 1000).toFixed(2)} kWh/m²/day</b>}
              {arrayMode !== "horizontal" && " instead."}
            </div>

            <div className="battery">
              <span className="battery-k">Ride through the longest night</span>
              <span className="battery-v">{fmtEnergy(battery)}</span>
              <span className="battery-h">
                battery for a 100 W load across {selStats ? (selStats.longestDarkH / 24).toFixed(1) : "—"} days, at 80% depth of discharge
              </span>
            </div>
            <p className="fineprint">
              First-order model: 1361 W/m², 28% cell efficiency, 0.9 system derate, no thermal or dust modelling.
            </p>
          </div>

          <div className="card">
            <h3 className="card-title">Earth-link windows</h3>
            <div className="linkstate">
              {reading && (
                <>
                  <span className={reading.comm ? "dot-live dot-ok" : "dot-live dot-off"} />
                  {reading.comm ? "In contact now" : "No contact now"}
                  <span className="linkmargin">
                    {reading.earthElev >= 0 ? "+" : ""}
                    {reading.earthElev.toFixed(1)}° elevation · skyline {reading.earthHorizon.toFixed(1)}°
                  </span>
                </>
              )}
            </div>
            <ul className="windowlist">
              {nextComms.map((w, i) => (
                <li key={`${w.start}-${i}`}>
                  <button className="wlink" onClick={() => setCurrentMs(w.start)}>
                    <span className="w-when">
                      {fmtDay(w.start)} · {new Date(w.start).toISOString().slice(11, 16)}Z
                    </span>
                    <span className="w-len">{fmtDuration(w.hours)}</span>
                    <span className="w-margin">+{w.margin.toFixed(1)}°</span>
                  </button>
                </li>
              ))}
              {nextComms.length === 0 && <li className="fineprint">No windows in this range.</li>}
            </ul>
            <p className="fineprint">
              {comms.length} separate windows across the 180 days; clearance is the mean margin above the local skyline.
            </p>
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
              sphere. The local horizon at each site is ray-marched over 360 azimuths for up to 64 km,
              with the lunar curvature drop subtracted, sampling every two pixels with nearest-neighbour
              lookup. That sampling convention is stated deliberately: illumination at a marginal site is
              sensitive to it (see BENCHMARKS.md), so the percentage is a reproducible convention rather
              than a converged physical value.
            </p>
            <p>
              Ephemeris: Sun and Earth vectors from <b>Astronomy Engine</b> (VSOP87/ELP-based), rotated into
              the lunar body-fixed frame using the IAU WGCCRE 2015 mean Earth/polar axis model. A site is
              sunlit when the solar elevation exceeds its terrain horizon in that azimuth; the Earth link is
              counted while Earth is above the horizon, allowing for its ~0.95° angular radius.
            </p>
            {verify && (
              <p>
                <b>Independent check.</b> Two separate comparisons against JPL Horizons at{" "}
                {verify.epochs} epochs across the 2027 window. <i>Geometry:</i> Sun and Earth directions
                agree to {verify.geometry.maxSunArcsec.toFixed(1)}″ and{" "}
                {verify.geometry.maxEarthArcsec.toFixed(1)}″ — the level of aberration and light-time
                treatment, not of geometry. <i>Frame:</i> our sub-solar and sub-observer longitudes,
                which depend on the IAU rotation model, agree to {verify.frame.maxSunLonDeg.toFixed(4)}°
                in longitude and {verify.frame.maxSunLatDeg.toFixed(4)}° in latitude.
              </p>
            )}
            <p>
              Power: solar constant 1361 W/m², cell efficiency 28%, system derate 0.9. A sun-facing array is
              treated as normal-incidence; a horizontal array uses the cosine of solar zenith. Battery capacity
              is the longest continuous darkness at a 100 W load and 80% depth of discharge.
            </p>
            <p className="limits">
              <b>Limitations.</b> No atmospheric refraction, no terrain self-shadowing between distant
              peaks, no physical libration, 80 m terrain resolution, no thermal or dust modelling of array
              output. Illumination uses the centre of the solar disc; integrating over the disc changes
              the result by at most 0.4% at these sites (see BENCHMARKS.md). This is a planning aid for
              comparison and intuition, not a flight-qualified analysis tool.
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
