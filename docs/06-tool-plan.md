# SUNLOCK — make the tool No. 1 by 22:00 GMT (Sun 15 Nov 2026)

## Context
- **Deadline:** submission closes **Sun 15 Nov, 23:59 GMT** (Team Owner local time). The project is already submitted, but its page is stale (still says 86%).
- **User's decision:** work only on the **tool** until **22:00 GMT**. Then README, slides, video and project page, then **Submit for Judging again**.
- **Head-to-head today** (`docs/05-head-to-head.md`): SUNLOCK ≈ **16/25**. Claude's P.L.A.N ≈ 24, SelenoGrid ≈ 23. The engine is sound: it matches NASA's map at the points it uses. The losses come from three things:
  1. an **outdated region list** (NASA's 2022 list, not the Oct 2024 nine)
  2. **badly placed site points**, e.g. 73% where 88% exists within 5 km; Haworth sits in permanent shadow
  3. no landing-safety criteria and no decision output
- **Goal:** reach ≥ 23/25 on our own re-score by 18:00, and lead on Validity and Creativity through things no rival has: whole-pole live shadows, uncertainty ranges, and the pre-registered validation.
- No one can guarantee first place. We re-score against the same rivals at each gate.

Everything below is built by **OpenCode**. Eivan drafts docs in parallel, without changing repo files until 22:00.

---

## Tool workstreams (priority order)

### T1 — NASA's current nine Artemis III regions  ·  02:00–05:00
- Replace the site list in `scripts/build-terrain.mjs` (SITES array, ~line 286) with the Oct 2024 nine: Peak near Cabeus B, Haworth, Malapert Massif, Mons Mouton Plateau, Mons Mouton, Nobile Rim 1, Nobile Rim 2, de Gerlache Rim 2, Slater Plain.
  - Source: NASA LPSC 2026 abstract, NTRS 20250011660.
- **Coordinates:**
  - Use NASA's official region definitions, or the published representative points in Wueller et al. 2026, *JGR Planets*, doi:10.1029/2025JE009434, Table A1 / Zenodo.
  - **Verify against the paper itself; don't copy from rival repos.**
  - Record the source per site in `sites.json`.
- Keep the dropped 2022 sites (Peak near Shackleton, Connecting Ridge, etc.) as clearly labelled **reference sites**. Judges know them, and SelenoGrid does the same.
- **Done when:** the app lists 9 current regions + references, each with a cited coordinate source.

### T2 — Best-lit ground inside each region  ·  05:00–10:00 (highest score gain)
- For each region, search a candidate grid (≈120 m spacing, within the region or a 5 km radius) with SUNLOCK's **converged** estimator: bilinear horizon, any-part-of-disc.
- Pick the point with the highest 18.6-year illumination, subject to the slope limit from T3.
- Replace the high-ground snapping in `build-terrain.mjs` (~lines 295–300).
- **Show both points per region:** NASA's representative point, and SUNLOCK's best-lit point with its distance (e.g. "best ground 1.8 km NE: 86% vs 62%").
  - Lets judges see the tool *finds* better ground.
  - Same method as Gläser et al.'s "searched clusters".
- **Reuse:** the horizon ray-march in `build-terrain.mjs` (`horizonAlong`, line 71) and the converged variant in `web/scripts/validate-lola.mjs`. **Move both into one shared module** so the validator and builder can't diverge.
- **Cross-check:** each chosen point against NASA `AVGVISIB_85S_060M_201608` (same check as this session's site table).
- **Done when:** every region's best point is within ~5 pp of the best NASA value inside that region, and no region shows a crater-floor 0% unless NASA agrees.

### T3 — Landing slope from the DEM  ·  10:00–11:00
- Compute slope at every candidate point (3×3 gradient on the 80 m LOLA DEM), and use it as a filter in T2.
- Show slope with pass/fail in the site card. The limit is a visible, editable parameter; cite its source, don't hard-code an unsourced figure.
- **Done when:** each site card shows slope, and the chosen points pass the limit.

### T4 — Validation where landers actually go  ·  11:00–14:00
- Extend `web/scripts/validate-lola.mjs`:
  - a **stratified sample**: ≥ 200 points where NASA's map shows > 50% illumination, plus all region and reference points
  - **H4:** Earth visibility against `AVGVISIB_85S_060M_201608_EARTH.IMG`
  - **H2** on a shadow-inclusive sample against `LPSR_85S_060M_201608.IMG`
  - hourly steps if runtime allows; otherwise state "3-hourly" explicitly
- Write `web/public/terrain/validation.json` with r, RMSE and bias per band, and n per band.
- Correct `research/REPORT.md` to describe exactly what ran: points, step, and pass/fail for each hypothesis.
- **Done when:** bands above 50% have n ≥ 50 each, with their r / bias reported.

### T5 — Trust inside the app (unique differentiator)  ·  14:00–16:00
- **Validation badge** in the header and method panel: "Matches NASA's 18.6-year LOLA map: r = …, bias … pp (n = …)", loaded from `validation.json`. Load it the same way `verification.json` is loaded (`App.tsx` ~line 58).
- **Uncertainty range** on every sunlight figure, e.g. "84% (80–87%)". Compute it at build time per site from the convention spread (nearest-160 m vs converged bilinear, centre vs any-part). **No rival shows ranges.**
- **Fix the in-app limitations text** (`App.tsx` ~lines 440–445):
  - remove "atmospheric refraction"
  - libration: say "IAU 2015 series, periodic terms included"
  - state the horizon reach per layer
- **Done when:** a judge sees the validation and a range without opening any document.

### T6 — Lander Check (decision output)  ·  16:00–18:00
- Add `simulateMission()` in `web/src/lib/power.ts`: battery state of charge stepped over the existing `Sample` series from `siteSeries` (`analysis.ts:22`), reusing `arrayPowerPerM2` (`power.ts:22`).
- Add a card in `App.tsx` with load / array / battery inputs. **Landing time = the scrubber (`currentMs`).** The verdict reads **SURVIVES (min charge X%)** or **LOST on <date>**.
- Replace the hard-coded verdict text (`App.tsx` ~254–262). Re-sort the site ranking by survival at the current date.
- **Done when:** dragging the date flips the verdict and re-orders the ranking live.

### ⛳ 18:00 gate — re-score
- Re-run the head-to-head against P.L.A.N, SelenoGrid and Esat on the official 1–5 rubric.
- **If ≥ 23/25:** continue to T7.
- **If not:** spend 18:00–21:00 on whichever criterion scored lowest instead of T7.

### T7 — Landing porkchop (stretch)  ·  18:00–20:30
- Canvas grid: landing date (x, 6-hour steps over 180 days) × region (y), each cell coloured by the Lander Check minimum charge.
- Clicking a cell sets the site and date. No rival presents this as a porkchop plot.

### T8 — Judge-proofing  ·  20:30–22:00 (mandatory, never cut)
- Production build and deploy to `gh-pages`, the same way the current site was published (inspect the `origin/gh-pages` branch first).
- On the live URL:
  - first load under ~5 s
  - zero console errors
  - usable at phone width
  - deep links work
  - no login
- Write a **numbers sheet** (`docs/numbers-final.md`): every figure that the README, slides and page will quote, pulled from the deployed build.

### 22:00 — freeze the tool
- **22:00–23:30:**
  - README, slides (the 7-slide PDF; skip the video unless time is left)
  - project page rewritten from the numbers sheet (Eivan's drafts plug in here)
  - **Submit for Judging again**
  - confirm the banner appears
  - confirm Eivan is on the Members tab
- **23:30–23:59:** buffer only.

---

## Risk register
| Risk | Mitigation |
|---|---|
| The page still says 86% if the 22:00–23:59 window slips | **Recommended:** at the 18:00 gate, paste corrected headline numbers into the project page and resubmit (5 min). The final rewrite still happens after 22:00 |
| T2 search is slow (horizon per candidate × 18.6 years) | Coarse grid first (240 m), refine around the top 5; use 3-hourly steps and disclose it |
| Region coordinates can't be verified from the paper | Use NASA's published region figure or polygons and label points "approximate". Never copy unverified rival data |
| A rebuild breaks the live app | Deploy only after `npm run build` + browser check; keep the previous `gh-pages` commit to roll back |

## Verification (each workstream)
1. `cd web && npm run build && npm run lint` pass. `npm run verify` (Horizons) and `npm run bench` are unchanged.
2. Run the site check that compares each chosen point to NASA `AVGVISIB` at the point and the best within the region; it must pass the T2 criterion.
3. `npm run validate` regenerates `validation.json` and the scatter plot from raw data.
4. Browser pane check on the deployed URL:
   - region list is current
   - the best-lit points show
   - the badge and ranges render
   - the Lander Check flips when dragging
   - no console errors
5. Re-score at 18:00 and 22:00 against the same rivals in `docs/05-head-to-head.md`.
