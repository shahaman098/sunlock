/**
 * SUNLOCK data pipeline: rebuild every derived file from the NASA inputs, in dependency order,
 * and record what was built from what.
 *
 *   npm run data              run every stage whose inputs or code changed since the manifest
 *   npm run data -- --force   run every stage
 *   npm run data -- --only sites,nearby    run just these (and nothing downstream)
 *   npm run data -- --check   change nothing: exit 1 if any stage is stale or any file differs
 *
 * Each stage lists its code (the script and the shared modules it imports), its inputs (NASA
 * files from data/sources.json or other stages' outputs) and its outputs. A stage reruns when
 * the SHA-256 of any of those inputs differs from the manifest, or an output is missing or was
 * edited by hand. Inputs from data/sources.json are verified against the catalog before
 * anything runs. The manifest (web/public/terrain/manifest.json, shipped with the app) records,
 * for every output, its SHA-256, the stage that produced it and the hashes of everything that
 * went into it, plus the commit of the code.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(WEB, "..");
const MANIFEST = "web/public/terrain/manifest.json";
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : null; };
const FORCE = process.argv.includes("--force"), CHECK = process.argv.includes("--check");
const ONLY = arg("only")?.split(",") ?? null;

const T = "web/public/terrain/", V = "research/validation/";
const HZ = "scripts/lib/horizon.mjs";
const LIB = (...n) => n.map((x) => `web/src/lib/${x}.ts`);
const src = (id) => `@${id}`; // an input from data/sources.json

/** Stages in dependency order. */
const STAGES = [
  {
    id: "terrain", cmd: ["node", "scripts/build-terrain.mjs"], cwd: ROOT,
    code: ["scripts/build-terrain.mjs"],
    inputs: [src("ldem_80s_80m")],
    outputs: [T + "hillshade.jpg", T + "shadowgrid.bin", T + "elevgrid.bin"],
  },
  {
    id: "validate-lola", cmd: ["node", "scripts/validate-lola.mjs", "--points", "2000", "--step", "1", "--convention", "converged"],
    code: ["web/scripts/validate-lola.mjs", ...LIB("selene")],
    inputs: [src("ldem_80s_80m"), src("avgvisib_85s"), src("avgvisib_85s_lbl"), src("avgvisib_85s_earth"), src("avgvisib_85s_earth_lbl"), src("lpsr_85s"), src("lpsr_85s_lbl")],
    outputs: [V + "result-converged.json", V + "pairs-converged.csv", V + "scatter-converged.svg"],
  },
  {
    id: "validate-wac", cmd: ["node", "scripts/validate-wac.mjs"],
    code: ["web/scripts/validate-wac.mjs", HZ, ...LIB("selene")],
    inputs: [src("ldem_80s_80m"), src("wac_twi_south"), src("wac_twi_south_xml"), src("avgvisib_85s"), src("avgvisib_85s_lbl")],
    outputs: [V + "result-wac.json", V + "pairs-wac.csv"],
    // also reads the named sites' coordinates from sites.json (written later, by `sites`) for a
    // per-site note; left out of the fingerprint so the two stages cannot trigger each other
  },
  {
    // the photograph samples are committed (web/scripts/fetch-wac-movie.mjs makes them from 2.7 GB of
    // LROC frames), so this stage runs offline like the others
    id: "validate-wac-movie", cmd: ["node", "scripts/validate-wac-movie.mjs"],
    code: ["web/scripts/validate-wac-movie.mjs", HZ, ...LIB("selene", "power")],
    inputs: [src("ldem_80s_80m"), src("avgvisib_85s"), src("avgvisib_85s_lbl"), V + "wac-movie-samples.json", V + "wac-movie-samples.bin"],
    outputs: [V + "result-wac-movie.json", T + "wac-movie.json", T + "wac-movie.bin"],
  },
  {
    id: "sites", cmd: ["node", "scripts/select-sites.mjs"],
    code: ["web/scripts/select-sites.mjs", HZ, ...LIB("selene")],
    inputs: [src("ldem_80s_80m"), src("avgvisib_85s"), src("avgvisib_85s_lbl"), src("avgvisib_85s_earth"), src("avgvisib_85s_earth_lbl"), src("lpsr_85s"), src("lpsr_85s_lbl"), src("wueller2026_sites"), V + "result-converged.json", V + "result-wac.json"],
    outputs: [T + "sites.json", T + "regions.json", T + "validation.json"],
  },
  {
    id: "nearby", cmd: ["node", "scripts/build-nearby.mjs"],
    code: ["web/scripts/build-nearby.mjs", HZ, ...LIB("selene", "terrain")],
    inputs: [src("ldem_80s_80m"), T + "sites.json"],
    outputs: [T + "nearby.json"],
  },
  {
    id: "finder", cmd: ["node", "scripts/build-finder.mjs"],
    code: ["web/scripts/build-finder.mjs", HZ],
    inputs: [src("ldem_80s_80m"), src("avgvisib_85s"), src("avgvisib_85s_lbl"), src("avgvisib_85s_earth"), src("avgvisib_85s_earth_lbl"), src("lpsr_85s"), src("lpsr_85s_lbl")],
    outputs: [T + "finder.bin", T + "finder.json"],
  },
  {
    id: "missions", cmd: ["node", "scripts/build-missions.mjs"],
    code: ["web/scripts/build-missions.mjs", HZ],
    inputs: [src("ldem_80s_80m")],
    outputs: [T + "missions.json"],
  },
  {
    id: "validate-nearby", cmd: ["node", "scripts/validate-nearby.mjs"],
    code: ["web/scripts/validate-nearby.mjs", HZ, ...LIB("selene", "analysis", "power", "terrain")],
    inputs: [src("ldem_80s_80m"), src("avgvisib_85s"), src("avgvisib_85s_lbl"), T + "sites.json", T + "regions.json", T + "elevgrid.bin", T + "nearby.json"],
    outputs: [V + "nearby.json"],
  },
];

