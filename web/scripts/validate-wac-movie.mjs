/**
 * Shadow TIMING and mission survival against photographs.
 *
 * Reference: LROC WAC_POLE_MOVIE_SOUTH, one timestamped, map-projected photograph strip of the
 * south pole per orbit (about every 2 hours). Every frame of December 2009 was sampled on a
 * fixed 1 km grid within 24 km of the pole (web/scripts/fetch-wac-movie.mjs; nothing chosen by
 * hand). Each sample says whether that spot was bright or dark at a known minute, so, unlike
 * the long-run averages of H1-H4, it tests WHEN our shadows arrive and leave.
 *
 * Choices fixed before looking at any comparison with our model:
 *   - "bright" in a photo: I/F above the Otsu threshold of all sampled values (computed from the
 *     photographs alone); results are also given at half and double that threshold
 *   - our prediction: the converged LOLA skyline (scripts/lib/horizon.mjs) and the shipped
 *     ephemeris; "lit" = at least half of the solar disc above the skyline (a pixel only reads
 *     bright in a photo with substantial direct light); the "any part of the disc" definition
 *     used for the NASA map comparisons is reported alongside
 *   - a photographed transition = two consecutive bright frames followed or preceded by two
 *     consecutive dark ones, all four within 3 hours of their neighbours (single-frame flicker
 *     is not counted); its time is only known to lie between the two middle frames
 *   - timing error = how far our predicted crossing lies outside that bracket (0 inside it)
 *   - survival: the app's own mission evaluator (default lander, 7 and 14 days) run once on the
 *     photographed bright/dark sequence and once on ours sampled at the same frame times
 *
 * Registration is confirmed without our model: mean photographed brightness against NASA's
 * LOLA sunlight map under the four possible axis orientations.
 *
 * Run: npm run validate:wac-movie  (writes research/validation/result-wac-movie.json and the
 * app's web/public/terrain/wac-movie.json + .bin for the interactive viewer)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { skyAt, siteBasis } from "../.build/selene.js";
import { simulateMission } from "../.build/power.js";
import { loadDem, horizonProfile, horizonAt } from "../../scripts/lib/horizon.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const V = path.join(ROOT, "research/validation");
const D = Math.PI / 180, R = 1737400, SUN_R = 0.266, H = 3600000;

const meta = JSON.parse(fs.readFileSync(path.join(V, "wac-movie-samples.json"), "utf8"));
const sb = fs.readFileSync(path.join(V, "wac-movie-samples.bin"));
const P = meta.grid.points.length, F = meta.frames.length;
const obs = new Float32Array(sb.buffer.slice(sb.byteOffset, sb.byteOffset + F * P * 4));
const tFrame = meta.frames.map((f) => (Date.parse(f.start) + Date.parse(f.stop)) / 2);
const latlon = (x, y) => ({ lat: -(90 - (2 * Math.atan(Math.hypot(x, y) / (2 * R))) / D), lon: ((Math.atan2(x, y) / D) + 360) % 360 });
const pts = meta.grid.points.map(([x, y]) => ({ x, y, ...latlon(x, y) }));

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const pearson = (xs, ys) => { const mx = mean(xs), my = mean(ys); let n = 0, a = 0, b = 0; for (let i = 0; i < xs.length; i++) { n += (xs[i] - mx) * (ys[i] - my); a += (xs[i] - mx) ** 2; b += (ys[i] - my) ** 2; } return n / Math.sqrt(a * b); };
const quant = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

// ---------- threshold from the photographs alone (Otsu on sqrt(I/F), 256 bins) ----------
const vals = [];
for (let i = 0; i < obs.length; i++) if (!Number.isNaN(obs[i])) vals.push(Math.sqrt(Math.max(0, obs[i])));
const vmax = quant(vals, 0.999);
const hist = new Float64Array(256);
for (const v of vals) hist[Math.min(255, Math.floor((v / vmax) * 256))]++;
let best = -1, cut = 0;
{
  const total = vals.length;
  let sumAll = 0; for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let w0 = 0, s0 = 0;
  for (let i = 0; i < 255; i++) {
    w0 += hist[i]; s0 += i * hist[i];
    const w1 = total - w0;
    if (!w0 || !w1) continue;
    const between = w0 * w1 * (s0 / w0 - (sumAll - s0) / w1) ** 2;
    if (between > best) { best = between; cut = i + 1; }
  }
}
const THRESH = ((cut / 256) * vmax) ** 2;
console.log(`${F} frames, ${P} points, ${vals.length} samples in the strips; Otsu threshold I/F = ${THRESH.toFixed(4)}`);

// ---------- registration, independent of SUNLOCK ----------
const lbl = fs.readFileSync(path.join(V, "raw/AVGVISIB_85S_060M_201608.LBL"), "latin1");
const num = (k) => Number(lbl.match(new RegExp(`${k}\\s*=\\s*([-+0-9.]+)`))[1]);
const lola = { n: num("LINES"), scale: num("SCALING_FACTOR"), off: num("LINE_PROJECTION_OFFSET"), pix: num("MAP_SCALE") };
const lb = fs.readFileSync(path.join(V, "raw/AVGVISIB_85S_060M_201608.IMG"));
lola.data = new Int16Array(lb.buffer, lb.byteOffset, lola.n * lola.n);
const lolaAtXY = (x, y) => lola.data[Math.round(lola.off - y / lola.pix) * lola.n + Math.round(lola.off + x / lola.pix)] * lola.scale;
const brightShare = pts.map((_, p) => { let n = 0, b = 0; for (let f = 0; f < F; f++) { const v = obs[f * P + p]; if (!Number.isNaN(v)) { n++; if (v > THRESH) b++; } } return n ? b / n : NaN; });
const registration = {};
for (const [fx, fy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
  const xs = [], ys = [];
  pts.forEach((p, i) => { if (!Number.isNaN(brightShare[i])) { xs.push(brightShare[i]); ys.push(lolaAtXY(fx * p.x, fy * p.y)); } });
  registration[`x${fx > 0 ? "+" : "-"}y${fy > 0 ? "+" : "-"}`] = +pearson(xs, ys).toFixed(3);
}
const regSorted = Object.entries(registration).sort((a, b) => b[1] - a[1]);
if (regSorted[0][0] !== "x+y+" || regSorted[0][1] - regSorted[1][1] < 0.1) throw new Error(`registration unclear: ${JSON.stringify(registration)}`);
console.log("registration (photo bright share vs NASA LOLA sunlight):", registration);

// ---------- our prediction ----------
const dem = loadDem(path.join(ROOT, "data/raw/ldem_80s_80m.img"));
const STEP = 10 * 60000;
const t0 = Math.floor((tFrame[0] - 36 * H) / STEP) * STEP, nT = Math.ceil((tFrame[F - 1] + 36 * H - t0) / STEP);
const sun = new Float64Array(nT * 3);
for (let i = 0; i < nT; i++) { const s = skyAt(new Date(t0 + i * STEP)).sun; sun.set([s.x, s.y, s.z], i * 3); }
const sunFrame = tFrame.map((t) => skyAt(new Date(t)).sun);
/** degrees by which the Sun's CENTRE clears the skyline (negative = below) */
function clearance(prof, b, s) {
  const el = Math.asin(Math.max(-1, Math.min(1, s[0] * b.up.x + s[1] * b.up.y + s[2] * b.up.z))) / D;
  let az = Math.atan2(s[0] * b.east.x + s[1] * b.east.y + s[2] * b.east.z, s[0] * b.north.x + s[1] * b.north.y + s[2] * b.north.z) / D;
  if (az < 0) az += 360;
  return el - horizonAt(prof, az);
}
console.time("skylines and predictions");
const margin = new Float32Array(F * P);       // at frame times
const fine = pts.map(() => null);             // 10-minute series per point
pts.forEach((p, i) => {
  const hz = horizonProfile(dem, p.lat, p.lon, "converged");
  const b = siteBasis(p.lat, p.lon);
  for (let f = 0; f < F; f++) margin[f * P + i] = clearance(hz.prof, b, [sunFrame[f].x, sunFrame[f].y, sunFrame[f].z]);
  const m = new Float32Array(nT);
  for (let k = 0; k < nT; k++) m[k] = clearance(hz.prof, b, [sun[k * 3], sun[k * 3 + 1], sun[k * 3 + 2]]);
  fine[i] = m;
});
console.timeEnd("skylines and predictions");

