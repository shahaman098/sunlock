import { skyAt, readSite, type Site, type Sky } from "./selene";

export type Sample = {
  t: number;
  lit: boolean;
  comm: boolean;
  sunElev: number;
  earthElev: number;
  power: number; // relative solar array output, 0..1
};

export function buildSkies(start: Date, days: number, stepMin: number): Sky[] {
  const stepMs = stepMin * 60000;
  const n = Math.floor((days * 86400000) / stepMs) + 1;
  const out: Sky[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = skyAt(new Date(start.getTime() + i * stepMs));
  return out;
}

export function siteSeries(site: Site, skies: Sky[]): Sample[] {
  return skies.map((sky) => {
    const r = readSite(site, sky);
    return {
      t: sky.t,
      lit: r.lit,
      comm: r.comm,
      sunElev: r.sunElev,
      earthElev: r.earthElev,
      power: r.lit ? Math.max(0, Math.sin((r.sunElev * Math.PI) / 180)) : 0,
    };
  });
}

export type SiteStats = {
  illumPct: number;
  commPct: number;
  longestDarkH: number;
  longestLightH: number;
  darkestStart: number | null;
  firstLight: number | null;   // next sunrise after t0
  meanPower: number;
  score: number;
};

export function statsFor(samples: Sample[], stepMin: number): SiteStats {
  const stepH = stepMin / 60;
  let lit = 0, comm = 0, power = 0;
  let run = 0, runLit = samples[0]?.lit ?? false;
  let longestDark = 0, longestDarkStart: number | null = null;
  let longestLight = 0;
  let curStart = samples[0]?.t ?? 0;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.lit) lit++;
    if (s.comm) comm++;
    power += s.power;

    if (s.lit === runLit) {
      run++;
    } else {
      if (!runLit && run * stepH > longestDark) {
        longestDark = run * stepH;
        longestDarkStart = curStart;
      }
      if (runLit && run * stepH > longestLight) longestLight = run * stepH;
      runLit = s.lit;
      run = 1;
      curStart = s.t;
    }
  }
  if (!runLit && run * stepH > longestDark) {
    longestDark = run * stepH;
    longestDarkStart = curStart;
  }
  if (runLit && run * stepH > longestLight) longestLight = run * stepH;

  const n = Math.max(1, samples.length);
  const illumPct = (lit / n) * 100;
  const commPct = (comm / n) * 100;
  const meanPower = power / n;

  return {
    illumPct,
    commPct,
    longestDarkH: longestDark,
    longestLightH: longestLight,
    darkestStart: longestDarkStart,
    firstLight: nextLight(samples),
    meanPower,
    score: scoreOf(illumPct, commPct, longestDark, meanPower),
  };
}

function nextLight(samples: Sample[]): number | null {
  for (const s of samples) if (s.lit) return s.t;
  return null;
}

/** Mission-readiness score: sunlight dominates, comm is a gate, long darkness is penalised. */
export function scoreOf(illumPct: number, commPct: number, longestDarkH: number, meanPower: number) {
  const darkPenalty = Math.min(1, longestDarkH / (24 * 7));
  return Math.round(
    (0.45 * illumPct + 0.2 * commPct + 0.25 * meanPower * 100) * (1 - 0.35 * darkPenalty)
  );
}

export type Window = {
  start: number;
  illumPct: number;
  commPct: number;
  score: number;
};

/** Rolling search for the best contiguous mission window of the requested length. */
export function findWindows(
  site: Site,
  skies: Sky[],
  stepMin: number,
  windowDays: number,
  limit = 4
): Window[] {
  const stepMs = stepMin * 60000;
  const span = Math.round((windowDays * 86400000) / stepMs);
  if (span >= skies.length) return [];
  const samples = siteSeries(site, skies);

  // Precompute lit/comm counts with a sliding window so long searches stay cheap.
  const stride = Math.max(1, Math.round(6 * 60 / stepMin));
  const raw: Window[] = [];
  const prefixLit = new Float64Array(samples.length + 1);
  const prefixComm = new Float64Array(samples.length + 1);
  for (let i = 0; i < samples.length; i++) {
    prefixLit[i + 1] = prefixLit[i] + (samples[i].lit ? 1 : 0);
    prefixComm[i + 1] = prefixComm[i] + (samples[i].comm ? 1 : 0);
  }

  for (let i = 0; i + span < samples.length; i += stride) {
    const illumPct = ((prefixLit[i + span] - prefixLit[i]) / span) * 100;
    const commPct = ((prefixComm[i + span] - prefixComm[i]) / span) * 100;
    raw.push({
      start: samples[i].t,
      illumPct,
      commPct,
      score: scoreOf(illumPct, commPct, scoreDark(samples, i, i + span) * (stepMin / 60), 0.6),
    });
  }

  // Greedy pick: highest score first, but never return overlapping windows.
  raw.sort((a, b) => b.score - a.score || b.illumPct - a.illumPct);
  const windowMs = windowDays * 86400000;
  const picked: Window[] = [];
  for (const w of raw) {
    if (picked.some((p) => Math.abs(p.start - w.start) < windowMs)) continue;
    picked.push(w);
    if (picked.length >= limit) break;
  }
  return picked.sort((a, b) => a.start - b.start);
}

function scoreDark(samples: Sample[], from: number, to: number) {
  let run = 0, best = 0;
  for (let i = from; i < to; i++) {
    if (!samples[i].lit) { run++; best = Math.max(best, run); } else run = 0;
  }
  return best;
}