// ---------- hashing ----------
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "data/sources.json"), "utf8"));
const byId = Object.fromEntries(catalog.files.map((f) => [f.id, f]));
const hashCache = new Map();
function sha(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  const st = fs.statSync(abs);
  const key = `${rel}:${st.size}:${st.mtimeMs}`;
  if (!hashCache.has(key)) hashCache.set(key, crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex"));
  return hashCache.get(key);
}
const resolve = (x) => (x.startsWith("@") ? byId[x.slice(1)].path : x);

// ---------- NASA inputs must match the catalog ----------
const needed = new Set(STAGES.flatMap((s) => s.inputs.filter((x) => x.startsWith("@")).map((x) => x.slice(1))));
let bad = 0;
for (const id of needed) {
  const f = byId[id];
  if (!f) throw new Error(`stage input @${id} is not in data/sources.json`);
  const h = sha(f.path);
  if (h !== f.sha256) { console.error(`input ${f.path}: ${h ? "differs from data/sources.json" : "missing"}`); bad++; }
}
if (bad) { console.error("run `node scripts/fetch-data.mjs` first"); process.exit(1); }

// ---------- what is stale ----------
const prev = fs.existsSync(path.join(ROOT, MANIFEST)) ? JSON.parse(fs.readFileSync(path.join(ROOT, MANIFEST), "utf8")) : { stages: {}, outputs: {} };
const fingerprint = (s) => {
  const parts = [...s.code, ...s.inputs.map(resolve)].map((p) => `${p}=${sha(p)}`);
  parts.push(`cmd=${s.cmd.join(" ")}`);
  return { inputs: Object.fromEntries([...s.code, ...s.inputs.map(resolve)].map((p) => [p, sha(p)])), key: crypto.createHash("sha256").update(parts.join("\n")).digest("hex") };
};
function why(s) {
  const p = prev.stages[s.id];
  if (!p) return "never recorded";
  const f = fingerprint(s);
  if (p.key !== f.key) {
    const changed = Object.keys(f.inputs).filter((k) => p.inputs?.[k] !== f.inputs[k]);
    return `changed: ${changed.join(", ") || "command"}`;
  }
  const off = s.outputs.filter((o) => sha(o) !== prev.outputs[o]?.sha256);
  return off.length ? `output differs from manifest: ${off.join(", ")}` : null;
}

if (CHECK) {
  let stale = 0;
  for (const s of STAGES) { const w = why(s); console.log(`${s.id.padEnd(16)} ${w ? `STALE (${w})` : "up to date"}`); if (w) stale++; }
  process.exit(stale ? 1 : 0);
}

// ---------- build ----------
console.log("compiling shared modules (web/src/lib -> web/.build)");
execFileSync("npx", ["tsc", "--ignoreConfig", ...["selene", "power", "analysis", "terrain", "export"].map((n) => `src/lib/${n}.ts`),
  "--outDir", ".build", "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck", "--types", "vite/client"], { cwd: WEB, stdio: "inherit" });
for (const f of fs.readdirSync(path.join(WEB, ".build")).filter((f) => f.endsWith(".js"))) {
  const p = path.join(WEB, ".build", f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/from "\.\/([a-z]+)"/g, 'from "./$1.js"'));
}

