type Props = {
  horizon: number[]; // 360 horizon elevations, degrees, az 0 = north
  sun: { az: number; elev: number };
  earth: { az: number; elev: number };
  track: { az: number; elev: number }[];
  sunLit: boolean;
  earthComm: boolean;
};

const H = 104;
const W = 360;

/** Scale to the sky that actually exists at this site: the Sun never climbs far. */
function scaleFor(horizon: number[], highest: number) {
  const maxHorizon = Math.max(...horizon);
  // near the pole the scale stays low so the hills read; elsewhere the Sun climbs high
  const max = Math.min(90, Math.max(6, Math.ceil(maxHorizon + 1), Math.ceil(highest + 2)));
  const min = -3;
  return { min, max };
}

const xOf = (az: number) => ((az % 360) + 360) % 360;

/**
 * Panorama of the sky above the selected site: azimuth along the axis, elevation
 * up the axis, with the real terrain horizon drawn as ground. The Sun and Earth
 * are plotted where they actually are, so occlusion is visible rather than implied.
 */
export default function SkyView({ horizon, sun, earth, track, sunLit, earthComm }: Props) {
  const highest = Math.max(sun.elev, earth.elev, ...track.map((p) => p.elev));
  const { min: elevMin, max: elevMax } = scaleFor(horizon, highest);
  const yOf = (elev: number) => H - ((Math.min(elevMax, Math.max(elevMin, elev)) - elevMin) / (elevMax - elevMin)) * H;

  const ground =
    horizon.map((e, i) => `${i === 0 ? "M" : "L"}${i},${yOf(e).toFixed(1)}`).join(" ") +
    ` L${W},${yOf(horizon[0]).toFixed(1)} L${W},${H} L0,${H} Z`;

  // Split into segments where the azimuth wraps, otherwise the polyline smears across the sky.
  const segments: string[] = [];
  let current = "";
  let prevAz = null as number | null;
  for (const p of track) {
    const az = ((p.az % 360) + 360) % 360;
    const jump = prevAz !== null && Math.abs(az - prevAz) > 180;
    if (current === "" || jump) {
      if (current) segments.push(current);
      current = `M${az.toFixed(1)},${yOf(p.elev).toFixed(1)}`;
    } else {
      current += ` L${az.toFixed(1)},${yOf(p.elev).toFixed(1)}`;
    }
    prevAz = az;
  }
  if (current) segments.push(current);
  const path = segments.join(" ");

  const sx = xOf(sun.az);
  const sy = yOf(sun.elev);
  const ex = xOf(earth.az);
  const ey = yOf(earth.elev);

  return (
    <div className="skyview">
      <div className="sky-head">
        <span className="sky-title">Looking around from the site</span>
        <span className="sky-legend">
          <span className="chip chip-sun" /> Sun {sun.elev >= 0 ? "+" : ""}{sun.elev.toFixed(1)}°
          <span className="chip chip-earth" /> Earth {earth.elev >= 0 ? "+" : ""}{earth.elev.toFixed(1)}°
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="sky-svg" role="img"
           aria-label="Azimuth-elevation panorama showing the terrain horizon with the Sun and Earth">
        <defs>
          <linearGradient id="skygrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0a1220" />
            <stop offset="100%" stopColor="#020304" />
          </linearGradient>
        </defs>

        <rect x="0" y="0" width={W} height={H} fill="url(#skygrad)" />

        {/* elevation guides */}
        {(elevMax > 20 ? [0, 10, 20, 30, 45, 60, 75, 90] : [0, 1, 2, 3, 4, 6, 8, 10, 12, 15]).filter((e) => e <= elevMax).map((e) => (
          <g key={e}>
            <line x1="0" x2={W} y1={yOf(e)} y2={yOf(e)} className={e === 0 ? "sky-zero" : "sky-guide"} />
            <text x="2" y={yOf(e) - 2} className="sky-tick">{e}°</text>
          </g>
        ))}

        {/* compass ticks */}
        {[["N", 0], ["E", 90], ["S", 180], ["W", 270]].map(([lab, az]) => (
          <text key={lab as string} x={Number(az) + 2} y={H - 3} className="sky-compass">{lab}</text>
        ))}

        {/* the Sun's track over the surrounding months */}
        <path d={path} className="sky-track" />

        {/* Earth */}
        <g opacity={earthComm ? 1 : 0.35}>
          <circle cx={ex} cy={ey} r="3.4" className="sky-earth" />
          <circle cx={ex} cy={ey} r="6" className="sky-earth-ring" />
          <text x={Math.min(W - 34, Math.max(2, ex + 7))} y={Math.max(9, ey - 5)} className="sky-earth-label">
            Earth
          </text>
        </g>

        {/* Sun */}
        <g opacity={sunLit ? 1 : 0.4}>
          <circle cx={sx} cy={sy} r="7" className="sky-sun-glow" />
          <circle cx={sx} cy={sy} r="3.2" className="sky-sun" />
          <text x={Math.min(W - 26, Math.max(2, sx + 6))} y={Math.max(9, sy - 6)} className="sky-sun-label">Sun</text>
        </g>

        {/* terrain drawn last so the ground reads in front of the sky */}
        <path d={ground} className="sky-ground" />
      </svg>

      <div className="sky-foot">
        {sunLit ? "The Sun is up" : "The Sun is below the horizon or behind hills"} ·{" "}
        {earthComm ? "Earth is in view" : "Earth is hidden"}
        <span className="sky-scale">{elevMax <= 20 ? "height exaggerated, " : ""}{elevMin}° to +{elevMax}°</span>
      </div>
    </div>
  );
}
