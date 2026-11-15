import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import MapView, { MapStatusBar, type MapLayers } from "./components/MapView";
import SkyView from "./components/SkyView";
import TimelineStrip from "./components/TimelineStrip";
import Porkchop from "./components/Porkchop";
// three.js is only downloaded when someone opens the 3D view
const Terrain3D = lazy(() => import("./components/Terrain3D"));
import { classify, loadFinder, type Finder, type FinderLimits } from "./lib/finder";
import { buildShadowField, loadTerrain, computeShadow, customHorizon, unprojectFromUnit, type ElevationGrid, type ShadowField, type TerrainMeta } from "./lib/terrain";
import { buildSkies, commWindows, raisedTerrain, siteSeries, statsFor, upcomingWindows } from "./lib/analysis";
import { skyAt, readSite, siteBasis, lookAngles, type Site } from "./lib/selene";
import { missionCsv } from "./lib/export";
import { arrayPowerPerM2, batteryWh, energyWh, fmtEnergy, fmtPower, simulateMission, porkchopRow, sizeToSurvive, stressTest, limitingCase, robustOptions, allCasesPass, earliestSurvivable, type ArrayMode, type LanderSpec, type MissionResult, type MissionRequirements, type StressCase, type TerrainCase } from "./lib/power";

const STEP_MIN = 30;
const STEP_MS = STEP_MIN * 60000;
const DAY_MS = 86400000;
/** Landing years the app models, one calendar year at a time (a full seasonal cycle). */
const YEARS = [2026, 2027, 2028, 2029, 2030];
const DEFAULT_YEAR = 2027;
/** extra days of data after 31 December, enough for the longest stay */
// longest mission (30 d) + the longest late-arrival case (3 d) + 1 d margin, so every
// stress case of any landing in the year is evaluated rather than left unknown
const PAD_DAYS = 34;

/** The modelled window for one calendar year, with the marks for its time axis. */
function yearWindow(year: number) {
  const startMs = Date.UTC(year, 0, 1);
  const days = Math.round((Date.UTC(year + 1, 0, 1) - startMs) / DAY_MS);
  const endMs = startMs + days * DAY_MS;
  const months = Array.from({ length: 12 }, (_, m) => {
    const ms = Date.UTC(year, m, 1);
    return { label: new Date(ms).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }), pct: ((ms - startMs) / (days * DAY_MS)) * 100 };
  });
  // one tick per day; Mondays and month starts stand taller
  const ticks = Array.from({ length: days + 1 }, (_, d) => {
    const date = new Date(startMs + d * DAY_MS);
    return date.getUTCDate() === 1 ? "month" : date.getUTCDay() === 1 ? "week" : "day";
  });
  return { year, startMs, days, endMs, months, ticks, endLabel: `31 December ${year}` };
}

type Validation = {
  reference: string;
  mapWide: {
    n: number; r: number; rmsePp: number; biasPp: number; stepHours: number;
    shadow?: { n: number; iou: number; tp: number; fp: number; fn: number } | null;
    earth?: { n: number; r: number; rmsePp: number; biasPp: number } | null;
  };
  preregistered?: Record<string, { test: string; result: string; n?: number; r?: number; rmsePp?: number }>;
  landingSites: { n: number; r: number; rmsePp: number; biasPp: number; within5pp: number; stepHours: number };
  earthAtLandingSites?: { n: number; r: number; rmsePp: number; biasPp: number };
};

const DEFAULT_LANDER: LanderSpec = { loadW: 100, arrayM2: 4, batteryWh: 10000, dod: 0.8, heaterW: 0 };
const PANEL_MODES: ArrayMode[] = ["tracking", "vertical", "horizontal"];
const MISSION_CHOICES = [1, 3, 7, 14, 21, 30];
const HEIGHT_CHOICES = [0, 2, 10];

/**
 * Shareable state in the URL hash, e.g.
 * #site=mons-mouton&land=2027-02-03T06:00Z&days=14&load=100&array=4&battery=10
 * Anything missing or malformed falls back to the defaults.
 */
function readHash() {
  try {
    const p = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const num = (k: string, lo: number, hi: number) => {
      const v = Number(p.get(k));
      return p.has(k) && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;
    };
    const landMs = p.has("land") ? Date.parse(p.get("land")!) : NaN;
    const days = num("days", 1, 30);
    const height = num("height", 0, 10);
    return {
      site: p.get("site") ?? undefined,
      near: p.get("near") ?? undefined,
      lat: num("lat", -90, 90),
      lon: num("lon", -180, 360),
      landMs: Number.isFinite(landMs) && YEARS.includes(new Date(landMs).getUTCFullYear())
        ? Math.round(landMs / STEP_MS) * STEP_MS
        : undefined,
      days: days !== undefined && MISSION_CHOICES.includes(days) ? days : undefined,
      height: height !== undefined && HEIGHT_CHOICES.includes(height) ? height : undefined,
      load: num("load", 10, 2000),
      heater: num("heater", 0, 2000),
      outage: num("outage", 1, 240),
      reserve: num("reserve", 0, 50),
      panels: (["tracking", "vertical", "horizontal"] as const).find((m) => m === p.get("panels")),
      array: num("array", 0.5, 50),
      battery: num("battery", 1, 200),
    };
  } catch {
    return {};
  }
}
const INITIAL = readHash();

type NearbySpot = { km: number; dir: string; lat: number; lon: number; elevationM: number; horizonDeg: number[] };

/** A nearby position as a site of its own, judged on its own precomputed 80 m skyline. */
function nearbySite(parent: Site, n: NearbySpot): Site {
  return {
    id: "custom",
    name: `${n.km} km ${n.dir} of ${parent.name}`,
    lat: n.lat, lon: n.lon, elevationM: n.elevationM, terrain: true, nearOf: parent.id, horizonDeg: n.horizonDeg,
    blurb: `${n.km} km ${n.dir} of ${parent.name}, with its own skyline from the same 80 m LOLA terrain and method as the named sites (ground level). It is not a NASA candidate site: slope and hazards here are not checked.`,
  };
}

/** Great-circle distance on the Moon, metres. */
function dist(lat1: number, lon1: number, lat2: number, lon2: number) {
  const D = Math.PI / 180;
  const c = Math.sin(lat1 * D) * Math.sin(lat2 * D) + Math.cos(lat1 * D) * Math.cos(lat2 * D) * Math.cos((lon1 - lon2) * D);
  return Math.acos(Math.min(1, Math.max(-1, c))) * 1737400;
}

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  }) + " UTC";

const fmtDay = (ms: number) =>
  new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Time from sample idx until `key` next changes, or null if it does not within the data. */
function flipAfter(ser: { t: number; lit: boolean; comm: boolean }[], idx: number, key: "lit" | "comm") {
  if (!ser.length) return null;
  const i0 = Math.min(Math.max(0, idx), ser.length - 1);
  for (let i = i0 + 1; i < ser.length; i++) if (ser[i][key] !== ser[i0][key]) return ser[i].t - ser[i0].t;
  return null;
}

/**
 * A ready-made JPL Horizons query: apparent azimuth and elevation of the Sun (10) or
 * Earth (399) seen from this point on the Moon, hourly for a day from `ms`.
 */
function horizonsUrl(body: "10" | "399", lat: number, lonE: number, ms: number) {
  const t = (x: number) => new Date(x).toISOString().slice(0, 16).replace("T", " ");
  const q: Record<string, string> = {
    format: "text", COMMAND: `'${body}'`, OBJ_DATA: "'NO'", MAKE_EPHEM: "'YES'", EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'coord@301'", COORD_TYPE: "'GEODETIC'", SITE_COORD: `'${lonE.toFixed(4)},${lat.toFixed(4)},0'`,
    START_TIME: `'${t(ms)}'`, STOP_TIME: `'${t(ms + 86400000)}'`, STEP_SIZE: "'1 h'", QUANTITIES: "'4'", ANG_FORMAT: "'DEG'",
  };
  return "https://ssd.jpl.nasa.gov/api/horizons.api?" + Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}

