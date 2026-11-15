import { arrayPowerPerM2, type ArrayMode, type LanderSpec, type MissionRequirements, type MissionResult, type StressCase } from "./power";
import type { Site } from "./selene";

/** One row per 30-minute step of the mission, for anyone who wants to check our numbers. */
export function missionCsv(o: {
  site: Site; samples: { t: number; lit: boolean; comm: boolean; sunElev: number; sunAz?: number; sunFrac?: number; earthElev: number }[];
  startIdx: number; steps: number; soc: Float32Array; mode: ArrayMode; spec: LanderSpec; heightM: number;
  result: MissionResult; req: MissionRequirements; stress: StressCase[];
}) {
  const { site, spec, result: r, req } = o;
  const iso = (ms: number | null) => (ms === null ? "" : new Date(ms).toISOString());
  const verdict = r.survives
    ? "survives"
    : r.failure === "earth"
      ? `fails: Earth hidden longer than ${req.maxEarthOutageH} h,from ${iso(r.earthFailAt)}`
      : r.failure === "battery"
        ? `fails: battery reaches ${req.reservePct ? `the ${req.reservePct}% reserve` : "zero"},at ${iso(r.lostAt)}`
        : "unknown: the mission runs past the modelled data";
  const caseCell = (c: StressCase) =>
    !c.result ? "unknown" : c.result.survives ? `pass min ${c.result.minSocPct.toFixed(0)}%` : c.result.failure === "earth" ? `fail Earth ${iso(c.result.earthFailAt)}` : `fail battery ${iso(c.result.lostAt)}`;
  const head = [
    `# SUNLOCK mission export`,
    `# site,${site.name.replace(/,/g, " ")},lat ${site.lat},lon ${site.lon}${site.publishedSite ? `,published site ${site.publishedSite}` : ""}`,
    `# lander,load ${spec.loadW} W,panels ${spec.arrayM2} m2 (${{ tracking: "face Sun", vertical: "upright on four sides", horizontal: "flat" }[o.mode]}),heaters in the dark ${spec.heaterW ?? 0} W,battery ${spec.batteryWh / 1000} kWh,depth of discharge ${spec.dod},panel height ${o.heightM} m`,
    `# requirements,battery charge at landing ${req.initialSocPct ?? 100}%,reserve to keep ${req.reservePct ?? 0}%,longest time without Earth in view ${req.maxEarthOutageH != null ? `${req.maxEarthOutageH} h` : "no limit"}`,
    `# result,${verdict}`,
    `# result detail,lowest charge ${r.minSocPct.toFixed(1)}% of usable,longest Earth outage ${r.longestEarthOutageH.toFixed(1)} h`,
    `# stress cases,${o.stress.filter((c) => c.result?.survives).length} of ${o.stress.length} pass${o.stress.some((c) => !c.result) ? ` (${o.stress.filter((c) => !c.result).length} unknown)` : ""}`,
    ...o.stress.map((c) => `# stress,${c.label.replace(/,/g, " ")},${caseCell(c)}`),
    `# horizon,${
      site.terrain === false
        ? "edge of the lunar sphere (no terrain data outside 80-90 S)"
        : site.nearOf
          ? "nearby position: its own LOLA LDEM_80S_80M skyline, 360 azimuths, 150 km reach, curvature included (ground level)"
          : site.id === "custom"
          ? "LOLA terrain on a ~600 m grid, 150 km reach (preliminary)"
          : "LOLA LDEM_80S_80M terrain, 360 azimuths, 150 km reach, curvature included"
    }`,
    `# model,Sun and Earth from Astronomy Engine in the IAU 2015 lunar frame (Earth seen from the surface); sunlit = any part of the solar disc above the skyline; panel power uses the visible share of the disc; heaters run while less than half the disc is up; first-order energy model, not a flight analysis`,
    `# timestamps,start of each 30-minute step; battery_pct is at the end of the step`,
    `# battery trace,the failure step records charge at the failure time; later unevaluated charge cells are blank`,
    `time_utc,sun_elev_deg,sunlit,sun_visible_fraction,earth_elev_deg,earth_in_view,panel_power_w,battery_pct_of_usable`,
  ];
  const rows: string[] = [];
  const end = Math.min(o.samples.length, o.startIdx + o.steps);
  for (let i = o.startIdx; i < end; i++) {
    const s = o.samples[i];
    const p = arrayPowerPerM2(s.sunElev, s.sunFrac ?? s.lit, o.mode, s.sunAz) * spec.arrayM2;
    rows.push([
      new Date(s.t).toISOString().slice(0, 16) + "Z",
      s.sunElev.toFixed(3), s.lit ? 1 : 0, (s.sunFrac ?? (s.lit ? 1 : 0)).toFixed(3), s.earthElev.toFixed(3), s.comm ? 1 : 0,
      p.toFixed(1), Number.isFinite(o.soc[i - o.startIdx]) ? o.soc[i - o.startIdx].toFixed(1) : "",
    ].join(","));
  }
  return [...head, ...rows].join("\n") + "\n";
}

