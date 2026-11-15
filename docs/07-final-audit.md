# 07 — Final audit and reconstruction plan

Audit time: **Sun 15 Nov 2026, 03:20 GMT**. Deadline: **today 23:59, Team Owner local time (GMT)**. Tool freeze: **22:00 GMT** (team decision).
Everything below was checked against the repo, the running app (local dev server), the live site, and official sources. Items marked **UNVERIFIED** were not checked.

---

## 1. Executive verdict

- **Concept:** sound and on-brief, but the core idea is the obvious answer to the challenge. About 100 public repos built Sun/Earth visibility over LOLA terrain.
- **The local build** (redesigned console, NASA's current nine regions, validation-aware site choice, Lander Check, porkchop, Earth-mirror fix) is plausibly at the level of the two strongest public rivals. It isn't clearly above them.
- **Most serious problem:** none of it is deployed, and every judge-facing document (live site, project page, README, deck, research report, BENCHMARKS) describes an older, partly incorrect version:
  - 86% headline, 2022 regions, mirrored horizons
  - "36.8–94.4%" spread
  - "0.40%" disc effect
- **The risk:** a science judge comparing the page, repo and app will find contradictions. On a rubric where Validity is one of five equal criteria, that loses first place on its own.
- **Recommendation: KEEP AND OPTIMISE.** The redesign is already done. Spend the remaining hours on deployment, consistency, and evidence that a judge can re-run (tests + validation), not on new features.

## 2. Competition intelligence (verified this session)

| Fact | Source |
|---|---|
| Submit by **Sun 15 Nov 23:59**, Team Owner's local time for the Universal Event. Edit and resubmit allowed until the deadline; "only your last saved submission will be reviewed" | [Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide/) |
| Demo: **≤ 7 slides or ≤ 30 s video**. Links public, no login. English. Images may be embedded; video and documents must be linked | same |
| **≥ 1 NASA dataset** required for Global Awards | same |
| AI (SI) use allowed but must be disclosed. "SI should not be used to (come up with your idea…)". **No NASA branding/design elements** in generated content. Code/data must acknowledge SI in text and metadata | same |
| **Universal Event teams need ≥ 2 members** to be eligible for Global Judging. All members listed on the Members tab before close | [Judging & Awards Guide](https://www.spaceappschallenge.org/resources/judging-awards-guide/) |
| Five criteria, each **1–5**: Impact, Creativity, Validity, Relevance, Presentation. No weights published (treat as equal). Presentation is scored from "the demo and full project" | same |
| Pipeline: Universal Event SMEs → Global Nominees (3 Dec) → Global Finalists → executive committee → **10 Global Winners (26 Jan 2027)** | same |
| NASA's current Artemis III regions (Oct 2024): Peak near Cabeus B, Haworth, Malapert Massif, Mons Mouton Plateau, Mons Mouton, Nobile Rim 1, Nobile Rim 2, de Gerlache Rim 2, Slater Plain | [NTRS 20250011660](https://ntrs.nasa.gov/citations/20250011660) |

**Inferred judging preferences** (from 2020–2025 winners, not official rules):
- NASA data as the engine
- a decision for a named user
- "when" tools win Mission Concept and Technology (Landsat Connect 2024, SkySense 2025)
- design validated against real threats (PureFlow 2025)
- lunar data does well with science judges (2023 Science + Technology)
- Universal teams win most years

**What separates two working entries:**
- **Validity** that a judge can check in a minute
- the **decision** the tool produces, not the map
- **consistency** between demo, page and repo

## 3. Competitive benchmark (public evidence only)

| Dimension | Claude's P.L.A.N | SelenoGrid | SUNLOCK (local build) |
|---|---|---|---|
| Current NASA regions | ✅ (paper-cited points) | ✅ 9 + 9 refs | ✅ 9 + 7 refs, **130 published sites evaluated** |
| Terrain | LOLA (120 m squares) + more layers | **20 m LOLA, 220 km, 0.25° bins** | 80 m LOLA, 150 km, 1° bins (converged convention) |
| Landing criteria beyond light | **11 criteria** (slope, walkable, PSR distance, temperature, ice depth) | weights visible | slope only |
| Validation vs NASA maps | 9 sites within 3.5 pp (README claim, not re-run by us) | JPL-checked geometry | **Pre-registered**; r 0.990 over 1,782 pts; 105 landing sites r 0.915 (sun) / 0.972 (Earth); JPL 21″ |
| Decision output | criteria verdict, battery | ranking, event clock | **live SURVIVES / BATTERY DIES**, earliest survivable date, **porkchop of all sites × dates** |
| Uncertainty shown | no | no | **range on every long-run figure** |
| Whole-pole live shadows | no | no | **yes** |
| Polish / storytelling | very high | very high | high (local), **old version live** |

**To decisively beat SUNLOCK, a rival would need** P.L.A.N's breadth of criteria plus a validation story as auditable as ours. P.L.A.N is closest.

**How SUNLOCK gets ahead:**
1. Make the validation and the decision instantly visible.
2. Make every number consistent and reproducible (tests + one command).
3. Add the one landing criterion most relevant to Artemis science: distance to permanently shadowed regions (ice access), from NASA's LPSR map we already have.

## 4. Forensic audit

**Verified (re-run today):**
- JPL Horizons check: Sun 21″, Earth 22.7″, frame 0.0032°/0.0021° (`npm run verify`)
- Map-wide sunlight validation, pre-registered config: 2,000 pts hourly, 1,782 paired, **r 0.990, RMSE 1.9 pp, bias 0.0 pp** (`npm run validate`)
- 105 published landing sites: sunlight r 0.915, bias −1.1 pp, 80/105 within 5 pp; **Earth r 0.972, RMSE 4.0 pp** after the mirror fix (was 0.603) (`npm run sites`)
- Sensitivity benchmark runs on the new sites (`npm run bench`): disc criterion **up to 9.6 pp**, position σ ≤ 0.05%, 4° azimuth ≤ 0.36%
- App, in browser: Lander Check flips LOST → SURVIVES by landing date; porkchop click sets site and date; deep links restore state; tour; playback; no console errors; no horizontal overflow at 1440 / 1100 / 375 px; production build passes

**Defects and gaps:**

| # | Issue | Severity |
|---|---|---|
| D1 | **Nothing committed or deployed.** Live site = old regions, mirrored horizons, 86% | **Blocker** |
| D2 | Project page says 86% and describes the old tool | **Blocker** (judges read the page most) |
| D3 | README / deck / REPORT / BENCHMARKS / LITERATURE contradict the app: 36.8–94.4%, 0.40% disc, 3.5-day night, old site list, "2,000 points" claim that wasn't run at the time | High (Validity) |
| D4 | `bench:ray` / `bench:conv` look up "Peak near Shackleton" by name, which is now a different point, so the report's convergence table can't be reproduced | High |
| D5 | **No automated tests.** No `npm test`; correctness rests on manual runs | High (a judge asks "how do you know?") |
| D6 | H2 (permanent-shadow IoU) pre-registered but never tested | Medium |
| D7 | Agreement weak within ~1° of the pole (sd ≈ 12 pp); the 20 m DEM is on disk but unused | Medium (affects reference sites, plus dGR2 at 88.45°S) |
| D8 | Only one landing criterion besides light and radio (slope) | Medium (breadth vs P.L.A.N) |
| D9 | SI disclosure absent from README / repo metadata. The ideation used AI-assisted screening docs (plan PDF, gate test) | Compliance risk; describe it truthfully |
| D10 | Second member (Eivan) on Members tab: **UNVERIFIED by me** | Eligibility blocker if missing |
| D11 | First-order power model: no heaters, no night survival loads | Low (stated limitation) |

## 5. Adversarial judge assessment (estimates, not official scores)

| Criterion | Now (live) | Local build | After plan | Main weakness | Missing evidence |
|---|---|---|---|---|---|
| Impact | 3 | 4 | 4 | Users are early-concept teams; flight teams use in-house tools | Named user + concrete decision in the page |
| Creativity | 3 | 4 | 4–5 | Core idea is crowded | Porkchop + uncertainty + validation-aware site choice shown up front |
| Validity | 2–3 (docs contradict) | 4 | **5** | Inconsistent numbers; no tests; H2 untested | `npm test`, H2 result, one consistent number sheet |
| Relevance | 3 (old regions) | 5 | 5 | — | — |
| Presentation | 3 | 4 | 4–5 | Stale deck and page | Deck rebuilt on the new console; 30 s video optional |
| **Total /25** | **~14–16** | **~21** | **~22–24** | | |

**Toughest questions and how to answer them:**
1. *"Why should I trust 72%?"*
   Badge → drawer: pre-registered r 0.990 against NASA's own map, a range per site, NASA's value shown per site.
2. *"Your report said 86% and 36.8–94.4%. Which is right?"*
   Only answerable if D3/D4 are fixed. The answer then: "two bugs found by our own validation, both documented, with commits."
3. *"What did you build this weekend vs reuse?"*
   Git history from 14 Nov. Astronomy Engine and React are libraries; everything else is ours.
4. *"How do you know the Lander Check is right?"*
   Needs D5: unit tests (all-lit never dies; all-dark dies at exactly usable/load hours; porkchop cell = full simulation).
5. *"Why not the 20 m DEM?"*
   Either do D7 for sites south of 87.5°S, or state the measured near-pole disagreement (already in the app).
6. *"Did AI come up with the idea?"*
   Truthful SI answer (D9).

## 6. Four-strategy decision

| | A Keep & optimise | B Major redesign | C Pivot | D Replace |
|---|---|---|---|---|
| Fit to rubric | High | High | Unknown | Unknown |
| Achievable quality by 22:00 | **High** | Already done (UI) | Low–medium | Low |
| Differentiation | Medium–high (validation, decision, porkchop) | same | ? | ? |
| Evidence available | **Strong, re-runnable** | same | must be rebuilt | none |
| Delivery risk | Low | — | High | Very high |
| Rules risk | Low | Low | Medium | **High**: new AI-generated idea conflicts with the SI rule |
| **Verdict** | **✅ Recommended** | Completed this session | ✗ | ✗ |

**Decision: KEEP AND OPTIMISE.** A pivot or replacement would throw away the only hard-to-fake asset (pre-registered NASA validation + two documented bugs found by it) with about 19 hours left.

## 7. Top 10 changes (ranked by score gain per effort and risk)

| # | Change | Fixes | Effort | Acceptance test |
|---|---|---|---|---|
| 1 | **Commit + deploy now**, then redeploy at each gate | D1 | 20 min | Live URL shows "NASA's current Artemis III sites" and the badge; no console errors |
| 2 | **Interim project-page fix + resubmit**: replace 86% / old regions with the current headline numbers | D2 | 10 min (you, logged in) | Banner after Submit for Judging |
| 3 | **Confirm Eivan on Members tab**; add a truthful SI disclosure to README + page | D10, D9 | 10 min | Screenshot of Members tab |
| 4 | **`npm test`**: node test runner, no new deps. Lander sim synthetic cases; porkchop cell = simulateMission; horizon-direction regression (Earth r ≥ 0.9 at sites); JPL check from cached JSON; validation thresholds from `validation.json` | D5 | 1.5 h | `npm test` green; fails if the mirror bug is reintroduced |
| 5 | **Pin benchmark coordinates** (89.438°S 222.717°E as in the report) and re-run `bench`, `bench:ray`, `bench:conv` | D4 | 30 min | Report table reproduces from one command |
| 6 | **H2 permanent-shadow test**: shadow-inclusive sample vs LPSR, report IoU honestly | D6 | 1 h | Number in `validation.json` + drawer |
| 7 | **Ice-access criterion**: distance from each site to NASA's permanent-shadow map (LPSR), shown in Evidence and as a ranking tiebreak | D8 | 1.5 h | Each site shows "nearest permanent shadow: X km", cross-checked on 3 sites by hand |
| 8 | **Single source of truth for numbers**: generate `docs/numbers-final.md` from `regions.json` + `validation.json` | D3 | 45 min | Every number in README/deck/page traces to this file |
| 9 | **Near-pole refinement** with LDEM_875S_20M for sites south of 87.5°S (near field), 80 m beyond | D7 | 3 h | Near-pole sd vs NASA drops (report before/after) |
| 10 | **Docs and deck rebuild** after the 22:00 freeze (README, REPORT, BENCHMARKS, LITERATURE, 7-slide deck) | D3 | 1.5 h | No occurrence of 86%, 36.8, 0.40%, 3.5 d, "Leibnitz" (as a current region) |

**Remove or abandon:**
- the old "score" column (already gone)
- claims of a converged physical value
- the LROC comparison (no time)
- the 30 s video, unless there are spare minutes (the slides are enough)

## 8. Implementation blueprint (times GMT)

| Window | Work |
|---|---|
| 03:30–04:00 | #1 deploy (needs your OK), #2/#3 (you) |
| 04:00–06:00 | #4 tests, #5 benchmark pin |
| 06:00–08:30 | #6 H2, #7 ice access |
| 08:30–12:00 | #9 near-pole (optional; skip if behind) |
| 12:00–18:00 | buffer, fixes, gate re-score at 18:00, redeploy |
| 18:00–22:00 | #8 numbers sheet, final redeploy, freeze |
| 22:00–23:30 | #10 docs, deck, page, **Submit for Judging**, confirm banner |
| 23:30–23:59 | buffer only |

## 9. Evidence a judge can re-run

```
cd web
npm run verify     # JPL Horizons, 12 epochs
npm run validate   # pre-registered NASA map comparison
npm run sites      # 130 published landing sites vs NASA sun + Earth maps
npm test           # (to add) model, simulation and regression tests
npm run validate:wac-movie   # shadow timing vs 261 timestamped LROC photographs (exploratory)
```

Added 15 Nov: the timing comparison (`research/validation/result-wac-movie.json`) is exploratory,
not pre-registered. Quote it with its caveats: 96.6% state agreement against an 81.2% "always
dark" baseline; median timing error 0.5 h for the 84% of photographed transitions we match
within a day; when we say a 7-day lander survives, the photographs agree 82.7% of the time;
14-day stays untested. The app now opens in a full-screen 3D Moon; the console is one click away.

Show the outputs in a "Reproduce" section of the README and in the drawer.

## 10. Demo (7 slides; the rules allow ≤ 7 slides or ≤ 30 s video)

1. **Title:** "Will your Moon lander survive at the south pole?" with a console screenshot.
2. **Problem:** the Sun is at most ~1.5° above the horizon, so terrain decides power; NASA picked 9 Artemis III regions.
3. **The console:** annotated screenshot (map, verdict, regions, timeline).
4. **The decision:** de Gerlache Rim 2: land 4 Feb → **battery dies 12 Feb**; land 14 Feb → **survives**. Two screenshots.
5. **All sites × dates:** porkchop screenshot, "x% of landings survive".
6. **Why trust it:** pre-registered r 0.990 vs NASA; 105 landing sites; Earth-map comparison caught a mirror bug; JPL 21″.
7. **Data, limits, what's next:** NASA LOLA + PGDA maps, Wueller et al. 2026 sites, stated limitations, links.

## 11. Submission optimisation (draft after the freeze, from the numbers sheet)

- **Title:** SUNLOCK
- **Tagline:** "Will your Moon lander survive at the south pole?"
- **Summary:** lead with the decision, then the validation, then the method. Name the user: early-concept and proposal teams for Artemis-era and CLPS south-pole missions, plus educators.
- **SI section:** state precisely how AI tools were used, for code, docs and idea screening.

## 12. Readiness checklist

☐ Eivan on Members tab · ☐ deployed build = submitted claims · ☐ page numbers match the app · ☐ SI disclosure truthful · ☐ deck ≤ 7 slides, public link · ☐ no NASA logos · ☐ `npm test` green · ☐ Submit for Judging clicked after the final edit, banner seen

## 13. Next action

**Commit and deploy the current build** (#1), then fix the project page and resubmit (#2). Until those happen, judges see the old, partly wrong product.
