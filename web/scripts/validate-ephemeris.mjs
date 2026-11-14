import * as A from "astronomy-engine";

// ICRF -> lunar body-fixed (IAU 2015 mean Earth/polar axis) via Rz(W) Rx(90-dec) Rz(90+ra)
function rotZ(t) { const c = Math.cos(t), s = Math.sin(t); return [[c, s, 0], [-s, c, 0], [0, 0, 1]]; }
function rotX(t) { const c = Math.cos(t), s = Math.sin(t); return [[1, 0, 0], [0, c, s], [0, -s, c]]; }
function mul(a, b) {
  const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i][j] += a[i][k] * b[k][j];
  return r;
}
const apply = (m, v) => ({
  x: m[0][0] * v.x + m[0][1] * v.y + m[0][2] * v.z,
  y: m[1][0] * v.x + m[1][1] * v.y + m[1][2] * v.z,
  z: m[2][0] * v.x + m[2][1] * v.y + m[2][2] * v.z,
});
const D = Math.PI / 180;

function bodyFrame(date, wsign = 1) {
  const ax = A.RotationAxis(A.Body.Moon, date);
  const R = mul(mul(rotZ(wsign * ax.spin * D), rotX((90 - ax.dec) * D)), rotZ((90 + ax.ra) * D));
  return R;
}
function toBody(unit, m) {
  const b = apply(m, unit);
  const lat = Math.asin(b.z) / D;
  let lon = Math.atan2(b.y, b.x) / D;
  if (lon < 0) lon += 360;
  return { lat, lon };
}
function sub(date, wsign) {
  const m = bodyFrame(date, wsign);
  const sun = A.GeoVector(A.Body.Sun, date, true);
  const moon = A.GeoVector(A.Body.Moon, date, false);
  const s = { x: sun.x - moon.x, y: sun.y - moon.y, z: sun.z - moon.z };
  const e = { x: -moon.x, y: -moon.y, z: -moon.z };
  const n = (v) => { const l = Math.hypot(v.x, v.y, v.z); return { x: v.x / l, y: v.y / l, z: v.z / l }; };
  return { earth: toBody(n(e), m), sun: toBody(n(s), m) };
}

for (const wsign of [1, -1]) {
  console.log(`\n=== W sign ${wsign}`);
  for (let k = 0; k < 8; k++) {
    const d = new Date(Date.UTC(2027, 0, 1 + k * 3.7));
    const r = sub(d, wsign);
    console.log(d.toISOString().slice(0, 10), "sub-Earth", r.earth.lon.toFixed(1), r.earth.lat.toFixed(1),
      "| sub-Sun", r.sun.lon.toFixed(1), r.sun.lat.toFixed(1));
  }
}