// ---------- 1. state agreement ----------
function agreement(thresh, off) {
  let tp = 0, tn = 0, fp = 0, fn = 0;
  for (let i = 0; i < F * P; i++) {
    if (Number.isNaN(obs[i])) continue;
    const o = obs[i] > thresh, m = margin[i] > off;
    if (o && m) tp++; else if (!o && !m) tn++; else if (!o && m) fp++; else fn++;
  }
  const n = tp + tn + fp + fn;
  // most samples are dark, so plain agreement flatters any model: also give what "always dark"
  // would score and the overlap of the bright class alone
  return { n, agreePct: +((100 * (tp + tn)) / n).toFixed(2), alwaysDarkWouldAgreePct: +((100 * (tn + fp)) / n).toFixed(2), brightOverlapIoU: +(tp / (tp + fp + fn)).toFixed(3), bothBright: tp, bothDark: tn, weBrightPhotoDark: fp, weDarkPhotoBright: fn };
}
const byClearance = [[-90, -2], [-2, -1], [-1, -0.5], [-0.5, -0.266], [-0.266, 0], [0, 0.266], [0.266, 0.5], [0.5, 1], [1, 2], [2, 90]].map(([lo, hi]) => {
  let n = 0, b = 0;
  for (let i = 0; i < F * P; i++) if (!Number.isNaN(obs[i]) && margin[i] >= lo && margin[i] < hi) { n++; if (obs[i] > THRESH) b++; }
  return { sunCentreAboveSkylineDeg: `${lo} to ${hi}`, n, photoBrightPct: n ? +((100 * b) / n).toFixed(1) : null };
});

