import * as A from "astronomy-engine";

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => A.Vector.from(
  a.y * b.z - a.z * b.y,
  a.z * b.x - a.x * b.z,
  a.x * b.y - a.y * b.x,
  0, A.Vector.from
);

function selFrame(date, sign = 1) {
  const ax = A.RotationAxis(A.Body.Moon, date);
  const z = ax.north;
  const alpha = (ax.ra * Math.PI) / 180;
  const Q = A.Vector.from(-Math.sin(alpha), Math.cos(alpha), 0, 0, A.Vector.from);
  const P = A.Vector.from(
    z.y * Q.z - z.z * Q.y,
    z.z * Q.x - z.x * Q.z,
    z.x * Q.y - z.y * Q.x, 0, A.Vector.from
  );
  const W = (ax.spin * Math.PI) / 180;
  const x = A.Vector.from(
    Q.x * Math.cos(W) + sign * P.x * Math.sin(W),
    Q.y * Math.cos(W) + sign * P.y * Math.sin(W),
    Q.z * Math.cos(W) + sign * P.z * Math.sin(W), 0, A.Vector.from
  );
  const y = A.Vector.from(
    z.y * x.z - z.z * x.y,
    z.z * x.x - z.x * x.z,
    z.x * x.y - z.y * x.x, 0, A.Vector.from
  );
  return { x, y, z };
}

function toBody(v, f) {
  const l = Math.hypot(v.x, v.y, v.z);
  const u = { x: v.x / l, y: v.y / l, z: v.z / l };
  const bx = dot(u, f.x), by = dot(u, f.y), bz = dot(u, f.z);
  const lat = (Math.asin(bz) * 180) / Math.PI;
  let lon = (Math.atan2(by, bx) * 180) / Math.PI;
  if (lon < 0) lon += 360;
  return { lat, lon };
}

function subPoints(date, sign) {
  const f = selFrame(date, sign);
  const sun = A.GeoVector(A.Body.Sun, date, true);
  const moon = A.GeoVector(A.Body.Moon, date, false);
  const sunRel = A.Vector.from(sun.x - moon.x, sun.y - moon.y, sun.z - moon.z, 0, A.Vector.from);
  const earthRel = A.Vector.from(-moon.x, -moon.y, -moon.z, 0, A.Vector.from);
  return { subEarth: toBody(earthRel, f), subSun: toBody(sunRel, f) };
}

for (const sign of [1, -1]) {
  console.log(`\n=== spin sign ${sign}`);
  for (const iso of ["2027-01-01T00:00:00Z", "2027-01-08T00:00:00Z", "2027-01-15T00:00:00Z", "2027-01-22T00:00:00Z"]) {
    const d = new Date(iso);
    const { subEarth, subSun } = subPoints(d, sign);
    console.log(iso, "Earth lon", subEarth.lon.toFixed(1), "lat", subEarth.lat.toFixed(1),
      "| Sun lon", subSun.lon.toFixed(1), "lat", subSun.lat.toFixed(1));
  }
}
