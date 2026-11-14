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
 * vectors. The pole comes from Astronomy Engine's IAU WGCCRE 2015 model, which
 * includes the periodic terms that carry the Moon's 1.54 deg axial tilt - the
 * full seasonal cycle depends on them. The prime meridian uses the IAU spin
 * polynomial; physical libration (< 0.03 deg) is omitted, well below the 80 m
 * terrain resolution.
 */
export function lunarFrame(date: Date): Frame {
  const ax = A.RotationAxis(A.Body.Moon, date);
  const z = unit(ax.north);
  const n = unit(cross({ x: 0, y: 0, z: 1 }, z));
  const m = cross(z, n);

  const d = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 86400000;
  const W = (38.3213 + 13.17635815 * d) * D;
  const cw = Math.cos(W);
  const sw = Math.sin(W);
  const x = unit({
    x: n.x * cw + m.x * sw,
    y: n.y * cw + m.y * sw,
    z: n.z * cw + m.z * sw,
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
  earth: Vec; // unit vector, lunar body-fixed
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
  const sunF = toFrame(sunRel, f);
  const earthF = toFrame(earthRel, f);
  return {
    t: date.getTime(),
    sun: sunF,
    earth: earthF,
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

export type Reading = {
  sunElev: number;
  sunAz: number;
  sunHorizon: number;
  lit: boolean;
  earthElev: number;
  earthAz: number;
  earthHorizon: number;
  comm: boolean;
};

export function readSite(site: Site, sky: Sky, basis = siteBasis(site.lat, site.lon)): Reading {
  const s = lookAngles(sky.sun, basis);
  const e = lookAngles(sky.earth, basis);
  const sh = horizonAt(site.horizonDeg, s.az);
  const eh = horizonAt(site.horizonDeg, e.az);
  return {
    sunElev: s.elev,
    sunAz: s.az,
    sunHorizon: sh,
    lit: s.elev > sh,
    earthElev: e.elev,
    earthAz: e.az,
    earthHorizon: eh,
    comm: e.elev > eh - EARTH_ANGULAR_RADIUS,
  };
}