// ---------- 2. transition timing ----------
function transitions(off) {
  const errs = [];
  let unmatched = 0;
  for (let p = 0; p < P; p++) {
    const seq = [];
    for (let f = 0; f < F; f++) { const v = obs[f * P + p]; if (!Number.isNaN(v)) seq.push({ t: tFrame[f], lit: v > THRESH }); }
    for (let k = 1; k + 2 < seq.length; k++) {
      const [a, b, c, d] = [seq[k - 1], seq[k], seq[k + 1], seq[k + 2]];
      if (a.lit !== b.lit || c.lit !== d.lit || b.lit === c.lit) continue;
      if (b.t - a.t > 3 * H || c.t - b.t > 3 * H || d.t - c.t > 3 * H) continue;
      const rising = c.lit;
      // our nearest crossing in the same direction within +-24 h of the bracket
      const m = fine[p];
      let bestErr = null;
      const k0 = Math.max(1, Math.floor((b.t - 24 * H - t0) / STEP)), k1 = Math.min(nT - 1, Math.ceil((c.t + 24 * H - t0) / STEP));
      for (let j = k0; j <= k1; j++) {
        const u = m[j - 1] - off, w = m[j] - off;
        if (rising ? !(u <= 0 && w > 0) : !(u > 0 && w <= 0)) continue;
        const tc = t0 + (j - 1 + u / (u - w)) * STEP;
        const e = tc < b.t ? tc - b.t : tc > c.t ? tc - c.t : 0; // negative: ours earlier than the photographs allow
        if (bestErr === null || Math.abs(e) < Math.abs(bestErr)) bestErr = e;
      }
      if (bestErr === null) unmatched++; else errs.push({ e: bestErr / H, rising, bracketH: (c.t - b.t) / H });
    }
  }
  const abs = errs.map((x) => Math.abs(x.e));
  const side = (sub) => sub.length ? { n: sub.length, medianSignedH: +quant(sub.map((x) => x.e), 0.5).toFixed(2), medianAbsH: +quant(sub.map((x) => Math.abs(x.e)), 0.5).toFixed(2) } : { n: 0 };
  return {
    photographed: errs.length + unmatched, matched: errs.length, noCrossingOfOursWithin24h: unmatched,
    medianBracketH: +quant(errs.map((x) => x.bracketH), 0.5).toFixed(2),
    insideBracketPct: +((100 * abs.filter((x) => x === 0).length) / errs.length).toFixed(1),
    within2hPct: +((100 * abs.filter((x) => x <= 2).length) / errs.length).toFixed(1),
    within6hPct: +((100 * abs.filter((x) => x <= 6).length) / errs.length).toFixed(1),
    medianAbsErrorH: +quant(abs, 0.5).toFixed(2), p90AbsErrorH: +quant(abs, 0.9).toFixed(2),
    sunrise: side(errs.filter((x) => x.rising)), sunset: side(errs.filter((x) => !x.rising)),
    signNote: "negative = our crossing is earlier than the photographs allow, positive = later",
  };
}

