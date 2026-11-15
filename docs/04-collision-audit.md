# 04 — Collision audit: SUNLOCK against other public 2026 entries

Date: 2026-11-15 · Method: GitHub repo search for 2026 *Lunar Landing Site Navigator* projects (114 repos updated since 1 Oct 2026). 104 public READMEs were read and keyword-counted. Only public repositories were read.
Caveat: READMEs describe claims, not verified behaviour. Many teams are not on GitHub at all.

## Headline
**Collision risk for SUNLOCK's core is HIGH.** This challenge is crowded, and many entries are sophisticated.
Several features this session proposed as differentiators **already exist in competitor entries**:

| Proposed differentiator | Competitor READMEs mentioning it (of 104) | Examples |
|---|---|---|
| JPL Horizons / SPICE verification | Horizons 70 · SPICE/DE4xx 49 | most entries |
| Terrain horizon ray-march | 42 | most entries |
| **Validation against NASA PGDA `AVGVISIB` maps** | 33 mention PGDA/AVGVISIB. At least 4 report numbers: r = 0.96–0.998, bias ≈ 0.3–4 pp | EsatAkkasoglu (r = 0.998 Earth), Arairo (3,721 pts, r = 0.96), eugeniobusta (9 sites within 3.5 pp) |
| LROC WAC comparison | at least 1, with a resolution-bias analysis | rodneymora94965 |
| Battery state-of-charge simulation / survival verdict | battery 23 · survive 18 | Hatim-A/selenogrid, PandisDP/LUMEN, azizovll |
| "Which landing day survives" calendar (porkchop-like) | at least 2 | devadd2105-max/clearway ("When to land" per day), Otman-BEH/MonsCarlo ("opportunity atlas" every 12 h) |
| Hardware design / stress testing | at least 1 | Otman-BEH/MonsCarlo (survival frontier, fault injection) |
| Calendar export (.ics) | 16 mention calendar | — |
| Monte Carlo / uncertainty | 12 | — |
| Rover traverse | 31 | — |

**What this means:** the Lander Check, the PGDA validation and the landing-date survival calendar are **table stakes, not differentiators**. They're still worth building, because without them SUNLOCK falls behind the strongest entries. But they won't make it stand out.

## What is still uncrowded (0–3 of 104 READMEs)
| Asset | Competitor count | Status in SUNLOCK |
|---|---|---|
| **Horizon-sampling convergence study** (same point gives 36.8–94.4% depending only on ray step; converged bilinear values; centre-vs-limb worth ~12.5 pp) | **0** (3 mention "sampling interval", but only as a time step) | ✅ Already done: `research/REPORT.md`, `npm run bench:ray`, `bench:conv` |
| Pre-registered validation hypotheses | **0** | Not done |
| Porkchop framing (landing date × site matrix, mission-design idiom) | **0** by name; 2 have per-day calendars for one site | Not done |
| Live whole-region shadow map recomputed in the browser from the DEM | ~19 mention shadow maps or per-pixel work; not checked in detail | ✅ Done |

## Most likely winning position
Every team asks, *"how much sunlight does this site get?"* SUNLOCK's distinctive research asks a sharper question: **"how much can you trust anyone's sunlight number, including ours and NASA's?"**

That is a **Best Use of Science** story ("the most valid use of the scientific method"). No public competitor has it.

1. **Lead with the convergence finding.** "The same ridge-top point reads 37% or 94% depending on one hidden parameter. We measured it, converged it, and validated the result against NASA's maps."
2. **Do the PGDA validation anyway, but frame it as a test of the convergence result.** Show that the converged estimator matches `AVGVISIB` better than the coarse one. That turns the validation into evidence for SUNLOCK's own finding, instead of a copy of what others already did.
3. **Pre-register** the thresholds before running. Nobody else has.
4. **Make uncertainty visible in the product.** Show every illumination number as a range from the sampling/criterion study (for example "57–72%, converged"), not a single falsely precise figure. No competitor shows this.
5. Ship the Lander Check and the porkchop plot as **parity** features, kept small and solid.

## Honest risk
- Some competitors look **further ahead on breadth**: thermal models, fault injection, design frontiers, LROC bias analysis. SUNLOCK shouldn't try to out-feature them in one day.
- If the shipped app keeps the non-converged 86% while the report says it's unconverged, a science judge comparing entries will notice. Fixing the estimator (research plan R3) is now **more important** than adding features.