/** "3 d 4 h", "5 h 30 min", "20 min" */
const fmtIn = (ms: number) => {
  const m = Math.round(ms / 60000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h${mm ? ` ${mm} min` : ""}`;
  return `${mm} min`;
};

const fmtDuration = (h: number) => {
  if (h >= 48) return `${(h / 24).toFixed(1)} d`;
  if (h >= 1) return `${h.toFixed(1)} h`;
  return `${Math.round(h * 60)} min`;
};

export default function App() {
  const [meta, setMeta] = useState<TerrainMeta | null>(null);
  const [field, setField] = useState<ShadowField | null>(null);
  const [hillshade, setHillshade] = useState<HTMLImageElement | null>(null);
  const [selectedId, setSelectedIdRaw] = useState(INITIAL.site ?? "");
  const [lander, setLander] = useState<LanderSpec>({
    ...DEFAULT_LANDER,
    loadW: INITIAL.load ?? DEFAULT_LANDER.loadW,
    heaterW: INITIAL.heater ?? DEFAULT_LANDER.heaterW,
    arrayM2: INITIAL.array ?? DEFAULT_LANDER.arrayM2,
    batteryWh: INITIAL.battery !== undefined ? INITIAL.battery * 1000 : DEFAULT_LANDER.batteryWh,
  });
  const [validation, setValidation] = useState<Validation | null>(null);
  const [playing, setPlaying] = useState(false);
  const [panelHeight, setPanelHeight] = useState(INITIAL.height ?? 0);
  const [rightTab, setRightTab] = useState<"evidence" | "sky" | "power" | "comms">("sky");
  const [dockTab, setDockTab] = useState<"timeline" | "compare" | "porkchop">("timeline");
  const [methodOpen, setMethodOpen] = useState(false);
  const [layers, setLayers] = useState<MapLayers>({ shadow: true, labels: true, refs: true, grid: true });
  const [copied, setCopied] = useState(false);
  const shareHashRef = useRef("");
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}#${shareHashRef.current}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable: the address bar still holds the link */ }
  };
  const [speedH, setSpeedH] = useState(24); // simulated hours per real second
  const [tourStep, setTourStep] = useState<number | null>(() => {
    try { return window.localStorage.getItem("sunlock-tour-seen") ? null : 0; } catch { return null; }
  });
  const closeTour = () => {
    setTourStep(null);
    try { window.localStorage.setItem("sunlock-tour-seen", "1"); } catch { /* storage unavailable */ }
  };
  const [year, setYear] = useState(INITIAL.landMs !== undefined ? new Date(INITIAL.landMs).getUTCFullYear() : DEFAULT_YEAR);
  const win = useMemo(() => yearWindow(year), [year]);
  // the last selectable moment is 23:30 on 31 December, so time never spills into the next year
  const START_MS = win.startMs, DAYS = win.days, END_MS = win.endMs - STEP_MS;
  const [currentMs, setCurrentMs] = useState(INITIAL.landMs ?? Date.UTC(DEFAULT_YEAR, 0, 15));
  /** Move to another year, keeping the same day and time. */
  const changeYear = (y: number) => {
    const d = new Date(currentMs);
    const day = Math.min(d.getUTCDate(), new Date(Date.UTC(y, d.getUTCMonth() + 1, 0)).getUTCDate());
    setYear(y);
    setCurrentMs(Date.UTC(y, d.getUTCMonth(), day, d.getUTCHours(), d.getUTCMinutes()));
  };
  // keep the year in step when the time is set from outside (links, tour, clicks)
  useEffect(() => {
    const y = new Date(currentMs).getUTCFullYear();
    if (y !== year && YEARS.includes(y)) setYear(y);
  }, [currentMs, year]);
  const [missionDays, setMissionDays] = useState(INITIAL.days ?? 14);
  /** longest time Earth may be out of view; null = no requirement (relay or autonomous lander) */
  const [maxOutageH, setMaxOutageH] = useState<number | null>(INITIAL.outage ?? null);
  const [reservePct, setReservePct] = useState<number>(INITIAL.reserve ?? 0);
  const req = useMemo(() => ({ maxEarthOutageH: maxOutageH, reservePct }), [maxOutageH, reservePct]);
  const [arrayMode, setArrayMode] = useState<ArrayMode>(INITIAL.panels ?? "tracking");
  const [error, setError] = useState<string | null>(null);
  const [verify, setVerify] = useState<{
    epochs: number;
    geometry: { maxSunArcsec: number; maxEarthArcsec: number };
    frame: { maxSunLonDeg: number; maxSunLatDeg: number };
  } | null>(null);
  const [elevation, setElevation] = useState<ElevationGrid | null>(null);
  /** full 80 m skylines at 1 and 2 km from each current site (web/scripts/build-nearby.mjs) */
  const [nearbyData, setNearbyData] = useState<Record<string, NearbySpot[]> | null>(null);
  const [customSite, setCustomSite] = useState<Site | null>(null);
  const [missionSites, setMissionSites] = useState<Site[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [sameSpotNote, setSameSpotNote] = useState<string | null>(null);
  /** choosing a site any other way clears the "same spot as" note */
  const setSelectedId = (id: string) => { setSameSpotNote(null); setSelectedIdRaw(id); };
  const [stageView, setStageView] = useState<"map" | "finder" | "3d">("map");
  const [finderData, setFinderData] = useState<Finder | null>(null);
  const [finderErr, setFinderErr] = useState<string | null>(null);
  const [limits, setLimits] = useState<FinderLimits>({ sunPct: 50, earthPct: 50, slopeDeg: 8, shadowKm: 5 });
  // the finder grid (6 MB) is only downloaded the first time someone opens it
  useEffect(() => {
    if (stageView !== "finder" || finderData) return;
    let alive = true;
    loadFinder().then((f) => alive && setFinderData(f)).catch((e) => alive && setFinderErr(String(e)));
    return () => { alive = false; };
  }, [stageView, finderData]);
  const finderResult = useMemo(() => (finderData ? classify(finderData, limits) : null), [finderData, limits]);

  useEffect(() => {
    let alive = true;
    // the hillshade is independent of the data files, so it downloads alongside them
    const img = new Image();
    img.onload = () => alive && setHillshade(img);
    img.src = `${import.meta.env.BASE_URL}terrain/hillshade.jpg`;

    loadTerrain()
      .then(({ meta, shadows, elevation }) => {
        if (!alive) return;
        setMeta(meta);
        setField(buildShadowField(meta, shadows));
        elevation
          .then((e) => { if (alive) setElevation(e); })
          .catch((e) => alive && setError(`Terrain heights for clicked points did not load: ${String(e)}`));
      })
      .catch((e) => setError(String(e)));

    fetch(`${import.meta.env.BASE_URL}terrain/nearby.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => { if (alive && v?.sites) setNearbyData(v.sites); })
      .catch(() => {});

    fetch(`${import.meta.env.BASE_URL}terrain/verification.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => { if (alive && v) setVerify(v); })
      .catch(() => {});

    fetch(`${import.meta.env.BASE_URL}terrain/missions.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => { if (alive && v?.missions) setMissionSites(v.missions); })
      .catch(() => {});

    fetch(`${import.meta.env.BASE_URL}terrain/validation.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => { if (alive && v) setValidation(v); })
      .catch(() => {});

    return () => { alive = false; };
  }, []);

  // the data runs PAD_DAYS past the year so a landing on 31 December can still be evaluated;
  // charts, statistics and the date grid stay on the chosen year (YEAR_N samples)
  const skies = useMemo(() => buildSkies(new Date(win.startMs), win.days + PAD_DAYS, STEP_MIN), [win]);
  const YEAR_N = win.days * (1440 / STEP_MIN) + 1;
  // Sites seen from the chosen panel height: swap in the horizon re-marched from that height.
  const officialSites = useMemo(
    () =>
      (meta?.sites ?? []).map((s) => {
        const h = s.heights?.find((x) => x.heightM === panelHeight);
        return h && panelHeight !== 0 ? { ...s, horizonDeg: h.horizonDeg } : s;
      }),
    [meta, panelHeight]
  );
  /** Artemis regions plus past and planned landings: everything with a precomputed horizon. */
  const namedSites = useMemo(() => [...officialSites, ...missionSites], [officialSites, missionSites]);
  const series = useMemo(
    () => new Map(namedSites.map((s) => [s.id, siteSeries(s, skies)])),
    [namedSites, skies]
  );
  const stats = useMemo(
    () => new Map(namedSites.map((s) => [s.id, statsFor(series.get(s.id)!.slice(0, YEAR_N), STEP_MIN)])),
    [namedSites, series, YEAR_N]
  );
  const sites = useMemo(
    () => (customSite ? [...namedSites, customSite] : namedSites),
    [namedSites, customSite]
  );
  // Default to the sunniest current NASA region (long-run, validated).
  const defaultSite = useMemo(
    () =>
      [...officialSites]
        .filter((s) => s.current !== false)
        .sort((a, b) => (b.longRun?.sunPct ?? 0) - (a.longRun?.sunPct ?? 0))[0] ?? officialSites[0],
    [officialSites]
  );
  const selected = sites.find((s) => s.id === selectedId) ?? defaultSite;

  const customSeries = useMemo(
    () => (customSite ? siteSeries(customSite, skies) : []),
    [customSite, skies]
  );
  const customStats = useMemo(
    () => (customSite && customSeries.length ? statsFor(customSeries.slice(0, YEAR_N), STEP_MIN) : undefined),
    [customSite, customSeries, YEAR_N]
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
  const yearSeries = useMemo(() => selSeries.slice(0, YEAR_N), [selSeries, YEAR_N]);
  const selStats = useMemo(
    () =>
      selected
        ? selected.id === "custom"
          ? customStats
          : stats.get(selected.id)
        : undefined,
    [selected, customStats, stats]
  );

  /**
   * Check any point on the Moon. Inside our south-pole terrain (80-90 deg S) the horizon comes
   * from the terrain grid; elsewhere it is the edge of the lunar sphere, and we say so.
   */
  const checkCoords = (latIn: number, lonIn: number, how: "map" | "typed") => {
    // keep the precision the user gave (5 decimals is ~0.3 m)
    const lat = Number(latIn.toFixed(5));
    const lon = Number((((lonIn % 360) + 360) % 360).toFixed(5));
    // the same spot as a named site gets that site's detailed result, not a second, coarser one
    const D = Math.PI / 180;
    const metres = (s: Site) => {
      const c = Math.sin(lat * D) * Math.sin(s.lat * D) + Math.cos(lat * D) * Math.cos(s.lat * D) * Math.cos((lon - s.lon) * D);
      return Math.acos(Math.min(1, Math.max(-1, c))) * 1737400;
    };
    const same = namedSites.find((s) => s.terrain !== false && metres(s) <= 5);
    if (same) {
      setSameSpotNote(`${lat.toFixed(4)}, ${lon.toFixed(4)} is the same spot as ${same.name} (within 5 m), so its detailed result is shown.`);
      setSelectedIdRaw(same.id);
      return true;
    }
    setSameSpotNote(null);
    const polar = lat <= -80;
    if (polar && !elevation) return false;
    const { horizon, elevationM } = polar ? customHorizon(elevation!, lat, lon) : { horizon: new Array(360).fill(0), elevationM: 0 };
    setCustomSite({
      id: "custom",
      name: how === "map" ? "Point you clicked" : `${Math.abs(lat).toFixed(2)}°${lat < 0 ? "S" : "N"} ${lon.toFixed(2)}°E`,
      lat,
      lon,
      elevationM,
      terrain: polar,
      blurb: polar
        ? "Preliminary: a spot you chose inside our south-pole terrain map, checked on a coarser terrain grid (about 600 m detail, 150 km reach) than the named sites (80 m). Hills smaller than about a kilometre are missed, so treat the verdict as an early estimate."
        : "A spot you chose outside our south-pole terrain map, so the horizon here is the edge of the lunar sphere (no hills). Sun and Earth positions are exact; hills nearby could shift sunrise and sunset.",
      horizonDeg: horizon,
    });
    setSelectedId("custom");
    return true;
  };
  const checkCoordsRef = useRef(checkCoords);
  checkCoordsRef.current = checkCoords;
  const pickPoint = (u: { x: number; y: number }) => {
    const { lat, lon, inside } = unprojectFromUnit(u);
    if (inside) checkCoords(lat, lon, "map");
  };
  // a shared link to a typed point: apply it once the terrain needed for it has arrived
  const [hashPointDone, setHashPointDone] = useState(false);
  useEffect(() => {
    if (hashPointDone || INITIAL.lat === undefined || INITIAL.lon === undefined) return;
    // a shared nearby position opens with the same precomputed 80 m skyline it was offered with
    if (INITIAL.near) {
      if (!nearbyData || !officialSites.length) return;
      const parent = officialSites.find((s) => s.id === INITIAL.near);
      const spot = nearbyData[INITIAL.near]?.find((n) => dist(n.lat, n.lon, INITIAL.lat!, INITIAL.lon!) < 1);
      if (parent && spot) {
        setCustomSite(nearbySite(parent, spot));
        setSelectedId("custom");
        setHashPointDone(true);
        return;
      }
    }
    if (checkCoords(INITIAL.lat, INITIAL.lon, "typed")) setHashPointDone(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elevation, hashPointDone, officialSites, nearbyData]);

  const currentSky = useMemo(() => skyAt(new Date(currentMs)), [currentMs]);
  const shadow = useMemo(() => (field ? computeShadow(field, currentSky) : null), [field, currentSky]);

  const reading = useMemo(
    () => (selected ? readSite(selected, currentSky) : null),
    [selected, currentSky]
  );

  /**
   * When the current state flips next at the selected site: sunset or sunrise, Earthset or
   * Earthrise. null when it does not flip before the end of the modelled window.
   */
  const nowIdx = Math.min(Math.max(0, Math.round((currentMs - START_MS) / STEP_MS)), Math.max(0, selSeries.length - 1));
  const nextFlip = (key: "lit" | "comm") => {
    if (!selSeries.length) return null;
    const cur = selSeries[nowIdx][key];
    for (let i = nowIdx + 1; i < selSeries.length; i++) if (selSeries[i][key] !== cur) return selSeries[i].t - currentMs;
    return null;
  };
  const sunFlipMs = nextFlip("lit");
  const earthFlipMs = nextFlip("comm");

  // Sun track around the selected moment, for the sky panorama.
  const track = useMemo(() => {
    if (!selected) return [];
    const basis = siteBasis(selected.lat, selected.lon);
    const pts: { az: number; elev: number }[] = [];
    const dayMs = 86400000;
    for (let t = currentMs - 20 * dayMs; t <= currentMs + 20 * dayMs; t += 6 * 3600000) {
      const l = lookAngles(skyAt(new Date(t)).sun, basis);
      pts.push({ az: l.az, elev: Math.max(-6, l.elev) });
    }
    return pts;
  }, [selected, currentMs]);

  /**
   * Best landing dates for THIS lander and requirements: every 6-hour landing time is run
   * through the mission evaluator; the ones that succeed are ranked by battery left at the
   * worst moment, at least 3 days apart.
   */
  const windows = useMemo(() => {
    if (!selSeries.length) return [];
    const steps = Math.round((missionDays * 1440) / STEP_MIN), stride = Math.round(360 / STEP_MIN);
    const row = porkchopRow(selSeries, steps, stride, STEP_MIN, arrayMode, lander, req);
    // running totals so every candidate's Earth and Sun share is cheap
    const sunCum = new Float64Array(selSeries.length + 1), commCum = new Float64Array(selSeries.length + 1);
    selSeries.forEach((x, i) => { sunCum[i + 1] = sunCum[i] + x.sunFrac; commCum[i + 1] = commCum[i] + (x.comm ? 1 : 0); });
    const share = (cum: Float64Array, c: number) => (cum[c * stride + steps] - cum[c * stride]) / steps;
    const cand: number[] = [];
    for (let c = 0; c < row.length; c++) if (row[c] >= 0 && selSeries[c * stride].t <= END_MS) cand.push(c);
    // most battery to spare first; among equals, more time with Earth in view, then more Sun
    cand.sort((a, b) => Math.round(row[b]) - Math.round(row[a]) || share(commCum, b) - share(commCum, a) || share(sunCum, b) - share(sunCum, a) || a - b);
    const picked: number[] = [];
    for (const c of cand) {
      if (picked.every((q) => Math.abs(q - c) * stride >= 3 * 48)) picked.push(c);
      if (picked.length >= 4) break;
    }
    return picked.sort((a, b) => a - b).map((c) => {
      const i0 = c * stride, slice = selSeries.slice(i0, i0 + steps);
      const sun = slice.reduce((n, x) => n + x.sunFrac, 0), comm = slice.reduce((n, x) => n + (x.comm ? 1 : 0), 0);
      return { start: selSeries[i0].t, minSocPct: row[c], illumPct: (100 * sun) / slice.length, commPct: (100 * comm) / slice.length };
    });
  }, [selSeries, missionDays, arrayMode, lander, req, END_MS]);

  const comms = useMemo(() => (selSeries.length ? commWindows(selSeries.slice(0, YEAR_N), STEP_MIN) : []), [selSeries, YEAR_N]);
  const nextComms = useMemo(() => (comms.length ? upcomingWindows(comms, currentMs, 4) : []), [comms, currentMs]);

  const powerNow = reading ? arrayPowerPerM2(reading.sunElev, reading.lit, arrayMode, reading.sunAz) : 0;
  /** average kWh per m^2 per day for each way of mounting the panels, at this site this year */
  const perDayByMode = useMemo(
    () => Object.fromEntries(PANEL_MODES.map((m) => [m, selSeries.length ? energyWh(selSeries.slice(0, YEAR_N), STEP_MIN, m, 1) / DAYS / 1000 : 0])) as Record<ArrayMode, number>,
    [selSeries, DAYS, YEAR_N]
  );
  const energyTotal = selSeries.length ? energyWh(selSeries.slice(0, YEAR_N), STEP_MIN, arrayMode, 1) : 0;
  const energyPerDay = energyTotal / DAYS;
  const battery = selStats ? batteryWh(selStats.longestDarkH, lander.loadW + (lander.heaterW ?? 0), lander.dod) : 0;

  // ---- Timeline playback (Worldview/Eyes-style): advance simulated time in real time
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now(), acc = 0;
    const tick = (now: number) => {
      acc += ((now - last) / 1000) * speedH * 3600000;
      last = now;
      const steps = Math.floor(acc / STEP_MS);
      if (steps > 0) {
        acc -= steps * STEP_MS;
        setCurrentMs((t) => {
          const next = t + steps * STEP_MS;
          if (next >= END_MS) { setPlaying(false); return END_MS; }
          return next;
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speedH, END_MS]);

  const stepBy = (ms: number) =>
    setCurrentMs((t) => Math.min(END_MS, Math.max(START_MS, Math.round((t + ms - START_MS) / STEP_MS) * STEP_MS + START_MS)));

  // Keyboard: space plays/pauses, arrow keys step 6 h (shift: 1 day). Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "Escape") {
        if (methodOpen) setMethodOpen(false);
        else if (tourStep !== null) closeTour();
        return;
      }
      if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === "ArrowRight") { e.preventDefault(); stepBy((e.shiftKey ? 24 : 6) * 3600000); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); stepBy(-(e.shiftKey ? 24 : 6) * 3600000); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Apply a pasted or clicked link while the page is already open
  // (replaceState below does not fire hashchange, so this cannot loop).
  useEffect(() => {
    const onHash = () => {
      const h = readHash();
      if (h.site) setSelectedId(h.site);
      else if (h.lat !== undefined && h.lon !== undefined) checkCoordsRef.current(h.lat, h.lon, "typed");
      if (h.landMs !== undefined) setCurrentMs(h.landMs);
      if (h.days !== undefined) setMissionDays(h.days);
      setPanelHeight(h.height ?? 0);
      if (h.panels) setArrayMode(h.panels);
      setMaxOutageH(h.outage ?? null);
      setReservePct(h.reserve ?? 0);
      setLander((l) => ({
        ...l,
        loadW: h.load ?? l.loadW,
        heaterW: h.heater ?? l.heaterW,
        arrayM2: h.array ?? l.arrayM2,
        batteryWh: h.battery !== undefined ? h.battery * 1000 : l.batteryWh,
      }));
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  /** Everything needed to reopen exactly this view, as a URL hash. */
  const shareHash = useMemo(() => {
    if (!selected) return "";
    const iso = new Date(currentMs).toISOString().slice(0, 16) + "Z";
    const where = selected.id === "custom" ? `${selected.nearOf ? `near=${selected.nearOf}&` : ""}lat=${selected.lat}&lon=${selected.lon}` : `site=${selected.id}`;
    return `${where}&land=${iso}&days=${missionDays}&load=${lander.loadW}&array=${lander.arrayM2}&battery=${lander.batteryWh / 1000}${lander.heaterW ? `&heater=${lander.heaterW}` : ""}${arrayMode !== "tracking" ? `&panels=${arrayMode}` : ""}${panelHeight ? `&height=${panelHeight}` : ""}${maxOutageH !== null ? `&outage=${maxOutageH}` : ""}${reservePct ? `&reserve=${reservePct}` : ""}`;
  }, [selected, currentMs, missionDays, lander, panelHeight, arrayMode, maxOutageH, reservePct]);
  // Keep the URL hash in sync so any view can be shared as a link.
  useEffect(() => {
    shareHashRef.current = shareHash;
    if (!shareHash) return;
    const id = window.setTimeout(() => {
      try { window.history.replaceState(null, "", `#${shareHash}`); } catch { /* sandboxed iframes may refuse */ }
    }, 250);
    return () => window.clearTimeout(id);
  }, [shareHash]);

  // ---- Lander Check: land at the scrubber time, run the battery through the mission
  const missionSteps = Math.round((missionDays * 1440) / STEP_MIN);
  const landIdx = Math.max(0, Math.round((currentMs - START_MS) / STEP_MS));
  const missionFits = landIdx + missionSteps <= selSeries.length;
  const selLander = useMemo(
    () => (selSeries.length ? simulateMission(selSeries, landIdx, missionSteps, STEP_MIN, arrayMode, lander, req) : null),
    [selSeries, landIdx, missionSteps, arrayMode, lander, req]
  );
  const landerBySite = useMemo(
    () =>
      new Map(
        namedSites.map((s) => {
          const ser = series.get(s.id) ?? [];
          return [s.id, ser.length ? simulateMission(ser, landIdx, missionSteps, STEP_MIN, arrayMode, lander, req) : null];
        })
      ),
    [namedSites, series, landIdx, missionSteps, arrayMode, lander, req]
  );

  /** The design answer: the smallest battery and the smallest panel area that survive this landing. */
  const sizing = useMemo(
    () => (selSeries.length && landIdx + missionSteps <= selSeries.length ? sizeToSurvive(selSeries, landIdx, missionSteps, STEP_MIN, arrayMode, lander, req) : null),
    [selSeries, landIdx, missionSteps, arrayMode, lander, req]
  );

  /**
   * Terrain sensitivity for the selected site: skylines raised until this year's sunlight falls
   * by our RMS disagreement with NASA's map at published landing sites (6.8 points).
   */
  const terrainDropPp = validation?.landingSites.rmsePp ?? 6.8;
  /**
   * Each site's terrain case is calibrated on that site, so it is the same wherever it is used
   * (selected site, other sites, nearby positions). Cached because each costs ~11 series runs.
   */
  // the deps are what invalidates the cache
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const terrainCache = useMemo(() => new Map<string, TerrainCase>(), [skies, YEAR_N, terrainDropPp]);
  const terrainFor = (s: Site): TerrainCase => {
    const key = `${s.lat}:${s.lon}:${s.horizonDeg.reduce((a, b) => a + b, 0).toFixed(4)}`;
    let c = terrainCache.get(key);
    if (!c) {
      const t = raisedTerrain(s, skies, YEAR_N, terrainDropPp);
      c = { samples: t.samples, label: `Hills ${t.raiseDeg.toFixed(2)}° higher (sunlight −${terrainDropPp} pts, our typical error)` };
      terrainCache.set(key, c);
    }
    return c;
  };
  const terrainCase = useMemo(
    () => (selected ? terrainFor(selected) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, terrainCache]
  );

  /**
   * Nearby alternative positions: 1 and 2 km from a current NASA site in 8 directions, each with
   * its own full 80 m skyline computed exactly like the named sites' (ground level).
   */
  const nearbyCandidates = useMemo(() => {
    const spots = selected && nearbyData ? nearbyData[selected.id] : undefined;
    if (!selected || !spots) return [];
    return spots.map((n) => {
      const site = nearbySite(selected, n);
      return { site, km: n.km, samples: siteSeries(site, skies) };
    });
  }, [selected, nearbyData, skies]);

  /** The same landing under adverse assumptions: which one breaks the plan. */
  const stress = useMemo(
    () => (selSeries.length && landIdx + missionSteps <= selSeries.length ? stressTest(selSeries, landIdx, missionSteps, STEP_MIN, arrayMode, lander, req, terrainCase) : []),
    [selSeries, landIdx, missionSteps, arrayMode, lander, req, terrainCase]
  );
  const limiting = useMemo(() => limitingCase(stress), [stress]);
  /** Changes that make the plan pass every tested case. */
  const robust = useMemo(() => {
    if (!selSeries.length || landIdx + missionSteps > selSeries.length) return null;
    const lastIdx = Math.min(YEAR_N - 1, selSeries.length - missionSteps);
    const o = robustOptions(selSeries, landIdx, missionSteps, STEP_MIN, arrayMode, lander, req, terrainCase, lastIdx);
    // Every alternative must pass all cases, including its own terrain case. The cheap cases
    // run first; the terrain case (calibrated on that spot) only for those that survive them.
    const passesAll = (ser: ReturnType<typeof siteSeries>, s: Site) => {
      const all = (t: TerrainCase | null) => allCasesPass(stressTest(ser, landIdx, missionSteps, STEP_MIN, arrayMode, lander, req, t));
      return ser.length > 0 && all(null) && all(terrainFor(s));
    };
    // other current NASA sites on this exact date with this exact lander
    const sitesOk = officialSites
      .filter((s) => s.current !== false && s.id !== selected?.id)
      .filter((s) => passesAll(series.get(s.id) ?? [], s));
    // nearby positions, closest first
    const nearOk = nearbyCandidates.filter((c) => passesAll(c.samples, c.site)).map((c) => c.site).slice(0, 3);
    return { ...o, landMs: o.landIdx !== null ? selSeries[o.landIdx].t : null, sitesOk, nearOk, nearTested: nearbyCandidates.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selSeries, landIdx, missionSteps, arrayMode, lander, req, terrainCase, YEAR_N, officialSites, series, selected, nearbyCandidates, terrainCache]);

  /** First landing time, from now on, at which this lander survives the mission at the selected site. */
  const nextSurvivable = useMemo(() => {
    if (!selSeries.length) return null;
    // every half-hour landing is checked, so short viable windows are not skipped
    const lastIdx = Math.min(YEAR_N - 1, selSeries.length - missionSteps);
    const i = earliestSurvivable(selSeries, landIdx, lastIdx, missionSteps, STEP_MIN, arrayMode, lander, req);
    return i === null ? null : selSeries[i].t;
  }, [selSeries, landIdx, missionSteps, arrayMode, lander, req, YEAR_N]);
  /** Last landing time the searches can test (the mission must finish inside the modelled data). */
  const lastLandingMs = selSeries.length > missionSteps ? selSeries[Math.min(YEAR_N - 1, selSeries.length - missionSteps)].t : START_MS;

  /** Long-run sunlight at the chosen panel height (18.6-year average). */
  const sunAtHeight = (s: Site) =>
    panelHeight === 0 ? s.longRun?.sunPct : s.heights?.find((h) => h.heightM === panelHeight)?.sunPct ?? s.longRun?.sunPct;
  const rankKey = (s: Site) => {
    const r = landerBySite.get(s.id);
    return [r?.survives ? 1 : 0, r ? r.minSocPct : 0, sunAtHeight(s) ?? 0];
  };
  const byRank = (a: Site, b: Site) => {
    const ka = rankKey(a), kb = rankKey(b);
    for (let i = 0; i < ka.length; i++) if (kb[i] !== ka[i]) return kb[i] - ka[i];
    return 0;
  };
  // ---- Landing porkchop: every region x every landing time (6-hour steps)
  const [showRefs, setShowRefs] = useState(false);
  const PC_STRIDE = Math.round(360 / STEP_MIN);
  const porkchop = useMemo(() => {
    const list = officialSites
      .filter((s) => showRefs || s.current !== false)
      .sort((a, b) => (Number(a.current === false) - Number(b.current === false)) || (b.longRun?.sunPct ?? 0) - (a.longRun?.sunPct ?? 0));
    return list.map((s) => ({
      id: s.id,
      name: s.name,
      // one column per 6 hours of the chosen year; missions may run into the padding
      values: porkchopRow(series.get(s.id) ?? [], missionSteps, PC_STRIDE, STEP_MIN, arrayMode, lander, req).slice(0, Math.floor((YEAR_N - 1) / PC_STRIDE) + 1),
    }));
  }, [officialSites, series, missionSteps, PC_STRIDE, arrayMode, lander, showRefs, req, YEAR_N]);
  /** The current NASA site whose landing dates this lander survives most often. */
  const forgiving = useMemo(() => {
    let best: { site: Site; pct: number } | null = null;
    for (const s of officialSites) {
      if (s.current === false) continue;
      const row = porkchop.find((r) => r.id === s.id)?.values;
      if (!row) continue;
      let ok = 0, n = 0;
      for (const v of row) if (!Number.isNaN(v)) { n++; if (v >= 0) ok++; }
      const pct = n ? (100 * ok) / n : 0;
      if (!best || pct > best.pct) best = { site: s, pct };
    }
    return best;
  }, [officialSites, porkchop]);
  // ---- Side-by-side comparison: up to three sites on one time axis
  const compareRows = useMemo(() => {
    const ids = compareIds.length ? compareIds : [selected?.id, forgiving?.site.id, "apollo-11", "de-gerlache-rim-2", "malapert-massif"].filter((x): x is string => !!x);
    const uniq = [...new Set(ids)].filter((id) => sites.some((s) => s.id === id)).slice(0, 3);
    return uniq.map((id) => {
      const site = sites.find((s) => s.id === id)!;
      const ser = id === "custom" ? customSeries : series.get(id) ?? [];
      const st = id === "custom" ? customStats : stats.get(id);
      const run = ser.length ? simulateMission(ser, landIdx, missionSteps, STEP_MIN, arrayMode, lander, req) : null;
      return { site, ser, st, run, sunFlip: flipAfter(ser, landIdx, "lit"), earthFlip: flipAfter(ser, landIdx, "comm") };
    });
  }, [compareIds, selected, forgiving, sites, customSeries, customStats, series, stats, landIdx, missionSteps, arrayMode, lander, req]);
  const setCompareAt = (i: number, id: string) =>
    setCompareIds(() => {
      const next = compareRows.map((r) => r.site.id);
      next[i] = id;
      return next;
    });

  const pcSummary = useMemo(() => {
    let ok = 0, total = 0;
    for (const r of porkchop) for (const v of r.values) if (!Number.isNaN(v)) { total++; if (v >= 0) ok++; }
    return { ok, total };
  }, [porkchop]);

  const rankedCurrent = officialSites.filter((s) => s.current !== false).sort(byRank);
  const rankedReference = officialSites.filter((s) => s.current === false).sort(byRank);
  const rankedMissions = missionSites.filter((s) => !s.approx).sort(byRank);
  const rankedPlanned = missionSites.filter((s) => s.approx).sort(byRank);

  const verdictClass = !selLander || !missionFits ? "verdict-hero" : selLander.survives ? "verdict-hero is-ok" : "verdict-hero is-bad";

  return (
    <div className="console">
      {/* ================= TOP BAR: identity + live telemetry ================= */}
      <header className="cx-top">
        <div className="cx-brand">
          <span className="brand-mark" aria-hidden />
          <div>
            <h1>SUNLOCK</h1>
            <p>Will your Moon lander survive at the south pole?</p>
          </div>
        </div>

        {selected && reading && (
          <div className="cx-telemetry" role="status" aria-live="polite">
            <div className="tm-cell">
              <span className="tm-k">Date (UTC)</span>
              <span className="tm-v">{fmtDay(currentMs)} · {new Date(currentMs).toISOString().slice(11, 16)}</span>
            </div>
            <div className="tm-cell">
              <span className="tm-k">Sunlight</span>
              <span className={reading.lit ? "tm-v" : "tm-v tm-off"}>
                <i className={reading.lit ? "dot dot-sun" : "dot dot-off"} />
                {reading.lit ? "IN SUN" : "IN SHADOW"}
                <small title="Time until the Sun next sets or rises over the terrain here">
                  {sunFlipMs !== null ? `${reading.lit ? "sets" : "rises"} in ${fmtIn(sunFlipMs)}` : `${reading.sunElev >= 0 ? "+" : ""}${reading.sunElev.toFixed(1)}°`}
                </small>
              </span>
            </div>
            <div className="tm-cell">
              <span className="tm-k" title="Geometric: some of Earth's disc is above the skyline. Ground stations and link budget are not modelled.">Earth in view</span>
              <span className={reading.comm ? "tm-v" : "tm-v tm-off"}>
                <span className={reading.comm ? "sigbars" : "sigbars off"} aria-hidden><i /><i /><i /><i /></span>
                {reading.comm ? "IN VIEW" : "HIDDEN"}
                <small title="Time until Earth next sets or rises over the terrain here">
                  {earthFlipMs !== null ? `${reading.comm ? "Earthset" : "Earthrise"} in ${fmtIn(earthFlipMs)}` : `${reading.earthElev >= 0 ? "+" : ""}${reading.earthElev.toFixed(1)}°`}
                </small>
              </span>
            </div>
            <div className="tm-cell">
              <span className="tm-k">Your lander · {missionDays} days</span>
              {selLander && missionFits ? (
                <span className={selLander.survives ? "tm-v" : "tm-v tm-bad"}>
                  <i className={selLander.survives ? "dot dot-ok" : "dot dot-bad"} />
                  {selLander.survives ? "SURVIVES" : selLander.failure === "earth" ? "NO EARTH" : reservePct ? "RESERVE BREACHED" : "BATTERY DIES"}
                  <small>{selLander.survives ? `battery ≥ ${selLander.minSocPct.toFixed(0)}%` : fmtDay((selLander.failure === "earth" ? selLander.earthFailAt : selLander.lostAt)!)}</small>
                </span>
              ) : (
                <span className="tm-v tm-off"><i className="dot dot-off" />—</span>
              )}
            </div>
          </div>
        )}

        <div className="cx-actions">
          {validation && (
            <button className="chip-valid" onClick={() => setMethodOpen(true)} title={validation.reference}>
              <i className="dot dot-ok" /> Checked against NASA's sunlight map
            </button>
          )}
          <button className="cx-btn" onClick={copyLink} title="Copy a link to exactly this view: site, date and lander">
            {copied ? "Link copied" : "Copy link"}
          </button>
          <button className="cx-btn" onClick={() => setMethodOpen(true)}>How it works</button>
          <button className="cx-btn" onClick={() => setTourStep(0)}>Take the tour</button>
        </div>
      </header>

      {error && <div className="error">Failed to load terrain: {error}</div>}

      <div className="cx-body">
        {/* ================= LEFT RAIL: mission set-up + regions ================= */}
        <aside className="cx-rail cx-left" aria-label="Mission and regions">
          <section className="pane pane-lander">
            <h2 className="pane-title">Your lander</h2>
            <div className="lander-form">
            <div className="field-row">
              <label className="field">
                <span className="field-k">Days on the Moon</span>
                <select value={missionDays} onChange={(e) => setMissionDays(Number(e.target.value))}>
                  {MISSION_CHOICES.map((d) => (
                    <option key={d} value={d}>{d} day{d > 1 ? "s" : ""}</option>
                  ))}
                </select>
              </label>
              <NumIn label="Heaters in the dark" unit="W" value={lander.heaterW ?? 0} min={0} max={2000} step={10}
                onChange={(v) => setLander({ ...lander, heaterW: v })} />
            </div>
            <label className="field field-req">
              <span className="field-k" title="Direct radio needs Earth above the skyline. Choose how long the mission can go without it.">Longest time without Earth in view</span>
              <select value={maxOutageH ?? ""} onChange={(e) => setMaxOutageH(e.target.value === "" ? null : Number(e.target.value))}>
                <option value="">No limit (relay or autonomous)</option>
                {[12, 24, 48, 72, 120, 168].map((h) => (
                  <option key={h} value={h}>{h < 48 ? `${h} hours` : `${h / 24} days`}</option>
                ))}
              </select>
            </label>
            <label className="field field-req">
              <span className="field-k" title="Charge the battery must never fall below, as a share of its usable capacity">Battery reserve to keep</span>
              <select value={reservePct} onChange={(e) => setReservePct(Number(e.target.value))}>
                {[0, 10, 20, 30].map((r) => <option key={r} value={r}>{r === 0 ? "None (may run it flat)" : `${r}% of usable charge`}</option>)}
              </select>
            </label>
            <div className="field-row field-row-1">
              <div className="field">
                <span className="field-k">Solar panels</span>
                <div className="segmented" role="group" aria-label="Array orientation">
                  <button className={arrayMode === "tracking" ? "seg seg-on" : "seg"} onClick={() => setArrayMode("tracking")} title="Panels turn to face the Sun">Face Sun</button>
                  <button className={arrayMode === "vertical" ? "seg seg-on" : "seg"} onClick={() => setArrayMode("vertical")} title="Fixed upright panels on four sides, as most polar landers have">Upright</button>
                  <button className={arrayMode === "horizontal" ? "seg seg-on" : "seg"} onClick={() => setArrayMode("horizontal")} title="Fixed panels lying flat on the deck">Flat</button>
                </div>
              </div>
            </div>
            <div className="field">
              <span className="field-k">Panel height above the ground</span>
              <div className="segmented" role="group" aria-label="Panel height">
                {HEIGHT_CHOICES.map((h) => (
                  <button key={h} className={panelHeight === h ? "seg seg-on" : "seg"} onClick={() => setPanelHeight(h)}>
                    {h === 0 ? "On the ground" : h === 2 ? "2 m (deck)" : "10 m (mast)"}
                  </button>
                ))}
              </div>
              {panelHeight > 0 && selected && !selected.heights && (
                <span className="field-note">Raised panels are modelled at the Artemis sites only; this spot is shown at ground level.</span>
              )}
            </div>
            <div className="lander-inputs">
              <NumIn label="Power use" unit="W" value={lander.loadW} min={10} max={2000} step={10}
                onChange={(v) => setLander({ ...lander, loadW: v })} />
              <NumIn label="Panel size" unit="m²" value={lander.arrayM2} min={0.1} max={500} step={0.1}
                onChange={(v) => setLander({ ...lander, arrayM2: v })} />
              <NumIn label="Battery" unit="kWh" value={+(lander.batteryWh / 1000).toFixed(1)} min={0.1} max={1000} step={0.1}
                onChange={(v) => setLander({ ...lander, batteryWh: v * 1000 })} />
            </div>
            </div>
          </section>

          <section className="pane pane-grow pane-sites">
            <h2 className="pane-title">
              Landing sites <span className="pane-sub">if you land {fmtDay(currentMs)}</span>
            </h2>
            <CoordForm onCheck={(lat, lon) => checkCoords(lat, lon, "typed")} terrainReady={!!elevation} />
            {forgiving && (
              <div className={forgiving.pct > 0 ? "advice" : "advice advice-bad"}>
                {forgiving.pct > 0 ? (
                  <>
                    <span className="advice-k">Most forgiving site for this lander</span>
                    <span className="advice-v">
                      <b>{forgiving.site.name}</b> · survives {Math.round(forgiving.pct)}% of {missionDays}-day landing dates in {year}
                    </span>
                    {forgiving.site.id !== selected?.id && (
                      <button className="advice-go" onClick={() => setSelectedId(forgiving.site.id)}>Show it</button>
                    )}
                  </>
                ) : (
                  <span className="advice-v">
                    This lander does not survive {missionDays} days at any NASA site on any landing date we model.
                    Add battery or panel area, or raise the panels.
                  </span>
                )}
              </div>
            )}
            <div className="rank-groups">
            {([
              ["NASA's current Artemis III sites", rankedCurrent],
              ["Older sites (dropped by NASA in 2024)", rankedReference],
              ["Past landings: Apollo, CLPS and other countries", rankedMissions],
              ["Planned missions: target areas (approximate)", rankedPlanned],
            ] as const).map(([title, list]) =>
              list.length > 0 && (
                <div key={title} className="rank-block">
                  <div className="rank-group">{title}</div>
                  <div className="rank-head" aria-hidden>
                    <span>#</span>
                    <span>Site</span>
                    {list === rankedMissions || list === rankedPlanned ? (
                      <span title={`Share of time in sunlight during ${year}`}>Sun {year}</span>
                    ) : (
                      <span title={`Share of time in sunlight${panelHeight ? ` with panels ${panelHeight} m up` : " on the ground"}, averaged over 18.6 years`}>Sun{panelHeight ? ` ${panelHeight} m` : ""}</span>
                    )}
                    <span>Result</span>
                  </div>
                  <div className="rank">
                    {list.map((s, i) => {
                      const lr = landerBySite.get(s.id);
                      return (
                        <button
                          key={s.id}
                          className={s.id === selected?.id ? "rank-row rank-active" : "rank-row"}
                          onClick={() => setSelectedId(s.id)}
                          aria-pressed={s.id === selected?.id}
                        >
                          <span className="rank-i">{String(i + 1).padStart(2, "0")}</span>
                          <span className="rank-name" title={s.name}>{s.name}</span>
                          <span className="rank-sun">
                            {s.mission
                              ? stats.get(s.id) ? `${stats.get(s.id)!.illumPct.toFixed(0)}%` : "…"
                              : sunAtHeight(s) !== undefined ? `${sunAtHeight(s)!.toFixed(0)}%` : "…"}
                          </span>
                          <span className={lr?.survives ? "rank-score ok" : "rank-score bad"}>
                            {lr ? (lr.survives ? `✓ ${lr.minSocPct.toFixed(0)}%` : lr.failure === "earth" ? "✗ Earth" : "✗ dies") : "—"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )
            )}
            </div>
            <p className="fineprint">Best first: sites where your lander survives, then the most battery left over, then the most sunlight. The % after ✓ is the lowest the battery gets, as a share of its usable charge.</p>
          </section>
        </aside>

        {/* ================= STAGE: the pole ================= */}
        <main className="cx-stage" aria-label="Lunar south pole">
          <div className="stage-map">
            <div className="segmented stage-switch" role="group" aria-label="Map or 3D view">
              <button className={stageView === "map" ? "seg seg-on" : "seg"} onClick={() => setStageView("map")} aria-pressed={stageView === "map"}>Map</button>
              <button className={stageView === "finder" ? "seg seg-on" : "seg"} onClick={() => setStageView("finder")} aria-pressed={stageView === "finder"}>Site finder</button>
              <button className={stageView === "3d" ? "seg seg-on" : "seg"} onClick={() => setStageView("3d")} aria-pressed={stageView === "3d"}>3D terrain</button>
            </div>
            {stageView === "3d" ? (
              selected && reading && selected.lat <= -80 && elevation ? (
                <Suspense fallback={<div className="t3d-msg">Loading the 3D view…</div>}>
                  <Terrain3D
                    elevation={elevation}
                    lat={selected.lat}
                    lon={selected.lon}
                    name={selected.name}
                    sunAz={reading.sunAz}
                    sunElev={reading.sunElev}
                    earthAz={reading.earthAz}
                    earthElev={reading.earthElev}
                    lit={reading.lit}
                  />
                </Suspense>
              ) : (
                <div className="t3d-msg">
                  {selected && selected.lat > -80
                    ? `3D terrain covers 80–90°S, where we carry NASA's LOLA terrain. ${selected.name} is at ${Math.abs(selected.lat).toFixed(1)}°${selected.lat < 0 ? "S" : "N"}; pick a south-pole site to see it in 3D.`
                    : "Loading terrain…"}
                </div>
              )
            ) : (
            <MapView
              hillshade={hillshade}
              field={field}
              shadow={shadow}
              sites={sites.filter((s) => s.id !== "custom" && s.lat <= -80 && (layers.refs || s.current !== false || s.id === selected?.id))}
              selectedId={selected?.id ?? ""}
              onSelect={setSelectedId}
              sky={currentSky}
              onPick={pickPoint}
              custom={customSite && customSite.lat <= -80 ? customSite : null}
              layers={layers}
              elevation={elevation}
              finder={stageView === "finder" && finderData && finderResult ? { data: finderData, canvas: finderResult.canvas, limits } : null}
            >
              {selected && selected.lat > -80 && (
                <div className="offmap" role="note">
                  <b>{selected.name}</b> is at {Math.abs(selected.lat).toFixed(2)}°{selected.lat < 0 ? "S" : "N"}, {selected.lon.toFixed(1)}°E,
                  outside this south-pole map. Its Sun, Earth, power and radio results are all live in the panels; the shadows here are the pole's.
                </div>
              )}
              <div className="stage-hud">
                <span className="hud-title">Lunar south pole</span>
                {stageView === "finder" ? (
                  <>
                    <span>85°S to 90°S</span>
                    <span>NASA LOLA maps</span>
                  </>
                ) : (
                  <>
                    <span>80°S to 90°S</span>
                    <span>{shadow ? `${(shadow.frac * 100).toFixed(0)}% in sunlight` : "Loading"}</span>
                  </>
                )}
              </div>
            </MapView>
            )}
          </div>
          <MapStatusBar layers={layers} onLayers={setLayers} finderMode={stageView === "finder"} />
          {stageView === "finder" && (
            <section className="finder-panel" aria-label="Site finder">
              <div className="fp-head">
                <span className="fp-title">Where could you land?</span>
                <span className="fp-stat">
                  {finderErr ? finderErr : !finderResult ? "Loading NASA's 85°S maps…" : (
                    <><b>{finderResult.passCells.toLocaleString("en-GB")}</b> of {finderResult.valid.toLocaleString("en-GB")} cells ({(finderResult.cellKm * 1000).toFixed(0)} m) contain a 60 m spot that passes</>
                  )}
                </span>
              </div>
              <div className="fp-sliders">
                <FinderSlider label="Sunlight at least" unit="%" min={0} max={95} step={5} value={limits.sunPct} onChange={(v) => setLimits({ ...limits, sunPct: v })} />
                <FinderSlider label="Earth in view at least" unit="%" min={0} max={95} step={5} value={limits.earthPct} onChange={(v) => setLimits({ ...limits, earthPct: v })} />
                <FinderSlider label="Slope at most" unit="°" min={1} max={20} step={1} value={limits.slopeDeg} onChange={(v) => setLimits({ ...limits, slopeDeg: v })} />
                <FinderSlider label="Permanent shadow within" unit=" km" min={0.5} max={12.5} step={0.5} value={limits.shadowKm ?? 12.5}
                  onChange={(v) => setLimits({ ...limits, shadowKm: v })} off={limits.shadowKm === null} onToggle={() => setLimits({ ...limits, shadowKm: limits.shadowKm === null ? 5 : null })} />
              </div>
              {finderResult && finderResult.top.length > 0 && (
                <div className="fp-top">
                  <span className="fp-top-k">Best passing spots, 8 km apart · click to check</span>
                  {finderResult.top.map((t, i) => (
                    <button key={i} className="fp-spot" onClick={() => {
                      // on stacked (phone/tablet) layouts the result is below the map: take the user to it
                      if (checkCoords(t.lat, t.lon, "typed") && window.matchMedia("(max-width: 820px)").matches)
                        window.setTimeout(() => document.querySelector(".cx-right")?.scrollIntoView({ block: "start" }), 300);
                    }}
                            title={`This 60 m spot: sunlight ${t.sunPct}%, Earth in view ${t.earthPct}%, slope ${t.slopeDeg.toFixed(1)}°, permanent shadow (possible ice) ${t.shadowKm !== null ? `${t.shadowKm.toFixed(1)} km` : "over 12.7 km"} away`}>
                      <b>{Math.abs(t.lat).toFixed(2)}°S {t.lon.toFixed(1)}°E</b> <span>☀ {t.sunPct}% · ⊕ {t.earthPct}%</span>
                    </button>
                  ))}
                </div>
              )}
              {finderResult && finderResult.top.length === 0 && <p className="fineprint">Nothing passes all four limits. Relax one of them.</p>}
              <p className="fineprint fp-note" title="Every 60 m pixel of NASA's LOLA products (PGDA 69: 18.6-year Sun and Earth visibility, permanent shadow) is checked against your limits: each ~600 m cell keeps every spot that no other spot in it beats on all four values. A cell is green when any of its 60 m spots meets every limit. Permanent shadow is where ice can survive; it does not prove ice is there.">
                Built from NASA's LOLA sunlight, Earth and permanent-shadow maps at 60 m; slope from 80 m terrain, which cannot prove a lander footprint is safe. A spot opens at its exact position for the full check.
              </p>
            </section>
          )}
        </main>

        {/* ================= RIGHT RAIL: the selected site ================= */}
        <aside className="cx-rail cx-right" aria-label="Selected site">
          <section className="pane site-head">
            <div className="site-kicker">
              <span className={selected?.current === false ? "tag tag-ref" : "tag"}>
                {selected?.id === "custom" ? "Your chosen spot" : selected?.mission ? selected.group : selected?.current === false ? "Older NASA site" : "NASA Artemis III site"}
              </span>
              <span className="coord">
                {selected ? `${Math.abs(selected.lat).toFixed(2)}°${selected.lat < 0 ? "S" : "N"} ${selected.lon.toFixed(1)}°E` : ""}
              </span>
            </div>
            <h2 className="site-name">
              {selected?.name ?? "—"}
              {selected?.id === "custom" && (
                <button className="clear-custom" onClick={() => { setCustomSite(null); setSelectedId(""); }}>clear</button>
              )}
            </h2>
            {selected && <p className="blurb">{selected.blurb}</p>}
            {sameSpotNote && selected?.id !== "custom" && <p className="same-spot">{sameSpotNote}</p>}
            {selected && <NasaTools lat={selected.lat} lon={selected.lon} />}
          </section>

          <section className={verdictClass} id="lander-card" aria-live="polite" data-tour-focus={tourStep === 1 || tourStep === 2}>
            <div className="vh-top">
              <span className="vh-k">Land on {fmtDay(currentMs)}, stay {missionDays} days</span>
              {selected?.id === "custom" && selected.terrain && !selected.nearOf && <span className="vh-prelim" title="Coarse 600 m terrain: an early estimate">Preliminary</span>}
            </div>
            <div className="vh-main">
              {!selLander ? "…" : !missionFits
                ? "Stay is too long for this date"
                : selLander.survives ? "SURVIVES" : selLander.failure === "earth" ? "EARTH OUT OF VIEW TOO LONG" : reservePct ? "RESERVE BREACHED" : "BATTERY DIES"}
            </div>
            <div className="vh-sub">
              {selLander && missionFits && (selLander.survives
                ? selLander.minSocPct >= 99.5 ? "The battery stays full the whole time."
                  : selLander.minSocPct - reservePct < 1 ? `Only just: the battery bottoms out at ${selLander.minSocPct.toFixed(1)}% of its usable charge${reservePct ? `, right at your ${reservePct}% reserve` : ""}. No margin.`
                  : `The battery never drops below ${selLander.minSocPct.toFixed(0)}% of its usable charge${reservePct ? ` (reserve ${reservePct}%)` : ""}.`
                : selLander.failure === "earth"
                  ? `Earth stays below the skyline for more than ${maxOutageH} hours from ${fmtDate(selLander.earthFailAt! - (maxOutageH ?? 0) * 3600000)}; your plan allows ${maxOutageH} h without direct contact.`
                  : reservePct
                    ? `The battery falls to your ${reservePct}% reserve on ${fmtDate(selLander.lostAt!)}.`
                    : `It runs out of power in the dark on ${fmtDate(selLander.lostAt!)}.`)}
              {selLander && missionFits && selLander.survives && maxOutageH !== null && ` Longest time without Earth: ${selLander.longestEarthOutageH.toFixed(0)} h (limit ${maxOutageH} h).`}
              {selLander && !missionFits && `We model one calendar year at a time, to ${win.endLabel}. Land before ${fmtDay(START_MS + (DAYS - missionDays) * 86400000)}, or pick ${year + 1}.`}
            </div>
            {sizing && selLander && missionFits && (
              selLander.failure === "earth" ? (
                <div className="sizing">
                  <span className="sizing-k">What would fix it</span>
                  <span>No battery or panel size fixes this: it is about where Earth is. Land at another time or site, allow a longer gap, or plan for a relay.</span>
                </div>
              ) : (
                <div className="sizing">
                  <span className="sizing-k">{selLander.survives ? "How much margin you have (change one thing at a time)" : "Either of these fixes this landing (change one thing)"}</span>
                  <SizingOption
                    label={selLander.survives ? "Smallest battery that still works" : "Battery"}
                    value={sizing.batteryWh}
                    current={lander.batteryWh}
                    show={(v) => fmtEnergy(v)}
                    none="more than 1,000 kWh"
                    onApply={(v) => setLander({ ...lander, batteryWh: v })}
                  />
                  <SizingOption
                    label={selLander.survives ? "Smallest panels that still work" : "Panels"}
                    value={sizing.arrayM2}
                    current={lander.arrayM2}
                    show={(v) => `${v.toFixed(1)} m²`}
                    none="no size is enough: the darkness outlasts the battery"
                    onApply={(v) => setLander({ ...lander, arrayM2: v })}
                  />
                </div>
              )
            )}
            {stress.length > 1 && selLander && missionFits && (
              <StressCard
                cases={stress}
                limiting={limiting}
                robust={robust}
                lander={lander}
                landMs={currentMs}
                onLand={(ms) => setCurrentMs(ms)}
                onLander={(l) => setLander(l)}
                onSite={(id) => setSelectedId(id)}
                onNear={(site) => { setSameSpotNote(null); setCustomSite(site); setSelectedId("custom"); }}
              />
            )}
            {selLander && missionFits && selLander.soc.length > 1 && (
              <SocSpark soc={selLander.soc} lostFrac={selLander.lostAt !== null ? (selLander.lostAt - currentMs) / (missionDays * DAY_MS) : null} startMs={currentMs} days={missionDays} />
            )}
            {selLander && !selLander.survives && missionFits && (
              nextSurvivable !== null ? (
                <button className="cta" onClick={() => setCurrentMs(nextSurvivable)}>
                  Earliest landing it survives → {fmtDate(nextSurvivable)}
                </button>
              ) : (
                <p className="fineprint">No landing from {fmtDay(currentMs)} to {fmtDate(lastLandingMs)} (checked every 30 minutes) meets every requirement for {missionDays} days here. Try a bigger battery, more panels, another site or a looser Earth requirement.</p>
              )
            )}
            {selLander && missionFits && selected && (
              <button
                className="vh-dl"
                onClick={() =>
                  downloadText(
                    `sunlock-${selected.id}-${new Date(currentMs).toISOString().slice(0, 13).replace(":", "")}Z-${missionDays}d.csv`,
                    missionCsv({
                      site: selected, samples: selSeries, startIdx: landIdx, steps: missionSteps, soc: selLander.soc,
                      mode: arrayMode, spec: lander, heightM: selected.id === "custom" ? 0 : panelHeight,
                      result: selLander, req, stress,
                    })
                  )
                }
              >
                Download this mission as CSV
              </button>
            )}
            {selLander && missionFits && selected && (
              <button className="vh-dl" onClick={() => window.print()}>Print a one-page mission brief (or save as PDF)</button>
            )}
          </section>

          {reading && (
            <section className="pane now-strip" aria-label="Right now at this site">
              <div className="now-cell">
                <span className="now-k">Sun elevation</span>
                <span className={reading.lit ? "now-v is-sun" : "now-v is-off"}>{reading.sunElev >= 0 ? "+" : ""}{reading.sunElev.toFixed(1)}°</span>
                <span className="now-h">{reading.lit ? "above the horizon" : selected?.terrain === false ? "below a flat horizon" : `hills here reach ${reading.sunHorizon.toFixed(1)}°`}</span>
              </div>
              <div className="now-cell">
                <span className="now-k">{reading.lit ? "Sunset in" : "Sunrise in"}</span>
                <span className={reading.lit ? "now-v is-sun" : "now-v"}>{sunFlipMs !== null ? fmtIn(sunFlipMs) : "—"}</span>
                <span className="now-h">{sunFlipMs !== null ? fmtDate(currentMs + sunFlipMs).replace(/^\w+, /, "") : `not before the end of ${year}`}</span>
              </div>
              <div className="now-cell">
                <span className="now-k">Earth elevation</span>
                <span className={reading.comm ? "now-v is-comm" : "now-v is-off"}>{reading.earthElev >= 0 ? "+" : ""}{reading.earthElev.toFixed(1)}°</span>
                <span className="now-h">{reading.comm ? "above the skyline" : selected?.terrain === false ? "below a flat horizon" : `hills here reach ${reading.earthHorizon.toFixed(1)}°`}</span>
              </div>
              <div className="now-cell">
                <span className="now-k">{reading.comm ? "Earthset in" : "Earthrise in"}</span>
                <span className={reading.comm ? "now-v is-comm" : "now-v"}>{earthFlipMs !== null ? fmtIn(earthFlipMs) : "—"}</span>
                <span className="now-h">{earthFlipMs !== null ? fmtDate(currentMs + earthFlipMs).replace(/^\w+, /, "") : `not before the end of ${year}`}</span>
              </div>
            </section>
          )}
          {selected && reading && (
            <div className="verify-row">
              Check these positions yourself in NASA JPL Horizons:{" "}
              <a href={horizonsUrl("10", selected.lat, selected.lon, currentMs)} target="_blank" rel="noreferrer">Sun</a>
              {" · "}
              <a href={horizonsUrl("399", selected.lat, selected.lon, currentMs)} target="_blank" rel="noreferrer">Earth</a>
              <span className="verify-ours">
                ours now: Sun az {reading.sunAz.toFixed(2)}° el {reading.sunElev.toFixed(2)}° · Earth az {reading.earthAz.toFixed(2)}° el {reading.earthElev.toFixed(2)}°
              </span>
            </div>
          )}

          <section className="pane pane-tabs">
            <div className="tabs" role="tablist" aria-label="Site details">
              {(["sky", "evidence", "power", "comms"] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={rightTab === t}
                  className={rightTab === t ? "tab tab-on" : "tab"}
                  onClick={() => setRightTab(t)}
                >
                  {{ evidence: "Why trust this", sky: "Sky", power: "Power", comms: "Earth" }[t]}
                </button>
              ))}
            </div>

            {rightTab === "evidence" && (
              <div role="tabpanel">
                {selected?.longRun && (
                  <div className="longrun">
                    <div className="longrun-head">
                      <span className="longrun-k">Sunlight on the ground, averaged over 18.6 years</span>
                      <span className="longrun-v">
                        {selected.longRun.sunPct.toFixed(0)}%
                        <span className="range"> (likely {selected.longRun.sunRangePct[0].toFixed(0)}–{selected.longRun.sunRangePct[1].toFixed(0)}%)</span>
                      </span>
                    </div>
                    <div className="longrun-row">
                      {selected.longRun.nasaSunPct !== null ? (
                        <span className={selected.longRun.agrees ? "check ok" : "check warn"}>
                          {selected.longRun.agrees ? "✓" : "⚠"} NASA's own map says {selected.longRun.nasaSunPct.toFixed(0)}%
                          {" "}— {selected.longRun.agrees ? "we agree within" : "we differ by"} {Math.abs(selected.longRun.nasaDiffPp!).toFixed(1)} percentage points
                        </span>
                      ) : (
                        <span className="check">NASA's detailed map does not reach this far from the pole, so this is our estimate only</span>
                      )}
                    </div>
                  </div>
                )}
                {selected?.longRun && <Criteria site={selected} height={panelHeight} />}
                <div className="statgrid">
                  <Stat label="Sunlight" value={selStats ? `${selStats.illumPct.toFixed(0)}%` : "…"} hint={`${year}`} />
                  <Stat label="Longest darkness" value={selStats ? `${(selStats.longestDarkH / 24).toFixed(1)} days` : "…"} hint={`${year}`} />
                  <Stat label="Radio contact" value={selStats ? `${selStats.commPct.toFixed(0)}%` : "…"} hint={`${year}`} />
                  <Stat label="Elevation" value={selected ? `${selected.elevationM.toLocaleString("en-GB")} m` : "…"} hint="above the Moon's mean radius" />
                </div>
                {windows.length > 0 && (
                  <button className="cta cta-quiet" onClick={() => setCurrentMs([...windows].sort((a, b) => b.minSocPct - a.minSocPct)[0].start)}>
                    Safest landing for this lander → {fmtDay([...windows].sort((a, b) => b.minSocPct - a.minSocPct)[0].start)}
                  </button>
                )}
                {selected?.longRun && (
                  <p className="fineprint">
                    The "likely" range shows how much the answer moves with different calculation settings. This is
                    landing spot {selected.publishedSite}, the sunniest of {selected.longRun.nSites} spots proposed by
                    scientists for this site (Wueller et al. 2026){selected.longRun.nasaSunPct !== null ? " that also agrees with NASA's map" : ""}.
                  </p>
                )}
              </div>
            )}

            {rightTab === "sky" && reading && (
              <div role="tabpanel">
                <SkyView
                  horizon={selected.horizonDeg}
                  sun={{ az: reading.sunAz, elev: reading.sunElev }}
                  earth={{ az: reading.earthAz, elev: reading.earthElev }}
                  track={track}
                  sunLit={reading.lit}
                  earthComm={reading.comm}
                />
                <MoonFacts site={selected} series={selSeries.slice(0, YEAR_N)} year={year} />
              </div>
            )}

            {rightTab === "power" && (
              <div role="tabpanel">
                <div className="statgrid">
                  <Stat label="Power now" value={fmtPower(powerNow)} hint="per m² of panel" />
                  <Stat label="Energy per day" value={energyPerDay ? `${(energyPerDay / 1000).toFixed(1)} kWh` : "…"} hint="per m² of panel, average" />
                </div>
                <div className="power-note">
                  Energy per m² of panel per day here, averaged over {year}:
                  <ul className="mode-list">
                    {PANEL_MODES.map((m) => (
                      <li key={m} className={m === arrayMode ? "on" : undefined}>
                        <span>{{ tracking: "Turning to face the Sun", vertical: "Upright on four sides", horizontal: "Lying flat" }[m]}</span>
                        <b>{perDayByMode[m].toFixed(2)} kWh</b>
                      </li>
                    ))}
                  </ul>
                  {selected && selected.lat <= -60
                    ? "The Sun stays low here, so flat panels collect almost nothing; that is why polar landers mount theirs upright or on masts."
                    : "Away from the pole the Sun climbs high, so flat panels work too, but the two-week lunar night still has to be survived on battery."}
                </div>
                <div className="battery">
                  <span className="battery-k">Battery needed for the longest darkness</span>
                  <span className="battery-v">{fmtEnergy(battery)}</span>
                  <span className="battery-h">
                    to run {lander.loadW + (lander.heaterW ?? 0)} W{lander.heaterW ? ` (including ${lander.heaterW} W of heaters)` : ""} through {selStats ? (selStats.longestDarkH / 24).toFixed(1) : "—"} days of darkness, using {Math.round(lander.dod * 100)}% of the battery
                  </span>
                </div>
                <p className="fineprint">A simple estimate: 28%-efficient panels with 10% losses. Heaters are counted only if you set them; dust is not included.</p>
              </div>
            )}

            {rightTab === "comms" && (
              <div role="tabpanel">
                {reading && <LinkGraphic on={reading.comm} />}
                <div className="linkstate">
                  {reading && (
                    <>
                      <span className={reading.comm ? "dot dot-comm" : "dot dot-off"} />
                      {reading.comm ? "Earth is in view now" : "Earth is hidden now"}
                      <span className="linkmargin">
                        Earth {reading.earthElev.toFixed(1)}° high · hills {reading.earthHorizon.toFixed(1)}°
                      </span>
                    </>
                  )}
                </div>
                <ul className="windowlist">
                  {nextComms.map((w, i) => (
                    <li key={`${w.start}-${i}`}>
                      <button className="wlink" onClick={() => setCurrentMs(w.start)}>
                        <span className="w-when">{fmtDay(w.start)} · {new Date(w.start).toISOString().slice(11, 16)}Z</span>
                        <span className="w-len">{fmtDuration(w.hours)}</span>
                        <span className="w-margin" title="How far Earth clears the hills, on average">+{w.margin.toFixed(1)}°</span>
                      </button>
                    </li>
                  ))}
                  {nextComms.length === 0 && <li className="fineprint">No windows in this range.</li>}
                </ul>
                <p className="fineprint">Next times Earth is above the skyline, and for how long ({comms.length} in {year}). Direct radio needs this; ground-station schedules and link budget are not modelled.</p>
              </div>
            )}
          </section>
        </aside>
      </div>

      {/* ================= DOCK: time ================= */}
      <section className="cx-dock" aria-label="Time" data-tour-focus={tourStep === 3 || tourStep === 4}>
        <div className="dock-bar">
          <DateStepper ms={currentMs} min={START_MS} max={END_MS} onStep={stepBy} year={year} onYear={changeYear} />
          <div className="transport" role="group" aria-label="Time playback">
            <button className="tp-btn" onClick={() => { setPlaying(false); setCurrentMs(START_MS); }} aria-label="Back to start" title={`Back to 1 January ${year}`}>
              <svg viewBox="0 0 12 12" aria-hidden><path d="M1,1 h1.6 v10 H1z M11,1 L3.6,6 L11,11z" fill="currentColor" /></svg>
            </button>
            <button className={playing ? "tp-btn tp-play tp-on" : "tp-btn tp-play"} onClick={() => setPlaying((p) => !p)} aria-pressed={playing} title="Play or pause (Space)">
              <svg viewBox="0 0 12 12" aria-hidden>
                {playing ? <path d="M2,1 h3 v10 H2z M7,1 h3 v10 H7z" fill="currentColor" /> : <path d="M2,1 L11,6 L2,11z" fill="currentColor" />}
              </svg>
              {playing ? "Pause" : "Play"}
            </button>
            <div className="segmented" role="group" aria-label="Playback speed">
              {[6, 24, 72].map((h) => (
                <button key={h} className={speedH === h ? "seg seg-on" : "seg"} onClick={() => setSpeedH(h)} aria-pressed={speedH === h}
                  title={h < 24 ? `${h} hours per second` : `${h / 24} day${h > 24 ? "s" : ""} per second`}>
                  {h === 6 ? "Slow" : h === 24 ? "Normal" : "Fast"}
                </button>
              ))}
            </div>
          </div>
          <div className="dock-info">
            {dockTab !== "porkchop" ? (
              <>
                <span className="dock-stat">{dockTab === "timeline" ? selected?.name : `Land ${fmtDay(currentMs)}, stay ${missionDays} days`}</span>
                <div className="legend-inline">
                  <span><i className="chip chip-sun" />Sunlight</span>
                  <span><i className="chip chip-dark" />Shadow</span>
                  <span><i className="chip chip-comm" />Radio to Earth</span>
                </div>
              </>
            ) : (
              <>
                {pcSummary.total > 0 && (
                  <span className="dock-stat">
                    Survives <b>{Math.round((100 * pcSummary.ok) / pcSummary.total)}%</b> of {missionDays}-day landings
                  </span>
                )}
                <div className="legend-inline">
                  <span><i className="chip chip-ok" />Survives easily</span>
                  <span><i className="chip chip-low" />Only just</span>
                  <span><i className="chip chip-lost" />Fails (battery or Earth)</span>
                </div>
                <label className="pc-toggle">
                  <input type="checkbox" checked={showRefs} onChange={(e) => setShowRefs(e.target.checked)} /> Older sites
                </label>
              </>
            )}
          </div>
          <div className="tabs tabs-dock" role="tablist" aria-label="Time views">
            <button role="tab" aria-selected={dockTab === "timeline"} className={dockTab === "timeline" ? "tab tab-on" : "tab"} onClick={() => setDockTab("timeline")}>Timeline</button>
            <button role="tab" aria-selected={dockTab === "compare"} className={dockTab === "compare" ? "tab tab-on" : "tab"} onClick={() => setDockTab("compare")}>Compare</button>
            <button role="tab" aria-selected={dockTab === "porkchop"} className={dockTab === "porkchop" ? "tab tab-on" : "tab"} onClick={() => setDockTab("porkchop")}><span className="lbl-long">All sites &amp; dates</span><span className="lbl-short">All dates</span></button>
          </div>
        </div>

        <div className={dockTab === "timeline" ? "dock-panel" : "dock-panel is-porkchop"} role="tabpanel">
          {/* one time axis for whichever chart is below it: the grip, the ticks and the chart share a scale */}
          <div className="dock-axis">
            <div className="axis-labels" aria-hidden>
              {win.months.map((m, i) => (
                <span key={m.label} style={{ left: `${m.pct}%` }}>{m.label}{i === 0 && <i> {year}</i>}</span>
              ))}
            </div>
            <svg className="axis-ticks" viewBox={`0 0 ${DAYS} 10`} preserveAspectRatio="none" aria-hidden>
              {win.ticks.map((kind, d) => (
                <line key={d} className={`tk tk-${kind}`} x1={d} x2={d} y1={kind === "month" ? 0 : kind === "week" ? 4 : 7} y2="10" />
              ))}
            </svg>
            <input
              className="dock-slider"
              type="range"
              min={START_MS}
              max={END_MS}
              step={STEP_MS}
              value={currentMs}
              onChange={(e) => setCurrentMs(Number(e.target.value))}
              aria-label="Time"
              aria-valuetext={fmtDate(currentMs)}
            />
          </div>

          {dockTab === "compare" ? (
            <>
              <div className="compare">
                {compareRows.map((r, i) => (
                  <div className="cmp-row" key={i}>
                    <select className="cmp-pick" value={r.site.id} onChange={(e) => setCompareAt(i, e.target.value)} aria-label={`Site ${i + 1}`}>
                      <optgroup label="NASA Artemis III sites">
                        {officialSites.filter((s) => s.current !== false).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </optgroup>
                      <optgroup label="Past landings">
                        {missionSites.filter((s) => !s.approx).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </optgroup>
                      <optgroup label="Planned (target areas)">
                        {missionSites.filter((s) => s.approx).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </optgroup>
                      <optgroup label="Older Artemis sites">
                        {officialSites.filter((s) => s.current === false).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </optgroup>
                      {customSite && <option value="custom">{customSite.name}</option>}
                    </select>
                    <div className="cmp-strip">
                      {r.ser.length > 1 && <TimelineStrip samples={r.ser.slice(0, YEAR_N)} currentMs={currentMs} onScrub={setCurrentMs} height={34} />}
                    </div>
                    <span className={!r.run || !missionFits ? "cmp-verdict" : r.run.survives ? "cmp-verdict ok" : "cmp-verdict bad"}
                          title={r.run && missionFits ? (r.run.survives ? `Survives; battery never below ${r.run.minSocPct.toFixed(0)}% of usable charge` : r.run.failure === "earth" ? `Earth hidden too long from ${fmtDate(r.run.earthFailAt!)}` : `Battery limit ${fmtDate(r.run.lostAt!)}`) : ""}>
                      {!r.run || !missionFits ? "—" : r.run.survives ? `✓ ${r.run.minSocPct.toFixed(0)}%` : r.run.failure === "earth" ? "✗ Earth" : "✗ dies"}
                    </span>
                    <div className="cmp-stats">
                      <button className="cmp-name" onClick={() => setSelectedId(r.site.id)}>{r.site.name}</button>
                      <span>{r.ser[landIdx]?.lit ? "Sun up" : "Sun down"}{r.sunFlip !== null ? `, ${r.ser[landIdx]?.lit ? "sets" : "rises"} in ${fmtIn(r.sunFlip)}` : ""}</span>
                      <span>{r.ser[landIdx]?.comm ? "Earth in view" : "Earth hidden"}{r.earthFlip !== null ? `, ${r.ser[landIdx]?.comm ? "sets" : "rises"} in ${fmtIn(r.earthFlip)}` : ""}</span>
                      {r.st && <span>{year}: sun {r.st.illumPct.toFixed(0)}% · radio {r.st.commPct.toFixed(0)}% · longest dark {(r.st.longestDarkH / 24).toFixed(1)} d</span>}
                      {r.site.terrain === false && <span className="cmp-flag">no terrain: sphere horizon</span>}
                    </div>
                  </div>
                ))}
              </div>
              <p className="fineprint">The same lander, landing at the same moment, at up to three places. Pick any site in each row; click a name to open it, or drag along a strip to change the landing time for all of them.</p>
            </>
          ) : dockTab === "timeline" ? (
            <>
              {selSeries.length > 1 && (
                <TimelineStrip samples={yearSeries} currentMs={currentMs} onScrub={setCurrentMs} />
              )}
              <div className="windows">
                <span className="field-k">Best landing dates for this lander ({missionDays} days)</span>
                {windows.map((w) => (
                  <button key={w.start} className="window" onClick={() => setCurrentMs(w.start)}
                          title="Opens exactly this landing: same site, lander and requirements">
                    <span className="w-date">{fmtDay(w.start)} {new Date(w.start).toISOString().slice(11, 16)}</span>
                    <span className="w-meta">survives, battery ≥ {w.minSocPct.toFixed(0)}% · sun {w.illumPct.toFixed(0)}% · Earth {w.commPct.toFixed(0)}%</span>
                  </button>
                ))}
                {windows.length === 0 && <span className="fineprint">No landing in {year} meets every requirement for this lander here.</span>}
              </div>
            </>
          ) : (
            <>
              {porkchop.length > 0 && (
                <Porkchop
                  rows={porkchop}
                  t0={START_MS}
                  colMs={PC_STRIDE * STEP_MS}
                  currentMs={currentMs}
                  selectedId={selected?.id ?? ""}
                  onPick={(id, ms) => { setSelectedId(id); setCurrentMs(ms); }}
                />
              )}
              <p className="fineprint">Each row is a landing site, each column a landing date (every 6 hours). Green means your lander survives the whole stay; red means it fails a requirement (the battery reaches its limit, or Earth stays hidden too long). The number on the right is the share of landing dates it survives at that site. Click any square to land there.</p>
            </>
          )}
        </div>
      </section>

      {selected && selLander && missionFits && reading && (
        <MissionBrief
          site={selected}
          landMs={currentMs}
          days={missionDays}
          spec={lander}
          mode={arrayMode}
          heightM={selected.heights ? panelHeight : 0}
          run={selLander}
          req={req}
          sizing={sizing}
          next={nextSurvivable}
          reading={reading}
          sunFlipMs={sunFlipMs}
          earthFlipMs={earthFlipMs}
          stats={selStats}
          year={year}
          windows={windows}
          validation={validation}
          link={`${window.location.origin}${window.location.pathname}#${shareHash}`}
        />
      )}

      {/* ================= FOOTER: where the numbers come from ================= */}
      <footer className="cx-foot">
        <span>Terrain: NASA LRO LOLA, 80 m per pixel</span>
        <span>Positions: Astronomy Engine{verify ? ", checked against JPL Horizons" : ""}</span>
        {validation && <span>Sunlight agrees with NASA's 18.6-year map, r = {validation.mapWide.r.toFixed(3)}</span>}
        <span className="foot-keys"><kbd>Space</kbd> play <kbd>←</kbd> <kbd>→</kbd> step 6 hours</span>
        <span className="foot-note">A planning aid built for the NASA Space Apps Challenge. Not an official NASA product.</span>
      </footer>

      {/* ================= METHOD DRAWER ================= */}
      {methodOpen && (
        <div className="drawer-scrim" onClick={() => setMethodOpen(false)}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="method-title" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <h2 id="method-title">How it works</h2>
              <button className="cx-btn" onClick={() => setMethodOpen(false)} autoFocus>Close</button>
            </div>
            <div className="method-body">
            <div className="in-short">
              <h3>In short</h3>
              <ul>
                <li><b>The ground is real.</b> Heights come from the laser altimeter on NASA's Lunar Reconnaissance Orbiter, every 80 m across the pole.</li>
                <li><b>The sky is exact.</b> We compute where the Sun and Earth are for every half hour, and check those positions against NASA JPL's own ephemeris.</li>
                <li><b>We test ourselves against NASA.</b> Our sunlight, permanent-shadow and Earth-visibility results match the LOLA team's published maps, using pass/fail thresholds we wrote down before comparing.</li>
                <li><b>The lander check is simple on purpose.</b> A battery charges in sunlight and drains in the dark; if it empties, the lander is lost. Change the numbers to match your design.</li>
              </ul>
            </div>
            <h3 className="method-h">Technical details</h3>
            <p>
              Terrain: NASA <b>LRO LOLA</b> gridded elevation model <code>LDEM_80S_80M</code> (PDS Geosciences
              Node, LRO-L-LOLA-4-GDR-V1.0), 80 m/pixel, south polar stereographic, referenced to a 1737.4 km
              sphere. At each landing site the horizon is ray-marched over 360 azimuths out to 150 km with
              bilinear sampling every 40 m and the lunar curvature drop subtracted (the converged
              convention). The live shadow map uses a coarser 16-direction, 19 km horizon so it can be
              recomputed for the whole pole on every frame. Clicked points use a ~600 m grid. The 3D view
              draws a 120 × 120 km block of the same ~600 m grid around the site, lowered for the Moon's
              curvature and lit from the computed Sun direction; its shadows come from that block only, so
              the sunlit verdict always uses the full 150 km horizon. The site finder covers 85–90°S using
              only NASA's LOLA products: every 60 m pixel has its 18.6-year sunlight and Earth visibility (PGDA
              product 69), its slope from the 80 m terrain and its distance to the nearest permanently shadowed pixel
              in NASA's LPSR map. Each ~600 m cell keeps every pixel that no other pixel in it beats on all four, so a
              cell passes the limits you set exactly when one of its pixels does (<code>npm run finder</code> rebuilds it).
            </p>
            <p>
              Sites: NASA's nine Artemis III candidate regions (October 2024), plus the 2022 regions since
              dropped, shown as references. For each region we evaluate every published landing site of
              Wueller et al. (2026, <i>JGR Planets</i>, doi:10.1029/2025JE009434) over 18.6 years and show the
              sunniest one whose result agrees with NASA's own LOLA map within 5 points. For comparison the app
              also carries past landings (Apollo 11–17, CLPS landers IM-1, IM-2 and Blue Ghost Mission 1, and
              Chandrayaan-3, SLIM, Chang'e 4 and Chang'e 6) at their published positions, the announced target
              areas of planned missions (Griffin Mission One, Blue Moon MK1, Chang'e 7, IM-3; approximate, because no
              exact point has been published), and any coordinates you type. Landing dates can be any time from 2026
              to 2030, one calendar year (a full seasonal cycle) at a time. Inside 80–90°S these use the LOLA terrain horizon; elsewhere the horizon is the edge of the
              lunar sphere, as the app states for each site.
            </p>
            {validation && (
              <p>
                <b>Validated against NASA.</b> Against the LOLA team's 18.6-year sunlight map
                (PGDA product 69): r = {validation.mapWide.r.toFixed(3)}, bias{" "}
                {validation.mapWide.biasPp.toFixed(2)} pts, RMSE {validation.mapWide.rmsePp.toFixed(1)} pts over{" "}
                {validation.mapWide.n} random points (85–90°S, hourly over 18.6 years, as pre-registered).
                {validation.mapWide.shadow && <> On the same points, our permanent-shadow mask matches NASA's
                  (LPSR) with intersection-over-union {validation.mapWide.shadow.iou.toFixed(3)}
                  ({validation.mapWide.shadow.tp} agree, {validation.mapWide.shadow.fp} false alarms,{" "}
                  {validation.mapWide.shadow.fn} misses).</>}
                {validation.mapWide.earth && <> Earth visibility on the same points: r ={" "}
                  {validation.mapWide.earth.r.toFixed(3)}, RMSE {validation.mapWide.earth.rmsePp.toFixed(1)} pts.</>} At the {validation.landingSites.n}{" "}
                published landing sites inside the map: r = {validation.landingSites.r.toFixed(3)}, bias{" "}
                {validation.landingSites.biasPp.toFixed(1)} pts, and {validation.landingSites.within5pp} of{" "}
                {validation.landingSites.n} within 5 pts.
                {validation.earthAtLandingSites && (
                  <>
                    {" "}Earth visibility at the same sites against NASA's Earth map: r ={" "}
                    {validation.earthAtLandingSites.r.toFixed(3)}, RMSE {validation.earthAtLandingSites.rmsePp.toFixed(1)} pts.
                    That comparison caught an east–west mirror in the horizon that the sunlight map cannot detect
                    (solar elevation is symmetric about a site's meridian); it is fixed in this version.
                  </>
                )}{" "}
                Agreement is weakest within ~1° of the pole, where ridges are narrower than the 80 m terrain grid.
              </p>
            )}
            {validation?.preregistered && (
              <div className="prereg">
                <b>Pre-registered tests</b> (thresholds committed before any comparison was run):
                <ul>
                  {Object.entries(validation.preregistered).map(([k, v]) => (
                    <li key={k}>
                      <span className={v.result === "pass" ? "pr-pass" : v.result === "fail" ? "pr-fail" : "pr-na"}>
                        {v.result === "pass" ? "PASS" : v.result === "fail" ? "FAIL" : "NOT RUN"}
                      </span>{" "}
                      {k}: {v.test}
                      {v.r !== undefined && <> · measured r = {v.r.toFixed(3)}{v.rmsePp !== undefined && `, RMSE ${v.rmsePp.toFixed(1)} pts`}{v.n !== undefined && ` (n = ${v.n})`}</>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="fineprint">
              Data provenance: every map, site and validation file here is rebuilt from pinned NASA products (LOLA terrain, the
              LOLA team's illumination maps, LROC WAC) by one command, <code>npm run data</code>; the SHA-256 of each NASA input
              and each output is in <a href={`${import.meta.env.BASE_URL}terrain/manifest.json`} target="_blank" rel="noreferrer">manifest.json</a>,
              and <code>node scripts/fetch-data.mjs</code> downloads the inputs from NASA's archives and checks them.
            </p>
            <p>
              Ephemeris: Sun and Earth vectors from <b>Astronomy Engine</b> (VSOP87/ELP-based), rotated into
              the lunar body-fixed frame using the IAU WGCCRE 2015 mean Earth/polar axis model. A site is
              sunlit while any part of the solar disc (0.266° radius) clears its terrain horizon in that
              azimuth, the same definition as NASA's LOLA maps; the Earth link is counted while any part of
              Earth's ~0.95° disc is above the horizon. Earth is seen from the surface point, not the Moon's centre
              (topocentric): at ~221 lunar radii away that parallax moves it by up to 0.26°, enough to shift an
              Earthset by hours. The "Check in JPL Horizons" links open the same calculation in NASA JPL's own system.
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
              Power: solar constant 1361 W/m², cell efficiency 28%, system derate 0.9. A Sun-facing array is
              treated as normal-incidence; a flat array uses the cosine of solar zenith; upright panels are split
              equally over four vertical faces (N, E, S, W), so a square metre of total panel gives 25–35% of a
              Sun-facing one. The lander check steps a battery (starting full, usable to 80% depth of discharge)
              through every 30-minute step of the mission: panels deliver power in proportion to the visible share
              of the solar disc, a constant load runs throughout, and heaters run while less than half the disc
              is up. A lander whose battery empties is lost (the moment is interpolated within the step). An
              optional requirement limits how long Earth may be out of view; it is geometric visibility only, not
              ground-station scheduling or a link budget. The same evaluator drives the verdict, the site ranking,
              the landing dates, the date grid, the stress test and the exports. The smallest battery and panel area that survive a landing are found by
              bisection, since survival only improves as either grows, then rounded up to the input step and re-checked,
              so the value shown passes when applied. The stress test reruns the same landing 6 hours, 1 day and
              3 days late, with 20% less panel output, 20% more load, a battery 80% charged at landing, and hills
              raised until the year's sunlight there falls by our typical error against NASA's map (6.8 points);
              these are sensitivity cases, not probabilities. Every alternative it offers (later landing, battery,
              panels, other sites, positions 1–2 km away) is rerun on all of them, with the terrain case
              calibrated on that spot.
            </p>
            <p className="limits">
              <b>Limitations.</b> 80 m terrain resolution (sites on ridges narrower than that are uncertain,
              mostly within 1° of the pole). We tested NASA's 20 m polar terrain for the near field at 42 landing
              sites south of 87.6°S: it made them about 5 points darker and agreed less with NASA's 60 m-based
              map, which cannot tell us which is closer to reality, so the validated 80 m model is kept
              (<code>npm run exp:20m</code>); terrain beyond the horizon reach is ignored (150 km at sites,
              19 km in the live map); raised panels (2 m and 10 m) are modelled at the named sites only, and points
              you click on the map are checked at ground level; lunar orientation from the IAU 2015
              series with its periodic libration terms, not a numerical libration ephemeris; first-order
              power model with no thermal model or dust (heaters only as the constant load you set). The range shown with each long-run figure
              is the spread across horizon conventions. A planning aid for comparison, not a
              flight-qualified analysis.
            </p>
            <h3 className="method-h">Check it yourself</h3>
            <p>
              All code and data steps are open at{" "}
              <a href="https://github.com/shahaman098/sunlock" target="_blank" rel="noreferrer">github.com/shahaman098/sunlock</a>.
              In <code>web/</code>: <code>npm test</code> runs the automated checks (geometry, battery model and every
              published number against its threshold); <code>npm run validate</code> repeats the comparison with NASA's maps;{" "}
              <code>npm run verify</code> repeats the JPL Horizons check; <code>npm run sites</code> rebuilds the site
              choice from the published landing spots. Every mission here can also be downloaded as a CSV, half hour by half hour.
            </p>
          </div>
          </aside>
        </div>
      )}

      {tourStep !== null && (
        <Tour
          step={tourStep}
          onStep={(n) => {
            if (n === 1) {
              setSelectedId("de-gerlache-rim-2");
              setYear(2027);
              setCurrentMs(Date.UTC(2027, 1, 4));
              setMissionDays(14);
              setLander(DEFAULT_LANDER);
              setPanelHeight(0);
              setArrayMode("tracking");
              setStageView("map");
              setYear(2027);
              setRightTab("sky");
              setDockTab("timeline");
              document.getElementById("lander-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
            } else if (n === 2) {
              setCurrentMs(Date.UTC(2027, 1, 16));
              document.getElementById("lander-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
            } else if (n === 3) {
              setDockTab("porkchop");
              window.setTimeout(() => document.getElementById("porkchop")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
            } else if (n === 4) {
              setCompareIds(["de-gerlache-rim-2", "apollo-11", "malapert-massif"]);
              setDockTab("compare");
              window.setTimeout(() => document.querySelector(".compare")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
            } else if (n === 5) {
              setSelectedId("malapert-massif");
              setCurrentMs(Date.UTC(2027, 1, 18));
              setStageView("3d");
              window.setTimeout(() => document.querySelector(".cx-stage")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
            }
            setTourStep(n);
          }}
          onClose={closeTour}
        />
      )}
    </div>
  );
}

const TOUR = [
  {
    title: "The Sun never climbs high at the lunar south pole",
    body: "At the pole it is never more than about 1.5° above the horizon, so a ridge a few hundred metres away decides whether a lander has power. Press Play to watch real, laser-measured lunar terrain cast its shadows across NASA's nine Artemis III landing sites.",
    next: "Show me a landing",
  },
  {
    title: "Land on 4 February: the lander is lost",
    body: "At de Gerlache Rim 2 a 100 W lander with 4 m² of panels and a 10 kWh battery runs flat in the dark on 12 February. This answer comes from a terrain model that matches NASA's own sunlight map.",
    next: "Land ten days later",
  },
  {
    title: "Land on 16 February: it survives",
    body: "Same lander, same ridge, twelve days later: the battery never drops below 44%. Land on 14 February and it only just scrapes through. Timing, not just location, decides survival, and SUNLOCK finds the window for you.",
    next: "See every region and date",
  },
  {
    title: "Every region, every landing date",
    body: "This chart runs the same check for every NASA site and every landing date, six hours apart, for a whole year. Green survives, red is lost. Click any cell to land there, or change the lander and watch the map of possibilities change.",
    next: "Compare with Apollo",
  },
  {
    title: "Why the pole is different from Apollo",
    body: "Apollo 11 landed near the equator: two weeks of sunlight, then two weeks of night, like clockwork. At the pole the light comes and goes with the hills. Pick any three sites here, from Apollo to Chandrayaan-3, and compare them on one timeline.",
    next: "See the terrain in 3D",
  },
  {
    title: "The same Sun, on real terrain",
    body: "This is Malapert Massif from NASA's laser-measured terrain, lit by the Sun exactly where it is on 18 February 2027. Drag to turn it, or stand at the site to see the Sun skim the horizon. Press Play and watch the shadows move.",
    next: "Start exploring",
  },
];

function Tour({ step, onStep, onClose }: { step: number; onStep: (n: number) => void; onClose: () => void }) {
  const t = TOUR[step];
  const last = step === TOUR.length - 1;
  const progress = (
    <div className="tour-progress" aria-hidden>
      {TOUR.map((_, i) => <i key={i} className={i <= step ? "on" : undefined} />)}
    </div>
  );
  const actions = (
    <div className="tour-actions">
      <button className="tour-skip" onClick={onClose}>{last ? "Close" : "Skip tour"}</button>
      <button className="btn-hds" onClick={() => (last ? onClose() : onStep(step + 1))} autoFocus={step === 0}>
        {t.next}
        <span className="arrow" aria-hidden><ArrowIcon /></span>
      </button>
    </div>
  );

  // The first stop is a travel poster; the rest are captions beside the live console.
  if (step === 0) {
    return (
      <div className="poster-scrim">
        <div className="poster" role="dialog" aria-modal="true" aria-labelledby="tour-title">
          <PosterArt />
          <div className="poster-copy">
            <div className="kicker">A guided tour · {TOUR.length} stops</div>
            <h2 id="tour-title">{t.title}</h2>
            <p>{t.body}</p>
            {progress}
            {actions}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={step === TOUR.length - 1 ? "tour tour-low" : "tour"} role="dialog" aria-modal="false" aria-labelledby="tour-title">
      <div className="tour-step">Stop {step + 1} of {TOUR.length}</div>
      <h2 id="tour-title">{t.title}</h2>
      <p>{t.body}</p>
      {progress}
      {actions}
    </div>
  );
}

/** Poster for the tour's first stop: the Sun skimming the ridges, a lander's mast catching the light. */
function PosterArt() {
  return (
    <svg className="poster-art" viewBox="0 0 320 460" preserveAspectRatio="xMidYMax slice" role="img"
         aria-label="Poster: a low Sun skims the ridges of the lunar south pole while a small lander's solar mast catches the light">
      <defs>
        <linearGradient id="pa-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#05081a" />
          <stop offset="0.5" stopColor="#141338" />
          <stop offset="0.66" stopColor="#3a1f4d" />
        </linearGradient>
      </defs>
      <rect width="320" height="460" fill="url(#pa-sky)" />
      {[[28, 40, 1], [70, 96, 0.7], [118, 30, 0.8], [150, 120, 0.6], [206, 58, 1], [262, 28, 0.7], [292, 104, 0.9], [244, 150, 0.6], [36, 190, 0.7], [300, 196, 0.6], [98, 164, 0.5], [180, 84, 0.5]].map(([x, y, r]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="#fff3d6" opacity="0.85" />
      ))}
      {/* Earth, low over the far ridge */}
      <circle cx="62" cy="214" r="13" fill="#1b2452" />
      <path d="M62,201 a13,13 0 0 0 0,26 a7,13 0 0 1 0,-26z" fill="#6fb6ee" />
      {/* the Sun and its flat poster halo */}
      <circle cx="176" cy="286" r="132" fill="#2c1b4e" opacity="0.55" />
      <circle cx="176" cy="286" r="100" fill="#5d2b55" opacity="0.6" />
      <circle cx="176" cy="286" r="72" fill="#a8443f" opacity="0.7" />
      <circle cx="176" cy="286" r="48" fill="#e8853f" opacity="0.85" />
      <circle cx="176" cy="286" r="27" fill="#ffe0a0" />
      {/* ridges, far to near */}
      <path d="M0,294 L30,282 L62,292 L96,270 L128,288 L160,278 L200,292 L236,272 L270,286 L320,268 L320,460 L0,460Z" fill="#3b2350" />
      <path d="M128,288 L160,278 L200,292" fill="none" stroke="#ffbf6b" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M0,332 L40,308 L70,324 L112,298 L150,328 L190,312 L226,334 L262,314 L320,338 L320,460 L0,460Z" fill="#191735" />
      <path d="M0,374 L48,352 L90,364 L150,342 L206,354 L232,332 L262,352 L320,342 L320,460 L0,460Z" fill="#05060d" />
      {/* lander on the near peak */}
      <g stroke="#d5d9e0" strokeWidth="1.3" strokeLinecap="round" fill="none">
        <path d="M225,332 l4,-8 M239,332 l-4,-8 M232,318 v-20" />
      </g>
      <rect x="227.5" y="318" width="9" height="6" fill="#d5d9e0" />
      <rect x="229.5" y="294" width="5" height="13" fill="#f5b450" />
      <text x="20" y="34" className="pa-small">80°S TO 90°S</text>
      <text x="20" y="404" className="pa-title" fontSize="26">VISIT THE LUNAR</text>
      <text x="20" y="446" className="pa-title" fontSize="50">SOUTH POLE</text>
    </svg>
  );
}

/** Lander-to-Earth radio link, drawn the way DSN Now draws a dish talking to a spacecraft. */
function LinkGraphic({ on }: { on: boolean }) {
  return (
    <svg className={on ? "linkfx linkfx-on" : "linkfx"} viewBox="0 0 320 80" role="img"
         aria-label={on ? "The lander has a clear radio path to Earth" : "Hills block the radio path between the lander and Earth"}>
      <path className="lf-beam lf-up" d="M62,34 H262" />
      <path className="lf-beam lf-down" d="M62,44 H262" />
      {!on && <path className="lf-hill" d="M118,58 L146,24 L162,38 L180,16 L208,58Z" />}
      <g className="lf-body">
        <path d="M26,46 h20 v10 h-20z M26,56 l-6,9 M46,56 l6,9 M36,46 v-6" />
        <path d="M27,28 Q30,41 45,40 M34,38 L43,29" />
      </g>
      <circle className="lf-earth" cx="286" cy="39" r="14" />
      <path className="lf-land" d="M279,32 q5,-4 9,0 q-1,5 -6,5z M287,43 q5,-2 8,1 q-3,5 -7,4z" />
      <text className="lf-label" x="36" y="76" textAnchor="middle">LANDER</text>
      <text className="lf-label" x="286" y="76" textAnchor="middle">EARTH</text>
      <text className="lf-state" x="162" y={on ? 26 : 72} textAnchor="middle">{on ? "SENDING AND RECEIVING" : "NO LINK: HILLS IN THE WAY"}</text>
    </svg>
  );
}

/** Date boxes with a stepper on each part, as on the Worldview timeline. */
function DateStepper({ ms, min, max, onStep, year, onYear }: {
  ms: number; min: number; max: number; onStep: (deltaMs: number) => void; year: number; onYear: (y: number) => void;
}) {
  const d = new Date(ms);
  const monthShift = (dir: 1 | -1) => {
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + dir;
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay), d.getUTCHours(), d.getUTCMinutes()) - ms;
  };
  const cells = [
    { unit: "one month", value: d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }).toUpperCase(), up: monthShift(1), down: monthShift(-1) },
    { unit: "one day", value: String(d.getUTCDate()).padStart(2, "0"), up: DAY_MS, down: -DAY_MS },
    { unit: "6 hours", value: d.toISOString().slice(11, 16), up: 6 * 3600000, down: -6 * 3600000 },
  ];
  return (
    <div className="datebox" role="group" aria-label="Date and time, UTC">
      <div className="db-cell">
        <select className="db-val db-year" value={year} onChange={(e) => onYear(Number(e.target.value))} aria-label="Landing year">
          {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      {cells.map((c) => (
        <div className="db-cell" key={c.unit}>
          <button className="db-arrow" disabled={ms >= max} onClick={() => onStep(c.up)} aria-label={`Forward ${c.unit}`} title={`Forward ${c.unit}`}>
            <svg viewBox="0 0 9 6" aria-hidden><path d="M0,6 L4.5,0 L9,6Z" fill="currentColor" /></svg>
          </button>
          <span className="db-val">{c.value}</span>
          <button className="db-arrow" disabled={ms <= min} onClick={() => onStep(c.down)} aria-label={`Back ${c.unit}`} title={`Back ${c.unit}`}>
            <svg viewBox="0 0 9 6" aria-hidden><path d="M0,0 L4.5,6 L9,0Z" fill="currentColor" /></svg>
          </button>
        </div>
      ))}
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5,6 H10 M6.5,2.5 L10,6 L6.5,9.5" />
    </svg>
  );
}

/** Every landing criterion we can compute from NASA data, in plain words. */
function Criteria({ site, height }: { site: Site; height: number }) {
  const lr = site.longRun!;
  const sunAt = (h: number) => site.heights?.find((x) => x.heightM === h)?.sunPct;
  const psr =
    lr.psrKm === null || lr.psrKm === undefined
      ? "outside NASA's map"
      : typeof lr.psrKm === "string"
        ? "more than 30 km"
        : lr.psrKm < 1
          ? `${Math.round(lr.psrKm * 1000)} m`
          : `${lr.psrKm.toFixed(1)} km`;
  const rows: [string, string, string][] = [
    ["Sunlight on the ground", `${lr.sunPct.toFixed(0)}%`, "averaged over 18.6 years"],
    ["Sunlight 2 m up (lander deck)", sunAt(2) !== undefined ? `${sunAt(2)!.toFixed(0)}%` : "—", "same, panels raised 2 m"],
    ["Sunlight 10 m up (mast)", sunAt(10) !== undefined ? `${sunAt(10)!.toFixed(0)}%` : "—", "same, panels raised 10 m"],
    ["Radio contact with Earth", `${lr.earthPct.toFixed(0)}%`, "Earth above the hills"],
    ["Sun and radio together", lr.sunAndEarthPct !== undefined ? `${lr.sunAndEarthPct.toFixed(0)}%` : "—", "power and a link home at once"],
    ["Longest darkness", `${(lr.longestNightH / 24).toFixed(0)} days`, "worst case in 18.6 years"],
    ["Longest radio blackout", lr.longestBlackoutH !== undefined ? `${(lr.longestBlackoutH / 24).toFixed(0)} days` : "—", "worst case; needs a relay"],
    ["Nearest permanent shadow", psr, "where water ice can survive"],
    ["Ground slope", site.slopeDeg !== undefined ? `${site.slopeDeg.toFixed(1)}°` : "—", "over ~240 m"],
    ["Distance from the pole", lr.poleKm !== undefined ? `${lr.poleKm.toFixed(0)} km` : "—", ""],
  ];
  return (
    <div className="criteria" aria-label="Landing criteria">
      <div className="criteria-head">Landing criteria at this spot</div>
      {rows.map(([k, v, h], i) => (
        <div key={k} className={(i === 1 && height === 2) || (i === 2 && height === 10) || (i === 0 && height === 0) ? "crit crit-on" : "crit"}>
          <span className="crit-k">{k}</span>
          <span className="crit-v">{v}</span>
          <span className="crit-h">{h}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Open the same spot in the NASA tools the challenge names. Moon Trek takes the position in
 * its link; QuickMap takes it in its search box, so we copy "lat, lon" for pasting.
 */
function NasaTools({ lat, lon }: { lat: number; lon: number }) {
  const [copied, setCopied] = useState(false);
  const lon180 = lon > 180 ? lon - 360 : lon;
  const trek = `https://trek.nasa.gov/moon/#v=0.1&x=${lon180.toFixed(4)}&y=${lat.toFixed(4)}&z=9&p=urn%3Aogc%3Adef%3Acrs%3AEPSG%3A%3A104903&d=`;
  const coords = `${lat.toFixed(4)}, ${lon180.toFixed(4)}`;
  return (
    <div className="nasatools">
      <span>See this spot in NASA's tools:</span>
      <a href={trek} target="_blank" rel="noreferrer">Moon Trek</a>
      <a
        href="https://quickmap.lroc.im-ldi.com/"
        target="_blank"
        rel="noreferrer"
        onClick={() => {
          navigator.clipboard?.writeText(coords).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 4000); }, () => {});
        }}
        title={`Opens LROC QuickMap; paste ${coords} into its search box`}
      >
        LROC QuickMap
      </a>
      <span className="nasatools-hint">{copied ? `copied ${coords}: paste it into QuickMap's search box` : `QuickMap search: ${coords}`}</span>
    </div>
  );
}

/** Why this sky is not like Earth's, in plain words, with this site's own numbers. */
function MoonFacts({ site, series, year }: { site: Site; series: { sunElev: number; earthElev: number }[]; year: number }) {
  if (!series.length) return null;
  let sunMax = -90, eMin = 90, eMax = -90;
  for (const s of series) {
    if (s.sunElev > sunMax) sunMax = s.sunElev;
    if (s.earthElev < eMin) eMin = s.earthElev;
    if (s.earthElev > eMax) eMax = s.earthElev;
  }
  const polar = site.lat <= -80;
  const farSide = eMax < -2;
  return (
    <ul className="moonfacts" aria-label="How this sky differs from Earth's">
      <li>
        <b>The Sun peaks at {sunMax.toFixed(1)}° here in {year}.</b>{" "}
        {polar
          ? "Near the pole it circles the horizon instead of crossing the sky, so a hill a few kilometres away can hide it for days."
          : "A lunar day lasts about 29.5 Earth days: roughly two weeks of sunlight, then two weeks of night."}
      </li>
      <li>
        <b>{farSide ? "Earth never rises here." : `Earth stays between ${eMin.toFixed(1)}° and ${eMax.toFixed(1)}° all year.`}</b>{" "}
        {farSide
          ? "This is the far side: a lander needs a relay satellite to talk to Earth."
          : "The Moon keeps one face to Earth, so Earth does not rise and set each day; it only wobbles (libration). Radio windows open and close over days and weeks."}
      </li>
      <li>
        <b>No air.</b> Nothing bends sunlight over the horizon (no refraction), there is no twilight, and shadows are fully dark, so we compare
        the Sun and Earth with the bare terrain{site.terrain === false ? " (here, the edge of the lunar sphere)" : ""}.
      </li>
    </ul>
  );
}

/** One sizing alternative, applied with one click; the value shown has already been checked. */
function SizingOption({ label, value, current, show, none, onApply }: {
  label: string; value: number | null; current: number; show: (v: number) => string; none: string; onApply: (v: number) => void;
}) {
  return (
    <span className="sz-opt">
      <span>
        {label} <b>{value !== null ? show(value) : none}</b>
        {value !== null && <i> (you have {show(current)})</i>}
      </span>
      {value !== null && Math.abs(value - current) > 1e-9 && (
        <button className="sz-apply" onClick={() => onApply(value)}>Use {show(value)}</button>
      )}
    </span>
  );
}

/**
 * The same landing under adverse assumptions: which case breaks it first, and the single
 * changes (later landing, bigger battery, more panels, another site) that pass every case.
 */
function StressCard({ cases, limiting, robust, lander, landMs, onLand, onLander, onSite, onNear }: {
  cases: StressCase[];
  limiting: StressCase | null;
  robust: { landMs: number | null; batteryWh: number | null; arrayM2: number | null; sitesOk: Site[]; nearOk: Site[]; nearTested: number } | null;
  lander: LanderSpec;
  landMs: number;
  onLand: (ms: number) => void;
  onLander: (l: LanderSpec) => void;
  onSite: (id: string) => void;
  onNear: (site: Site) => void;
}) {
  const tested = cases.filter((c) => c.result);
  const passing = tested.filter((c) => c.result!.survives).length;
  const unknown = cases.length - tested.length;
  const why = (r: MissionResult) => (r.failure === "earth" ? `Earth hidden too long from ${fmtDay(r.earthFailAt!)}` : `battery limit ${fmtDay(r.lostAt!)}`);
  return (
    <div className="stress">
      <span className="sizing-k">What could break this plan · {passing} of {cases.length} cases pass{unknown ? ` · ${unknown} unknown` : ""}</span>
      <ul>
        {cases.map((c) => (
          <li key={c.id} className={!c.result ? "na" : c.result.survives ? "ok" : "bad"}>
            <span>{c.label}</span>
            <b>
              {!c.result ? "? unknown" : c.result.survives
                ? `✓ ${c.result.minSocPct.toFixed(0)}%`
                : c.result.failure === "earth" ? "✗ Earth" : `✗ ${fmtDay(c.result.lostAt!)}`}
            </b>
          </li>
        ))}
      </ul>
      {limiting && (
        <p className="stress-limit">
          <b>Limiting condition:</b> {limiting.label.toLowerCase()}: {why(limiting.result!)}.
        </p>
      )}
      {unknown > 0 && <p className="stress-limit">{unknown} case{unknown > 1 ? "s run" : " runs"} past the modelled data, so this plan is not shown as passing every case.</p>}
      {robust && passing < cases.length && (
        <div className="robust">
          <span className="sizing-k">Single changes that pass all {cases.length} cases</span>
          <span className="sz-opt">
            <span>Land later: <b>{robust.landMs !== null ? fmtDate(robust.landMs) : "no time this year"}</b></span>
            {robust.landMs !== null && robust.landMs !== landMs && <button className="sz-apply" onClick={() => onLand(robust.landMs!)}>Land then</button>}
          </span>
          <span className="sz-opt">
            <span>Battery: <b>{robust.batteryWh !== null ? fmtEnergy(robust.batteryWh) : "no size is enough"}</b></span>
            {robust.batteryWh !== null && <button className="sz-apply" onClick={() => onLander({ ...lander, batteryWh: robust.batteryWh! })}>Use {fmtEnergy(robust.batteryWh)}</button>}
          </span>
          <span className="sz-opt">
            <span>Panels: <b>{robust.arrayM2 !== null ? `${robust.arrayM2.toFixed(1)} m²` : "no size is enough"}</b></span>
            {robust.arrayM2 !== null && <button className="sz-apply" onClick={() => onLander({ ...lander, arrayM2: robust.arrayM2! })}>Use {robust.arrayM2.toFixed(1)} m²</button>}
          </span>
          <span className="sz-opt sz-sites">
            <span>Other NASA sites on this date:</span>
            {robust.sitesOk.length ? robust.sitesOk.map((s) => (
              <button key={s.id} className="sz-apply" onClick={() => onSite(s.id)}>{s.name}</button>
            )) : <b>none</b>}
          </span>
          {robust.nearTested > 0 && (
            <span className="sz-opt sz-sites">
              <span>Nearby, 1–2 km away:</span>
              {robust.nearOk.length ? robust.nearOk.map((s) => (
                <button key={s.name} className="sz-apply" onClick={() => onNear(s)} title={s.blurb}>{s.name.replace(/ of .*$/, "")}</button>
              )) : <b>none of {robust.nearTested} tested positions</b>}
            </span>
          )}
          <span className="stress-note">
            Every alternative is run on all {cases.length} cases, with its terrain case calibrated on that spot.
            {robust.nearTested > 0 && " Nearby positions have their own 80 m skylines (same method as the sites, ground level); slope there is not checked."}
          </span>
        </div>
      )}
      <span className="stress-note">Sensitivity cases we chose, not probabilities. % = lowest battery charge.</span>
    </div>
  );
}

function FinderSlider({ label, unit, min, max, step, value, onChange, off, onToggle }: {
  label: string; unit: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void;
  off?: boolean; onToggle?: () => void;
}) {
  return (
    <label className={off ? "fp-slider is-off" : "fp-slider"}>
      <span className="fp-k">
        {onToggle && <input type="checkbox" checked={!off} onChange={onToggle} aria-label={`Use the ${label.toLowerCase()} limit`} />}
        {label} <b>{off ? "any" : `${value}${unit}`}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={off} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

/** Type a latitude and longitude to check any spot on the Moon. */
function CoordForm({ onCheck, terrainReady }: { onCheck: (lat: number, lon: number) => boolean; terrainReady: boolean }) {
  const [lat, setLat] = useState("-89.5");
  const [lon, setLon] = useState("222.7");
  const [msg, setMsg] = useState<string | null>(null);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const a = Number(lat), b = Number(lon);
    if (!Number.isFinite(a) || a < -90 || a > 90) return setMsg("Latitude must be between -90 (south) and 90 (north).");
    if (!Number.isFinite(b) || b < -180 || b > 360) return setMsg("Longitude must be between -180 and 360 (east positive).");
    if (!onCheck(a, b)) return setMsg(terrainReady ? "Could not check that spot." : "Terrain is still loading; try again in a moment.");
    setMsg(null);
  };
  return (
    <form className="coordform" onSubmit={submit} aria-label="Check any spot by coordinates">
      <span className="field-k">Check any spot on the Moon</span>
      <label><span>Lat</span><input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} aria-label="Latitude, degrees, negative is south" /></label>
      <label><span>Lon °E</span><input inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} aria-label="Longitude, degrees east" /></label>
      <button type="submit" className="advice-go">Check</button>
      {msg && <span className="coord-msg" role="alert">{msg}</span>}
    </form>
  );
}

function NumIn({ label, unit, value, min, max, step, onChange }: {
  label: string; unit: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <label className="numin">
      <span className="stat-label">{label}</span>
      <span className="numin-field">
        <input
          type="number"
          inputMode="decimal"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= min && v <= max) onChange(v);
          }}
        />
        <span className="numin-unit">{unit}</span>
      </span>
    </label>
  );
}

/** Battery state of charge across the mission (0–100%). */
function SocSpark({ soc, lostFrac, startMs, days }: { soc: Float32Array; lostFrac: number | null; startMs: number; days: number }) {
  const W = 300, H = 44;
  const n = soc.length;
  const end = lostFrac !== null ? Math.min(n, Math.max(1, Math.round(lostFrac * n) + 1)) : n;
  const pts: string[] = [];
  const stride = Math.max(1, Math.floor(n / 150));
  for (let i = 0; i < end; i += stride) pts.push(`${((i / (n - 1)) * W).toFixed(1)},${(H - (soc[i] / 100) * H).toFixed(1)}`);
  if ((end - 1) % stride) pts.push(`${(((end - 1) / (n - 1)) * W).toFixed(1)},${(H - (soc[end - 1] / 100) * H).toFixed(1)}`);
  const lostX = lostFrac !== null ? Math.min(W, Math.max(0, lostFrac * W)) : null;
  return (
    <figure className="soc-wrap">
      <svg className="soc" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
           aria-label={lostX !== null ? "Battery charge across the mission, falling to empty" : "Battery charge across the mission"}>
        <line x1="0" y1={H} x2={W} y2={H} className="soc-zero" />
        <polyline points={pts.join(" ")} className="soc-line" />
        {lostX !== null && <line x1={lostX} x2={lostX} y1="0" y2={H} className="soc-lost" />}
      </svg>
      <figcaption className="soc-axis">
        <span>Battery · land {fmtDay(startMs)}</span>
        <span>{fmtDay(startMs + days * DAY_MS)}</span>
      </figcaption>
    </figure>
  );
}

/**
 * A one-page brief of the current scenario for handing between science and engineering
 * teams. Hidden on screen; it is the only thing printed (see @media print).
 */
function MissionBrief(p: {
  site: Site; landMs: number; days: number; spec: LanderSpec; mode: ArrayMode; heightM: number;
  run: MissionResult;
  req?: MissionRequirements;
  sizing: { batteryWh: number | null; arrayM2: number | null } | null; next: number | null;
  reading: { sunElev: number; sunAz: number; lit: boolean; earthElev: number; earthAz: number; comm: boolean };
  sunFlipMs: number | null; earthFlipMs: number | null;
  stats: { illumPct: number; commPct: number; longestDarkH: number } | undefined; year: number;
  windows: { start: number; illumPct: number; commPct: number }[];
  validation: Validation | null;
  link: string;
}) {
  const { site, spec, run } = p;
  const lr = site.longRun;
  const row = (k: string, v: string) => <tr key={k}><th>{k}</th><td>{v}</td></tr>;
  const mode = { tracking: "turning to face the Sun", vertical: "upright on four sides", horizontal: "lying flat" }[p.mode];
  return (
    <section className="brief" aria-hidden>
      <header className="brief-head">
        <div>
          <div className="brief-k">SUNLOCK mission brief</div>
          <h1>{site.name}</h1>
          <div className="brief-sub">
            {Math.abs(site.lat).toFixed(3)}°{site.lat < 0 ? "S" : "N"} {site.lon.toFixed(3)}°E
            {site.publishedSite ? ` · published landing spot ${site.publishedSite}` : ""}
            {site.terrain === false ? " · horizon: edge of the lunar sphere (no terrain data here)" : " · horizon: LRO LOLA terrain"}
          </div>
        </div>
        <div className={run.survives ? "brief-verdict ok" : "brief-verdict bad"}>
          {run.survives ? "SURVIVES" : run.failure === "earth" ? "EARTH OUT OF VIEW TOO LONG" : (p.req?.reservePct ?? 0) > 0 ? "RESERVE BREACHED" : "BATTERY DIES"}
          <span>{run.survives ? `lowest charge ${run.minSocPct.toFixed(1)}% of usable` : run.failure === "earth" ? `Earth limit exceeded ${fmtDate(run.earthFailAt!)}` : `lost ${fmtDate(run.lostAt!)}`}</span>
        </div>
      </header>

      <div className="brief-cols">
        <table>
          <caption>Scenario</caption>
          <tbody>
            {row("Landing", fmtDate(p.landMs))}
            {row("Stay", `${p.days} days`)}
            {row("Power use", `${spec.loadW} W${spec.heaterW ? ` + ${spec.heaterW} W heaters in the dark` : ""}`)}
            {row("Solar panels", `${spec.arrayM2} m², ${mode}${p.heightM ? `, ${p.heightM} m above the ground` : ""}`)}
            {row("Battery", `${fmtEnergy(spec.batteryWh)}, ${Math.round(spec.dod * 100)}% usable`)}
          </tbody>
        </table>
        <table>
          <caption>Result</caption>
          <tbody>
            {row("Verdict", run.survives ? `Survives; battery never below ${run.minSocPct.toFixed(1)}% of usable charge` : run.failure === "earth" ? `Fails: Earth out of view longer than allowed, from ${fmtDate(run.earthFailAt!)}` : `Battery reaches its limit ${fmtDate(run.lostAt!)}`)}
            {row("Longest time without Earth", `${run.longestEarthOutageH.toFixed(0)} h`)}
            {p.sizing && run.failure !== "earth" && row(run.survives ? "Smallest battery that works (panels unchanged)" : "Battery needed (panels unchanged)", p.sizing.batteryWh !== null ? fmtEnergy(p.sizing.batteryWh) : "more than 1,000 kWh")}
            {p.sizing && run.failure !== "earth" && row(run.survives ? "Smallest panels that work (battery unchanged)" : "Or panels needed (battery unchanged)", p.sizing.arrayM2 !== null ? `${p.sizing.arrayM2.toFixed(1)} m²` : "no size is enough")}
            {!run.survives && row("Earliest landing that survives", p.next !== null ? fmtDate(p.next) : `none in ${p.year}`)}
          </tbody>
        </table>
        <table>
          <caption>At landing</caption>
          <tbody>
            {row("Sun", `${p.reading.sunElev >= 0 ? "+" : ""}${p.reading.sunElev.toFixed(2)}° elevation, ${p.reading.sunAz.toFixed(1)}° azimuth, ${p.reading.lit ? "up" : "down"}`)}
            {row(p.reading.lit ? "Sunset in" : "Sunrise in", p.sunFlipMs !== null ? fmtIn(p.sunFlipMs) : `not in ${p.year}`)}
            {row("Earth", `${p.reading.earthElev >= 0 ? "+" : ""}${p.reading.earthElev.toFixed(2)}° elevation, ${p.reading.earthAz.toFixed(1)}° azimuth, ${p.reading.comm ? "in view" : "hidden"}`)}
            {row(p.reading.comm ? "Earthset in" : "Earthrise in", p.earthFlipMs !== null ? fmtIn(p.earthFlipMs) : `not in ${p.year}`)}
          </tbody>
        </table>
        <table>
          <caption>This site</caption>
          <tbody>
            {lr && row("Sunlight, 18.6-year average", `${lr.sunPct.toFixed(0)}% (likely ${lr.sunRangePct[0].toFixed(0)}–${lr.sunRangePct[1].toFixed(0)}%)${lr.nasaSunPct !== null ? `; NASA's map ${lr.nasaSunPct.toFixed(0)}%` : ""}`)}
            {lr && row("Radio contact, 18.6-year average", `${lr.earthPct.toFixed(0)}%`)}
            {lr?.longestBlackoutH !== undefined && row("Longest radio blackout", `${(lr.longestBlackoutH / 24).toFixed(0)} days`)}
            {p.stats && row(`Sunlight in ${p.year}`, `${p.stats.illumPct.toFixed(0)}%; longest darkness ${(p.stats.longestDarkH / 24).toFixed(1)} days`)}
            {p.stats && row(`Radio contact in ${p.year}`, `${p.stats.commPct.toFixed(0)}%`)}
            {site.slopeDeg !== undefined && row("Ground slope", `${site.slopeDeg.toFixed(1)}°`)}
            {p.windows.length > 0 && row(`Sunniest ${p.days}-day windows`, p.windows.slice(0, 3).map((w) => `${fmtDay(w.start)} (${w.illumPct.toFixed(0)}% sun)`).join(", "))}
          </tbody>
        </table>
      </div>

      <SocSpark soc={run.soc} lostFrac={run.lostAt !== null ? (run.lostAt - p.landMs) / (p.days * DAY_MS) : null} startMs={p.landMs} days={p.days} />

      <footer className="brief-foot">
        <p>
          Method: LRO LOLA LDEM_80S_80M terrain horizon (150 km, curvature included) at the named south-pole sites; Sun and Earth from
          Astronomy Engine in the IAU 2015 lunar frame, Earth seen from the surface; checked against NASA JPL Horizons.
          {p.validation && ` Agreement with NASA's 18.6-year LOLA sunlight map: r = ${p.validation.mapWide.r.toFixed(3)}, bias ${p.validation.mapWide.biasPp.toFixed(2)} points (n = ${p.validation.mapWide.n}).`}
          {" "}First-order power model (28% cells, 10% losses, battery starts full). A planning aid, not a flight-qualified analysis.
        </p>
        <p className="brief-link">Open this scenario: {p.link}</p>
        <p>SUNLOCK · built for the NASA Space Apps Challenge 2026 · not an official NASA product.</p>
      </footer>
    </section>
  );
}

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