// ---------- 3. mission survival on photographed vs predicted light ----------
function survival(off) {
  const lander = { loadW: 100, arrayM2: 4, batteryWh: 10000, dod: 0.8, heaterW: 0 };
  const STEP_MIN = 30, stepMs = STEP_MIN * 60000;
  const out = {};
  for (const days of [7, 14]) {
    const steps = days * 48;
    let n = 0, both = 0, neither = 0, weOnly = 0, photoOnly = 0, skipped = 0;
    for (let p = 0; p < P; p++) {
      const seq = [];
      for (let f = 0; f < F; f++) { const v = obs[f * P + p]; if (!Number.isNaN(v)) seq.push({ t: tFrame[f], o: v > THRESH, m: margin[f * P + p] > off }); }
      if (seq.length < 2) continue;
      for (let start = Math.ceil(seq[0].t / (6 * H)) * 6 * H; start + days * 24 * H <= seq[seq.length - 1].t; start += 6 * H) {
        // hold each frame's state until the next frame; skip windows with a gap in the photographs over 6 h
        const A = [], B = [];
        let j = 0, gap = false;
        for (let s = 0; s < steps; s++) {
          const t = start + s * stepMs;
          while (j + 1 < seq.length && seq[j + 1].t <= t) j++;
          if (j + 1 < seq.length && seq[j + 1].t - seq[j].t > 6 * H && t > seq[j].t && t < seq[j + 1].t) { gap = true; break; }
          A.push({ t, lit: seq[j].o, sunElev: 1, sunFrac: seq[j].o ? 1 : 0, comm: true });
          B.push({ t, lit: seq[j].m, sunElev: 1, sunFrac: seq[j].m ? 1 : 0, comm: true });
        }
        if (gap) { skipped++; continue; }
        const a = simulateMission(A, 0, steps, STEP_MIN, "tracking", lander, {}, false).survives;
        const b = simulateMission(B, 0, steps, STEP_MIN, "tracking", lander, {}, false).survives;
        n++;
        if (a && b) both++; else if (!a && !b) neither++; else if (b) weOnly++; else photoOnly++;
      }
    }
    out[`${days}d`] = {
      missions: n, skippedForPhotoGaps: skipped, agreePct: n ? +((100 * (both + neither)) / n).toFixed(1) : null,
      alwaysFailWouldAgreePct: n ? +((100 * (neither + weOnly)) / n).toFixed(1) : null,
      bothSurvive: both, bothFail: neither, weSayNoPhotosSayYes: photoOnly, weSaySurvivesPhotosSayNo: weOnly,
      whenWeSaySurvivesPhotosAgreePct: both + weOnly ? +((100 * both) / (both + weOnly)).toFixed(1) : null,
    };
  }
  return out;
}

