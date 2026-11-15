// Provenance: every data file the app ships (and every validation result) is exactly the one the
// pipeline built, and the pipeline's NASA inputs are the ones pinned in data/sources.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

const ROOT = new URL("../../", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, ROOT));
const manifest = JSON.parse(read("web/public/terrain/manifest.json"));
const sources = JSON.parse(read("data/sources.json")).files;

test("every pipeline output on disk matches the SHA-256 the manifest recorded", () => {
  const outs = Object.entries(manifest.outputs);
  assert.ok(outs.length >= 18, `${outs.length} outputs recorded`);
  for (const [p, o] of outs) {
    const buf = read(p);
    assert.equal(buf.length, o.bytes, `${p}: size`);
    assert.equal(crypto.createHash("sha256").update(buf).digest("hex"), o.sha256, `${p} was changed outside the pipeline (npm run data)`);
  }
});

test("every data file the app loads is covered by the manifest", () => {
  const shipped = fs.readdirSync(new URL("web/public/terrain/", ROOT)).filter((f) => !f.startsWith("benchmark") && f !== "verification.json" && f !== "manifest.json");
  for (const f of shipped) assert.ok(manifest.outputs[`web/public/terrain/${f}`], `${f} has no recorded origin`);
});

test("the manifest's NASA inputs are the files pinned in data/sources.json, with official URLs", () => {
  for (const [id, s] of Object.entries(manifest.sources)) {
    const c = sources.find((f) => f.id === id);
    assert.ok(c, id);
    assert.equal(s.sha256, c.sha256, id);
    assert.match(c.url, /^https?:\/\/(pds-geosciences\.wustl\.edu|imbrium\.mit\.edu|pds\.lroc\.asu\.edu|doi\.org)\//, id);
  }
  // each stage recorded the exact input hashes it ran with
  for (const [id, st] of Object.entries(manifest.stages)) {
    for (const [p, h] of Object.entries(st.inputs)) {
      const c = sources.find((f) => f.path === p);
      if (c) assert.equal(h, c.sha256, `${id}: ${p}`);
    }
  }
});
