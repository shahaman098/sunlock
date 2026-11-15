/**
 * Download the NASA inputs listed in data/sources.json and verify each one.
 *
 *   node scripts/fetch-data.mjs           required files: download what is missing, verify all
 *   node scripts/fetch-data.mjs --all     also the optional DEMs used only by benchmarks (~580 MB)
 *   node scripts/fetch-data.mjs --check   verify only, download nothing (exit 1 if anything is wrong)
 *
 * A file is accepted only if its size and SHA-256 match the catalog. A download goes to
 * `<path>.part` first and replaces nothing until it verifies. A local file that differs from the
 * catalog is reported and left alone (never overwritten); move it aside to fetch a fresh copy.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "data/sources.json"), "utf8"));
const ALL = process.argv.includes("--all"), CHECK = process.argv.includes("--check");

async function sha256(file) {
  const h = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(file), h);
  return h.digest("hex");
}
const mb = (b) => `${(b / 1e6).toFixed(1)} MB`;

async function download(f, dest) {
  const res = await fetch(f.url, { redirect: "follow", headers: { "user-agent": "sunlock-fetch-data" } });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const part = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(part));
  const size = fs.statSync(part).size, hash = await sha256(part);
  if (size !== f.bytes || hash !== f.sha256) {
    fs.rmSync(part);
    throw new Error(`downloaded file does not match the catalog (size ${size}, sha256 ${hash.slice(0, 12)}...)`);
  }
  fs.renameSync(part, dest);
}

let bad = 0;
for (const f of catalog.files) {
  const dest = path.join(ROOT, f.path);
  const tag = f.id.padEnd(22);
  if (f.optional && !ALL && !fs.existsSync(dest)) { console.log(`${tag} skipped (optional; --all to fetch)`); continue; }
  if (fs.existsSync(dest)) {
    const size = fs.statSync(dest).size;
    const hash = size === f.bytes ? await sha256(dest) : null;
    if (size === f.bytes && hash === f.sha256) { console.log(`${tag} ok       ${mb(size)}`); continue; }
    console.log(`${tag} MISMATCH ${f.path}: size ${size} (want ${f.bytes})${hash ? `, sha256 ${hash.slice(0, 12)}...` : ""}; left untouched`);
    bad++;
    continue;
  }
  if (f.inRepo) { console.log(`${tag} MISSING  ${f.path} is part of the repository`); bad++; continue; }
  if (CHECK) { console.log(`${tag} MISSING  ${f.path}`); bad++; continue; }
  process.stdout.write(`${tag} fetching ${mb(f.bytes)} from ${new URL(f.url).host} ... `);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let err = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { await download(f, dest); err = null; break; } catch (e) { err = e; fs.rmSync(`${dest}.part`, { force: true }); }
  }
  if (err) { console.log(`FAILED after 3 tries: ${err.message}${err.cause ? ` (${err.cause.code ?? err.cause.message})` : ""}`); bad++; } else console.log("ok");
}
if (bad) { console.error(`\n${bad} file(s) missing or not matching data/sources.json`); process.exit(1); }
console.log("\nall inputs present and verified");
