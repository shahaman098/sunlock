# 03 — Gate test: does SUNLOCK survive the 10/10 checklist?

Date: 2026-11-14 · Verdict: **PASS — build (8/10), with two sharpening changes**

The funnel was run in the order you specified: crowded-idea blacklist → hard gates → blind pairwise.
It was **not** run as a scoring exercise, because scoring 10 ideas I invented would have produced
ten polished rationalisations.

---

## 0. Crowded-idea blacklist for *this* event (what to avoid)

Derived from the theme (Moon/Mars/universe) and the 14 official challenges:

- A dashboard of Mars/Lunar imagery with pins and a filter bar
- "AI mission assistant" chatbots answering questions about planets
- Quiz/flashcard apps for space education
- Sonification of a dataset with no analytical payload
- Land-cover change maps with no causal claim
- Anything whose core output is *text*

Space Apps routinely receives thousands of image-viewer dashboards. The blacklist is real.

## 1. Hard gates

| Gate | SUNLOCK | Evidence |
|---|---|---|
| Core result demonstrable? | ✅ | Shadow map recomputes from real DEM every time step |
| Needs real computation? | ✅ | 57.7 M-pixel terrain + ephemeris + horizon ray-march |
| Data exists & accessible? | ✅ | `LDEM_80S_80M.IMG` downloaded (115,520,000 B) and processed |
| Fits a specific track? | ✅ | *Lunar Landing Site Navigator* (official 2026 challenge) |
| 60-second transformation? | ✅ | "Pick a site → see the exact date the Sun returns" |
| Deliverable in time? | ✅ | Physics + assets done; UI remains |
| Collision risk acceptable? | ⚠️ **Medium** | NASA already publishes illumination tools — see below |

## 2. Collision audit (honest)

Nearest analogues:

1. **NASA LOLA illumination / "Peary" style planners** — exist, but are research tools with
   command-line or GIS interfaces. The challenge text itself says interfaces make these
   "difficult to use."
2. **Moon Trek / LROC QuickMap** — excellent imagery viewers, but no landing-window reasoning.
3. **SPICE-based scripts** (spiceypy notebooks) — the actual status quo: a scientist writes a
   script per question.

**Structural difference:** none of the public analogues combine (a) *terrain-driven* shadow
simulation, (b) Earth line-of-sight, and (c) a ranked landing-window search in one interactive
surface. That combination is the differentiator, and it is observable in the demo — not positioning.

**Collision risk: medium.** Other teams will attempt "lunar map" projects. Most will build an
imagery viewer with pins. The terrain-driven shadow *simulation* is materially harder to fake and
is the thing to lead with.

## 3. ChatGPT replaceability test

Prompt: "Which lunar south pole site should we land at, and in what week?"

ChatGPT can produce plausible prose. It cannot:
- read a 115 MB altimetry raster,
- ray-march 360 horizon directions per site against 80 m terrain,
- transform JPL-grade ephemerides into the lunar body-fixed frame,
- and produce a defensible, reproducible window.

This is the single strongest property of the project.

## 4. Hard-to-fake advantage

The shadow mask is derived from LRO laser altimetry. It cannot be convincingly mocked, and it is
**checkable**: published work reports high illumination fractions at ridge sites near Shackleton.
If our numbers land in the right range, that is independent corroboration a judge can verify.

## 5. Where it is weak (and the fixes)

| Weakness | Fix (applied) |
|---|---|
| "Planner dashboard" is a crowded topology | Lead with **one transformation**, not a dashboard: *site → date the Sun returns* |
| Accuracy claims could be overstated | Publish the method and the limitations in-app; do not claim operational fidelity |
| Map without numbers is just a picture | Ranking table + per-site illumination %, longest darkness, comm duty cycle |
| Judges may not know lunar geography | Label sites with real names and show why a ridge beats a crater floor |

## 6. Blind pairwise (A = SUNLOCK, B = Martian route map, C = Earth sonification)

- **A vs B:** A has computation judges can verify; B is a map viewer with routes. A wins on Validity.
- **A vs C:** C is memorable and unusual; A is more credible and more clearly "mission concept."
  A wins on Relevance and Validity; C wins on Creativity.
- **B vs C:** C wins on distinctiveness, B wins on directness.

**A wins both of its pairs.** It is the most defensible under the published criteria
(Impact, Creativity, Validity, Relevance, Presentation) because it is strong on the two that are
hardest to fake — Validity and Relevance — while still having a visual demo moment.

## 7. Changes adopted from the critique

1. **Identity sharpened:** not "a navigator dashboard" — *"the tool that tells you the week the Sun
   comes back."* One sentence, one memory.
2. **Numbers in the demo:** show illumination %, longest darkness, comm duty cycle — not just prettiness.
3. **Explicit limitations** in the UI (method panel). Trust layer, as you argued.
4. **No AI/agent decoration.** There is no LLM in the product and no agent theatre. It is deterministic
   physics. That is a feature, not a gap.

## 8. Score

| Check | Result |
|---|---|
| Past winners analysed | ⚠️ Partial (award definitions verified; 2025 project details not retrievable) |
| Can it win | ✅ |
| Real problem | ✅ |
| Real data | ✅ |
| Track fit | ✅ |
| Defined users | ✅ |
| Platform necessity | ✅ (computation, not hardware) |
| Not ChatGPT-replaceable | ✅ |
| Non-generic | ✅ (medium collision risk, structural differentiator) |
| Defensible | ⚠️ Hard-to-fake, not a moat |

**8/10 → strong contender, build immediately.**