const manifest = { stages: { ...prev.stages }, outputs: { ...prev.outputs } };
const dirty = new Set();
for (const s of STAGES) {
  const reason = FORCE ? "forced" : why(s);
  const upstream = s.inputs.some((i) => dirty.has(i));
  const selected = ONLY ? ONLY.includes(s.id) : FORCE || reason || upstream;
  if (!selected) { console.log(`- ${s.id}: up to date`); continue; }
  console.log(`\n> ${s.id}: ${reason ?? "upstream changed"}\n  ${s.cmd.join(" ")}`);
  const t0 = Date.now();
  const r = spawnSync(s.cmd[0], s.cmd.slice(1), { cwd: s.cwd ?? WEB, stdio: "inherit" });
  if (r.status !== 0) { console.error(`stage ${s.id} failed (exit ${r.status}); manifest not updated for it`); process.exit(1); }
  hashCache.clear();
  const f = fingerprint(s);
  manifest.stages[s.id] = { command: s.cmd.join(" "), ranAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), key: f.key, inputs: f.inputs, outputs: s.outputs };
  for (const o of s.outputs) {
    const h = sha(o);
    if (!h) { console.error(`stage ${s.id} did not write ${o}`); process.exit(1); }
    if (prev.outputs[o]?.sha256 !== h) dirty.add(o);
    manifest.outputs[o] = { sha256: h, bytes: fs.statSync(path.join(ROOT, o)).size, stage: s.id };
  }
}

const git = (...a) => { try { return execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return null; } };
const out = {
  about: "What every shipped SUNLOCK data file was built from. Written by web/scripts/pipeline.mjs (npm run data); NASA inputs are listed with their official URLs in data/sources.json.",
  commit: git("rev-parse", "--short", "HEAD"),
  uncommittedChanges: (git("status", "--porcelain") ?? "").length > 0,
  sources: Object.fromEntries([...needed].map((id) => [id, { path: byId[id].path, url: byId[id].url, bytes: byId[id].bytes, sha256: byId[id].sha256, product: byId[id].product }])),
  stages: Object.fromEntries(STAGES.filter((s) => manifest.stages[s.id]).map((s) => [s.id, manifest.stages[s.id]])),
  outputs: manifest.outputs,
};
fs.writeFileSync(path.join(ROOT, MANIFEST), JSON.stringify(out, null, 1) + "\n");
console.log(`\nwrote ${MANIFEST}${dirty.size ? `; changed outputs: ${[...dirty].join(", ")}` : "; no output changed"}`);
