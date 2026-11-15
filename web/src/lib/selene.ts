import * as A from "astronomy-engine";

const D = Math.PI / 180;

export type Vec = { x: number; y: number; z: number };
export type Frame = { x: Vec; y: Vec; z: Vec };

export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec, b: Vec): Vec => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const unit = (v: Vec): Vec => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};

/**
 * Lunar body-fixed frame (mean Earth/polar axis), expressed as three J2000 unit
 * vectors. Both the pole and the prime-meridian angle come from Astronomy
 * Engine's IAU WGCCRE 2015 model, which includes the periodic libration terms.
 *
 * Using only the polynomial for the spin angle drops those terms and puts the
 * prime meridian ~2.2 deg off; with the full model the sub-solar and sub-observer
 * longitudes agree with JPL Horizons to better than 0.001 deg (see
 * scripts/verify-horizons.mjs and BENCHMARKS.md).
 */
export function lunarFrame(date: Date): Frame {
  const ax = A.RotationAxis(A.Body.Moon, date);
  const z = unit(ax.north);
  const n = unit(cross({ x: 0, y: 0, z: 1 }, z));
  const m = cross(z, n);

  const W = ax.spin * D;
  const x = unit({
    x: n.x * Math.cos(W) + m.x * Math.sin(W),
    y: n.y * Math.cos(W) + m.y * Math.sin(W),
    z: n.z * Math.cos(W) + m.z * Math.sin(W),
  });
  return { x, y: cross(z, x), z };
}

/** Convert a J2000 vector into lunar body-fixed coordinates. */
export function toFrame(v: Vec, f: Frame): Vec {
  return { x: dot(v, f.x), y: dot(v, f.y), z: dot(v, f.z) };
}

export function selenographic(v: Vec): { lat: number; lon: number } {
  const u = unit(v);
  const lat = Math.asin(Math.max(-1, Math.min(1, u.z))) / D;
  let lon = Math.atan2(u.y, u.x) / D;
  if (lon < 0) lon += 360;
  return { lat, lon };
}

export type Sky = {
  t: number;
  sun: Vec;   // unit vector, lunar body-fixed
  earth: Vec; // unit vector from the Moon's centre, lunar body-fixed
  /** Earth's distance in lunar radii (~221), for the parallax of an observer on the surface */
  earthDistR: number;
  subSun: { lat: number; lon: number };
  subEarth: { lat: number; lon: number };
};

/** Sun and Earth directions as seen from the Moon, in the lunar body-fixed frame. */
export function skyAt(date: Date): Sky {
  const sun = A.GeoVector(A.Body.Sun, date, true);
  const moon = A.GeoVector(A.Body.Moon, date, false);
  const f = lunarFrame(date);
  const sunRel = unit({ x: sun.x - moon.x, y: sun.y - moon.y, z: sun.z - moon.z });
  const earthRel = unit({ x: -moon.x, y: -moon.y, z: -moon.z });
  const earthDistR = (Math.hypot(moon.x, moon.y, moon.z) * A.KM_PER_AU) / 1737.4;
  const sunF = toFrame(sunRel, f);
  const earthF = toFrame(earthRel, f);
  return {
    t: date.getTime(),
    sun: sunF,
    earth: earthF,
    earthDistR,
    subSun: selenographic(sunF),
    subEarth: selenographic(earthF),
  };
}

export type Site = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  elevationM: number;
  blurb: string;
  horizonDeg: number[];
  /** a past or planned landing (Apollo, CLPS, other agencies), shown for comparison */
  mission?: boolean;
  /** a planned mission whose exact landing point is not published: the target area only */
  approx?: boolean;
  group?: string;
  /** false when the horizon is the edge of the lunar sphere rather than LOLA terrain */
  terrain?: boolean;
  /** Artemis III region code (Wueller et al. 2026) and whether it is on NASA's 2024 list */
  region?: string;
  current?: boolean;
  publishedSite?: string;
  slopeDeg?: number;
  /** 18.6-year statistics computed at build time (web/scripts/select-sites.mjs) */
  longRun?: {
    sunPct: number;
    sunRangePct: [number, number];
    earthPct: number;
    longestNightH: number;
    nasaSunPct: number | null;
    nasaEarthPct: number | null;
    nasaDiffPp: number | null;
    agrees: boolean | null;
    nSites: number;
    nAgree: number;
    longestBlackoutH?: number;
    sunAndEarthPct?: number;
    poleKm?: number;
    /** km to NASA's nearest permanently shadowed pixel, ">30" if none within 30 km, null outside the map */
    psrKm?: number | string | null;
  };
  /** horizons with the panels raised above the ground (0, 2, 10 m) */
  heights?: { heightM: number; sunPct: number; horizonDeg: number[] }[];
  /** a position derived from a named site (its id): skyline = that site's plus the coarse-grid change */
  nearOf?: string;
};