const HALF = 0, ANY = -SUN_R;
const result = {
  what: "shadow timing and mission survival against LROC's timestamped photographs of the south pole",
  reference: meta.product,
  frames: { n: F, first: meta.frames[0].start, last: meta.frames[F - 1].start, medianGapH: +quant(tFrame.slice(1).map((t, i) => (t - tFrame[i]) / H), 0.5).toFixed(2) },
  grid: { points: P, stepKm: meta.grid.stepM / 1000, radiusKm: meta.grid.radiusM / 1000 },
  photoBright: { rule: "I/F above the Otsu threshold of all sampled values (from the photographs alone)", thresholdIF: +THRESH.toFixed(5) },
  registration: { what: "r between each point's photographed bright share and NASA's LOLA 18.6-year sunlight, per axis orientation", ...registration },
  stateAgreement: {
    halfDisc: agreement(THRESH, HALF),
    anyPartOfDisc: agreement(THRESH, ANY),
    halfDiscAtHalfThreshold: agreement(THRESH / 2, HALF),
    halfDiscAtDoubleThreshold: agreement(THRESH * 2, HALF),
  },
  photoBrightBySunClearance: byClearance,
  timing: { halfDisc: transitions(HALF), anyPartOfDisc: transitions(ANY) },
  survival: { what: "default lander (100 W, 4 m2 Sun-facing panels, 10 kWh), landing every 6 h, light held between frames", halfDisc: survival(HALF), anyPartOfDisc: survival(ANY) },
  limits: [
    "One month (December 2009), within 24 km of the pole: southern summer, when the Sun is highest there.",
    "A photo pixel is 100 m and reads dark on a slope facing away from a grazing Sun even when the Sun is above the skyline; our prediction is skyline-only.",
    "Frames are about 2 hours apart, so a transition is only known to within that bracket.",
    "The month has no 14-day run of photographs without a gap over 6 hours (the longest is 12.9 days, 17-30 December), so only 7-day stays could be tested; 14-day survival is untested here.",
    "Survival compares two light sequences through the same power model; it tests the shadow timing that feeds the model, not the power model itself.",
  ],
};
fs.writeFileSync(path.join(V, "result-wac-movie.json"), JSON.stringify(result, null, 1) + "\n");

// ---------- compact data for the app's photo-vs-model viewer ----------
// per frame and point: 0 = outside the strip, 1 = photo dark, 2 = photo bright; +4 if we predict lit (half disc)
const side = Math.round((2 * meta.grid.radiusM) / meta.grid.stepM) + 1;
const cells = new Uint8Array(F * side * side).fill(255);
pts.forEach((p, i) => {
  const cx = Math.round((p.x + meta.grid.radiusM) / meta.grid.stepM), cy = Math.round((meta.grid.radiusM - p.y) / meta.grid.stepM);
  for (let f = 0; f < F; f++) {
    const v = obs[f * P + i];
    cells[f * side * side + cy * side + cx] = (Number.isNaN(v) ? 0 : v > THRESH ? 2 : 1) + (margin[f * P + i] > HALF ? 4 : 0);
  }
});
fs.writeFileSync(path.join(ROOT, "web/public/terrain/wac-movie.bin"), cells);
fs.writeFileSync(path.join(ROOT, "web/public/terrain/wac-movie.json"), JSON.stringify({
  side, stepKm: meta.grid.stepM / 1000, frames: meta.frames.map((f, i) => ({ t: new Date(tFrame[i]).toISOString().slice(0, 16) + "Z", name: f.name })),
  encoding: "uint8 per cell, row 0 = toward 0 E: 255 outside the 24 km circle; low bits 0 outside the photo strip, 1 photo dark, 2 photo bright; +4 when SUNLOCK predicts sunlight (half the disc above the skyline)",
  summary: { alwaysDarkWouldAgreePct: result.stateAgreement.halfDisc.alwaysDarkWouldAgreePct, photographedTransitions: result.timing.halfDisc.photographed, whenWeSaySurvivesPhotosAgreePct: result.survival.halfDisc["7d"].whenWeSaySurvivesPhotosAgreePct, agreePct: result.stateAgreement.halfDisc.agreePct, n: result.stateAgreement.halfDisc.n, medianAbsErrorH: result.timing.halfDisc.medianAbsErrorH, transitions: result.timing.halfDisc.matched, within2hPct: result.timing.halfDisc.within2hPct, survival7dAgreePct: result.survival.halfDisc["7d"].agreePct, survival7dMissions: result.survival.halfDisc["7d"].missions },
}) + "\n");
const { photoBrightBySunClearance, ...rest } = result;
console.log(JSON.stringify(rest, null, 1));
console.table(photoBrightBySunClearance);
