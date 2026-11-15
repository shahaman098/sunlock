# 05 — Head-to-head: SUNLOCK against the strongest live competitors

Date: 2026-11-15 · Method: opened each public live app in a browser and read its main views. Each is scored 1–5 on the five official criteria (Impact, Creativity, Validity, Relevance, Presentation).
**These scores are our estimates, not judge scores.** Only what each app shows publicly was assessed.

## Scorecard
| Entry (live URL) | Impact | Creativity | Validity | Relevance | Presentation | Total /25 |
|---|---|---|---|---|---|---|
| **Claude's P.L.A.N** — claudes-plan-lunar-navigator.vercel.app | 5 | 4 | 5 | 5 | 5 | **24** |
| **SelenoGrid** — hatim-a.github.io/selenogrid | 4 | 4 | 5 | 5 | 5 | **23** |
| EsatAkkasoglu navigator — esatakkasoglu.github.io/lunar-landing-site-navigator | 4 | 4 | 4 | 5 | 4 | 21 |
| Lunar Site Navigator — lunar-site-navigator.rodneymora94965.workers.dev | 4 | 3 | 5 | 5 | 4 | 21 |
| LUMEN 3D — pandisdp.github.io/LUMEN | 4 | 4 | 4 | 4 | 5 | 21 |
| **SUNLOCK** — shahaman098.github.io/sunlock | 3 | 3 | 3 | 3 | 4 | **16** |

**Verdict:** SUNLOCK is **currently behind** the top entries. The main reasons are site choice and relevance, not the physics engine.

## Re-run log
| Time (GMT) | SUNLOCK change since last run | Rivals | Re-score |
|---|---|---|---|
| 15 Nov ~01:30 | baseline | baseline | SUNLOCK 16 · P.L.A.N 24 · SelenoGrid 23 |
| 15 Nov 02:30 | **none**: live site still on the 2022 region list; last deploy 01:24; no commits after `6a16aa1` | P.L.A.N and SelenoGrid unchanged on spot-check | **unchanged:** SUNLOCK 16 · P.L.A.N 24 · SelenoGrid 23 |
| 15 Nov 03:30 | **Local build, not deployed.** Current nine regions from 130 published sites; validation-aware choice; Lander Check + porkchop; panel height 0/2/10 m; 10 landing criteria including distance to permanent shadow and longest radio blackout; pre-registered H1/H2/H4 **pass** (r 0.990 · IoU 0.926 · r 0.989), H3 not run; 25 automated tests (mutation-checked against the mirror bug); 20 m experiment documented as a negative result; console redesign in plain language | not re-checked | **SUNLOCK ≈ 23–24 local** (Impact 4–5, Creativity 5, Validity 5, Relevance 5, Presentation 4: deck, README and page still stale). **Live site still ≈ 16 until deployed.** |

**Where SUNLOCK still trails, after this round:** P.L.A.N has thermal and ice-depth criteria (needs Diviner data we don't have) and a walkable-ground metric. SelenoGrid uses 20 m terrain; we tested 20 m and documented why we didn't ship it. **Where SUNLOCK now leads, as far as we can see:**
- pre-registered validation with pass/fail shown in the app
- re-runnable tests
- uncertainty ranges
- survive-or-die decision with the earliest survivable date
- porkchop of every site × date
- the mast-height design lever

## What the leaders have that SUNLOCK doesn't
| Capability | Who has it |
|---|---|
| **NASA's current nine Artemis III regions** (Oct 2024): Peak near Cabeus B, Haworth, Malapert Massif, Mons Mouton Plateau, Mons Mouton, Nobile Rim 1, Nobile Rim 2, de Gerlache Rim 2, Slater Plain | P.L.A.N, SelenoGrid, rodneymora, (Esat partially) |
| Site coordinates cited from published work (P.L.A.N cites Wueller et al. 2026, JGR Planets, doi:10.1029/2025JE009434, Table A1; not independently verified by us) | P.L.A.N |
| Landing-safety criteria beyond light: slope, walkable ground, distance to permanent shadow, temperature, ice depth (11 criteria) | P.L.A.N |
| Higher-resolution terrain (20 m) and longer rays (220 km, 0.25° bins) | SelenoGrid, rodneymora (20 m tile) |
| Landing-date slip analysis over 12 months, mast height, CSV export | Esat |
| Audience modes (planner / educator / public), guided tour, explainer video | LUMEN, rodneymora, P.L.A.N (simple / detailed) |

## Defects found in SUNLOCK during this check
1. **Outdated site list.** SUNLOCK's "nine candidate regions" mix NASA's 2022 list of 13 with other sites. Peak near Shackleton, Connecting Ridge, Leibnitz Beta, Amundsen Rim and "de Gerlache Rim" are not in the current nine. Mons Mouton, Mons Mouton Plateau, Nobile Rim 2 and Slater Plain are missing. Source: NASA LPSC 2026 abstract, NTRS 20250011660.
2. **Site points are in poor spots inside their regions.** SUNLOCK agrees with NASA's 18.6-year LOLA map at the points it chose: Connecting Ridge 53% vs NASA 52%, Malapert 55% vs 56%, Haworth 0% vs 0%. But the points aren't the best ground nearby. Within 5 km, NASA's map shows **88%** near Shackleton (SUNLOCK: 73%), **83%** on Connecting Ridge (53%) and **79%** at Malapert (55%). Haworth's point sits at −3,191 m in permanent shadow. As a result, the top site's verdict reads "Marginal" and the best ranking score is 28.

| Site | SUNLOCK point elevation | NASA sunlight at point | NASA best within 5 km |
|---|---|---|---|
| Peak near Shackleton | 1958 m | 65% | 88% |
| Connecting Ridge | 1554 m | 52% | 83% |
| de Gerlache Rim | −527 m | 14% | 32% |
| Haworth | −3191 m | 0% | 0% |
| Malapert Massif | 5172 m | 56% | 79% |
| Leibnitz Beta Plateau | −788 m | 15% | 31% |
| Nobile Rim 1 | 774 m | 2% | 36% |

(NASA = `AVGVISIB_85S_060M_201608`, 18.6-year average. SUNLOCK's percentages cover 180 days, so small differences are expected.)

## What SUNLOCK still has that others don't
- A live **whole-pole** shadow map recomputed from the DEM as you scrub (others show per-site skies or static maps)
- A pre-registered validation, plus the horizon-sampling convergence study

## Tool fixes, ranked by score gained
1. **Use NASA's current nine Artemis III regions** (Relevance +1–2, Validity +1)
2. **Pick each site by searching for the best-lit ground inside the region**, using SUNLOCK's own model and cross-checking against `AVGVISIB`, instead of snapping to high ground (Validity +1, Impact +1). This is the "searched cluster" method of Gläser et al.
3. **Add a slope check** from the DEM, since NASA's landing criteria include it (Validity, Relevance)
4. **Show trust:** sampling-uncertainty ranges and the r = 0.995 validation in the app (Creativity, Validity; nobody else shows ranges)
5. Lander Check verdict + live re-ranking (parity)