export function siteBasis(lat: number, lon: number) {
  const p = lat * D;
  const l = lon * D;
  return {
    up: { x: Math.cos(p) * Math.cos(l), y: Math.cos(p) * Math.sin(l), z: Math.sin(p) },
    east: { x: -Math.sin(l), y: Math.cos(l), z: 0 },
    north: { x: -Math.sin(p) * Math.cos(l), y: -Math.sin(p) * Math.sin(l), z: Math.cos(p) },
  };
}

export function lookAngles(v: Vec, b: ReturnType<typeof siteBasis>) {
  const elev = Math.asin(Math.max(-1, Math.min(1, dot(v, b.up)))) / D;
  let az = Math.atan2(dot(v, b.east), dot(v, b.north)) / D;
  if (az < 0) az += 360;
  return { elev, az };
}

export function horizonAt(profile: number[], az: number) {
  const a = ((az % 360) + 360) % 360;
  const i = Math.floor(a) % 360;
  const j = (i + 1) % 360;
  const t = a - Math.floor(a);
  return profile[i] * (1 - t) + profile[j] * t;
}

/** Earth's mean angular radius as seen from the Moon, degrees (~0.95). */
export const EARTH_ANGULAR_RADIUS = 0.95;

/**
 * The Sun's mean angular radius, degrees. A site counts as sunlit while any part
 * of the solar disc clears the horizon: the definition NASA's LOLA illumination
 * maps use, and the one SUNLOCK is validated against.
 */
export const SUN_ANGULAR_RADIUS = 0.266;

/**
 * Share of the solar disc (radius 0.266 deg) above a straight skyline, given how far the
 * Sun's centre is above it: 0 below, 0.5 when the centre sits on it, 1 once it has cleared.
 */
export function visibleDiscFraction(centreAboveHorizonDeg: number, radiusDeg = SUN_ANGULAR_RADIUS): number {
  const x = centreAboveHorizonDeg / radiusDeg;
  if (x >= 1) return 1;
  if (x <= -1) return 0;
  return 1 - (Math.acos(x) - x * Math.sqrt(1 - x * x)) / Math.PI;
}

export type Reading = {
  /** share of the solar disc above the skyline, 0..1 (power uses this) */
  sunFrac: number;
  sunElev: number;
  sunAz: number;
  sunHorizon: number;
  lit: boolean;
  earthElev: number;
  earthAz: number;
  earthHorizon: number;
  comm: boolean;
};

/**
 * Direction to Earth from a point on the surface (topocentric). Earth is only ~221 lunar
 * radii away, so seen from the surface it sits up to 0.26 deg lower than seen from the
 * Moon's centre; JPL Horizons applies the same correction.
 */
export function earthFromSurface(sky: Sky, up: Vec): Vec {
  const k = sky.earthDistR;
  return unit({ x: sky.earth.x * k - up.x, y: sky.earth.y * k - up.y, z: sky.earth.z * k - up.z });
}

export function readSite(site: Site, sky: Sky, basis = siteBasis(site.lat, site.lon)): Reading {
  const s = lookAngles(sky.sun, basis);
  const e = lookAngles(earthFromSurface(sky, basis.up), basis);
  const sh = horizonAt(site.horizonDeg, s.az);
  const eh = horizonAt(site.horizonDeg, e.az);
  return {
    sunFrac: visibleDiscFraction(s.elev - sh),
    sunElev: s.elev,
    sunAz: s.az,
    sunHorizon: sh,
    lit: s.elev + SUN_ANGULAR_RADIUS > sh,
    earthElev: e.elev,
    earthAz: e.az,
    earthHorizon: eh,
    comm: e.elev > eh - EARTH_ANGULAR_RADIUS,
  };
}
