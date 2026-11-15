SUNLOCK tool audit and lessons from Space Apps winners, 2016–2025

Reviewed 15 November 2026. This assessment covers the tool, its scientific calculations, interaction design, reliability, and competitive differentiation. Recommendations are proposals for implementation.

The strongest direction is a planner that explains which site, arrival window, and power design continue to work when assumptions change. Several current inconsistencies affect that answer and should be fixed before extending the feature set.

Evidence collected

- Exercised the public app at https://shahaman098.github.io/sunlock/ and reviewed current local source, including uncommitted finder work.
- Re-ran 33 tests, production build, and lint successfully. The build reports a large Three.js chunk. These checks do not cover all the findings below.
- Reproduced battery-sizing and depletion-time issues by calling the current compiled scientific functions on synthetic and real-site inputs.
- Read official award records and representative project descriptions from each annual competition in 2016–2025. The historical review is qualitative. It does not establish causal predictors of winning or estimate SUNLOCK's probability of winning. Award categories changed over the decade. The separate 2020 COVID event is outside this sample.
- The current challenge page and some newer Space Apps pages failed retrieval. Earlier local challenge notes provide context, but full current challenge compliance was not independently re-certified in this review.

Historical examples and their implications

The application lessons in the last column are this audit's interpretation of the cited projects.

| Year | Verified winning example | What the project demonstrates | Application to SUNLOCK |
|---|---|---|---|
| 2016 | Scintilla, Best Use of Data | Combined air-quality sources into an accessible location-specific result | Translate terrain and ephemerides into an understandable decision. [Official mission report](https://assets.spaceappschallenge.org/media/documents/SpaceApps2016_MissionReport.pdf) |
| 2017 | Radaway, Galactic Impact | Interviewed flight crew and framed radiation exposure around their understanding and decisions | Test whether intended users understand the survival result and can select a viable date. [Project](https://2017.spaceappschallenge.org/challenges/warning-danger-ahead/mayday-mayday-mayday/teams/radaway) |
| 2018 | iNON / ISDApp, Galactic Impact | Designed information access for fishermen using phones without smartphones or internet | Design around the audience's capabilities and constraints. For SUNLOCK, provide an immediately usable example and plain-language results. [Award record](https://2018.spaceappschallenge.org/awards/global-finalists/) · [Project](https://2018.spaceappschallenge.org/challenges/what-world-needs-now/globe-observer/teams/inon-1/) |
| 2019 | AEDES, Best Use of Data | Combined satellite, climate, and digital data into dengue forecasts and possible hotspots for public agencies | Explain who uses the output and what they do differently because of it. [Project](https://2019.spaceappschallenge.org/challenges/living-our-world/smash-your-sdgs/teams/aedes-project/) |
| 2020 | Monsoon Overflow, Best Use of Data | Combined satellite imagery with community reports for infrastructure damage assessment, including a flood case study | Demonstrate a complete scenario and compare outputs with a suitable reference. [Project](https://2020.spaceappschallenge.org/challenges/confront/flood-ideas/teams/monsoon-overflow/) |
| 2021 | Cambridge Asteroids / Voxteroid, Best Use of Data | Let users alter object shape, Sun angle, and rotation to generate light curves | Make the causal link between mission settings and resulting power visible. [Project](https://2021.spaceappschallenge.org/challenges/statements/when-light-curves-throw-us-curve-balls/teams/cambridge-asteroids/) |
| 2022 | Starflock / AirAware, Best Use of Data | Used FIREX-AQ measurements to investigate differences between agricultural and wildfire smoke | A focused scientific question and inspectable analysis can provide differentiation. [Project](https://2022.spaceappschallenge.org/challenges/2022-challenges/take-flight/teams/starflock-3/) |
| 2023 | LunarTech Ensemble, Science, and Spacebee, Technology | Both made Apollo lunar seismic data accessible through interactive experiences | Lunar visualization can win when scientific meaning is understandable through interaction. [NASA winners announcement](https://science.nasa.gov/directorates/smd/2023-nasa-international-space-apps-challenge-announces-10-global-winners/) |
| 2024 | AsturExplorers / Landsat Connect, Best Mission Concept | Connected a chosen location to satellite overpass timing and reflectance data | Site plus actionable timing is a strong product structure. [NASA winners announcement](https://www.nasa.gov/learning-resources/stem-engagement-at-nasa/nasa-international-space-apps-challenge-announces-2024-global-winners/) |
| 2025 | PureFlow, Best Mission Concept | Habitat design tool with user-selected crew, duration, destination, and feedback | Extend the existing lander model into an explicit design-and-check workflow. [Official award listing](https://www.spaceappschallenge.org/) · [Team's tool](https://larasdiniz.github.io/PureFlow-2025/src/public/html/home/home.html) |

The recurring product characteristics are a named user, substantive use of space data, a clear result, understandable interaction, and evidence appropriate to the claim. The sample includes prototypes and analytical work as well as functioning applications. A particular feature count, stack, use of AI, or terrain resolution cannot be inferred as a requirement for winning.

Current competitive context

Umbra's public repository describes terrain shadows, site filtering, ranked dates, parameter changes, comparisons, exports, and validation. It also claims local terrain for 41 landing locations. Those claims were read from the team's repository and were not independently rerun. SUNLOCK already has battery survival, sizing, heaters, panel orientation, mast height for Artemis sites, comparison, export, and date grids. Its next differentiator should be the reliability and usefulness of the decision under changed assumptions. [Umbra](https://github.com/daniel27-space/lunar-navigator)

Prioritized findings and fixes

1. **Critical — the same location produces conflicting results through normal entry points.**

   Live reproduction used 15 January 2027 at 00:00 UTC, 14 days, 100 W load, 4 m² tracking panels, 10 kWh battery, zero heater load, ground-level panels. Selecting de Gerlache Rim 2 at −88.45°, 292.1409° reports shadow, 30% minimum usable charge, and about 7.0 kWh minimum battery. Typing those coordinates rounds longitude to 292.141° and reports sunlight, 91% minimum charge, and 876 Wh minimum battery. At this latitude that longitude rounding is under a tenth of a metre. The custom route uses approximately 594 m terrain and about 59 km ray reach, while the named site uses 80 m terrain and 150 km rays.

   Fix the coordinate resolver so exact named locations use the same canonical site calculation. Preserve entered coordinate precision. For arbitrary points, use tiled terrain and the same horizon conventions and reach, with explicit resolution metadata. Until a detailed calculation completes, show the coarse result as a preliminary estimate with its own confidence status. Canonicalization must not silently snap genuinely different nearby coordinates to the named site.

   Acceptance requires identical named-site, typed-coordinate, share-link, and export results for identical coordinates and assumptions. The selected point must remain visible. Relevant code is `web/src/App.tsx` around `checkCoords` and `web/src/lib/terrain.ts` around `customHorizon`.

2. **Critical — the displayed minimum battery can fail when used.**

   The default named-site scenario above returns 7,006.08 Wh from `sizeToSurvive`. The UI formats this as 7.0 kWh. Running that displayed 7,000 Wh through the same simulator fails. The battery and panel minima are also independent calculations. Combining both exact minima fails in this scenario.

   Round a feasible recommendation upward to an input-supported increment and rerun that exact value before displaying it. Show battery-only and panel-only changes as separate alternatives, each retaining the other existing setting. If offering a joint design, evaluate that pair together. Add a configurable reserve requirement and report both the calculated threshold and the recommended design.

   Acceptance requires every displayed, applicable recommendation to pass when applied exactly. Relevant code is `web/src/lib/power.ts` around `sizeToSurvive` and `fmtEnergy`, plus the sizing card in `web/src/App.tsx`.

3. **Critical — partial solar visibility is converted into full available panel power.**

   `readSite` treats any visible solar limb as sunlit. `arrayPowerPerM2` then uses a boolean. A tracking array receives 342.972 W/m² whenever that boolean is true, including a Sun almost completely hidden by the local skyline. A flat skyline with the Sun centre 0.265° below it passes the current 0.266° visibility criterion and receives the same tracking output as a fully visible Sun. Heater load also switches off as soon as that boolean becomes true.

   Compute the visible fraction of the solar disc, preferably sampling the horizon across the disc where terrain varies with azimuth. Carry irradiance through the samples, simulation, sizing, date grid, and CSV. Preserve the NASA-map visibility definition for that particular validation. Use a separate configurable heater policy that does not turn off solely because the first sliver of Sun appears. NASA's lunar environment analysis explicitly models partial solar-disc illumination. [NASA lunar power reference](https://ntrs.nasa.gov/api/citations/20205002224/downloads/Lunar%20Environment%20and%20Lunar%20Power%20Needs_2.pdf)

   Acceptance includes zero, half, and full visible-disc cases, monotonic power as the Sun clears a flat skyline, and shared results across sizing and mission simulation.

4. **High — different recommendation surfaces optimize different objectives.**

   The site list ranks simulated survival, remaining battery, and long-run sunlight. The landing-window buttons use `findWindows`, which receives duration and visibility samples but no battery, heater, panel-area, or orientation settings. Its scoring formula includes an arbitrary constant power input of 0.6. The finder uses long-run NASA-map values, while the mission evaluates a specific date.

   Use one mission evaluator for actionable site/date recommendations, comparison, and export. Give it user requirements including reserve charge and maximum permitted Earth-visibility outage. Long-run maps can shortlist candidates, followed by date-specific evaluation. Explain a rejection with the failed requirement. Retain any purely environmental ranking under an explicit environmental label.

   Acceptance requires a recommendation to open exactly the scenario evaluated, satisfy all selected constraints, and show the same result in every view. Relevant code is `web/src/lib/analysis.ts` around `findWindows` and `web/src/App.tsx` around `rankKey`, `nextSurvivable`, and `porkchop`.

5. **High — the local finder loses the location that supplies its advertised metrics.**

   `build-finder.mjs` selects a sunniest 60 m pixel inside each roughly 300 m cell and stores sunlight, Earth visibility, and slope for that pixel. Its coordinates are discarded. `finder.ts` returns the 300 m cell centre, which is then analyzed through the coarse custom-point path. Selecting the brightest pixel before applying the user's slope and radio constraints can also discard a less sunny pixel that satisfies every requirement. The UI counts the entire 300 m cell area as passing although the retained measurements represent one spot.

   Preserve source-pixel coordinates and evaluate constraints on co-located pixels. Retain all relevant candidates, or a nondominated shortlist that preserves combinations of sunlight, radio, and slope. Re-evaluate the selected exact coordinate with the detailed horizon. Compute passing area at the tested pixel resolution, or label the result as coarse cells containing candidates. Keep landing footprint size and unresolved hazards explicit.

   Acceptance requires every shortlist coordinate to reproduce its advertised metrics at the stated resolution. Add a synthetic cell containing a sunny steep pixel and a slightly darker flat pixel to verify the feasible candidate is retained. This finding concerns the uncommitted local finder, which was absent from the live interface during inspection.

6. **High — Earth visibility is presented as a working radio link.**

   `comm` means some part of Earth's disc clears the skyline. The interface says connected and radio link open. The calculation contains no ground-station location, station availability, antenna pointing, link budget, or relay orbit. Mission survival also does not require any minimum contact availability.

   Label the current result as geometric Earth visibility. Add a user-selected maximum outage requirement to the mission evaluator. Use separate panel and antenna heights, or explicitly state a shared mast assumption. A deeper extension can add specified ground stations and link margins with cited assumptions. NASA identifies Earth visibility as one factor affecting direct-to-Earth communication. [NASA communications reference](https://www.nasa.gov/glenn/glenn-expertise-space-exploration/scan/lunar-surface-propagation/)

   Acceptance requires a zero-contact scenario to fail when the user requires direct Earth contact, while remaining valid for an explicitly autonomous or separately supported communications scenario.

7. **High — historical agreement does not yet establish the reliability of a mission decision.**

   Stored map-wide sunlight RMSE is 1.88 percentage points across 1,782 paired points. At 105 published landing points it is 6.8 points. These compare long-run averages. They do not directly test individual sunrise times, longest continuous darkness, or battery depletion on a particular fortnight. Per-region sites are selected partly by agreement with the same NASA map. Agreement on that selected subset is influenced by the selection rule. The larger 105-site evaluation remains relevant and should stay visible.

   Reserve geographically separate sites for evaluation, publish errors by terrain and latitude, and test event timing and continuous-dark intervals using an independently implemented reference where available. A model using the same DEM is an implementation check with shared terrain uncertainty. Keep test thresholds and reference versions fixed before inspecting outcomes. Report sunrise/sunset timing error, darkness-duration error, and disagreement in mission verdicts alongside average-illumination error.

   Acceptance requires held-out results and a clearly traceable relationship between the validation and the claims shown at the selected site. Relevant code is `web/scripts/select-sites.mjs`, `web/scripts/validate-lola.mjs`, and `web/public/terrain/validation.json`.

8. **High — uncertainty ranges do not propagate into survival.**

   The displayed sunlight range is the spread across four horizon/visibility conventions. It is not a probabilistic confidence interval, and it does not drive the battery verdict. The simulation assumes a fully charged battery, fixed efficiency, fixed system derate, constant main load, and an optional constant shadow-heater load.

   Offer explicit nominal and conservative scenarios. Vary arrival time, load, panel performance, initial charge, and available terrain/horizon alternatives within documented, user-adjustable bounds. Report whether all tested scenarios pass, whether results depend on assumptions, and which change causes failure. User-chosen scenario ranges must be labelled sensitivity assumptions. A fraction of tested cases is not a calibrated probability of mission success.

   Acceptance requires a deliberately marginal mission to change status under a plausible adverse scenario and the explanation to identify the relevant assumption.

9. **Medium — the battery depletion timestamp is one interval early in an exact test.**

   With 8,000 Wh usable charge, 100 W load, and darkness, depletion occurs after 80 hours. The current simulator reports 79.5 hours with half-hour samples because it consumes an interval's energy then assigns failure to its start. The existing test asserts that early timestamp.

   Define sample timestamps as interval starts and interpolate the crossing time from energy at the beginning of the interval and the net discharge rate. Align CSV charge timestamps and the plotted trace with that convention. Re-run event and boundary tests against analytical expectations.

10. **Medium — map and detail calculations use different illumination conventions.**

    The overview uses 16 azimuth bins, short terrain reach, quantized horizons, and a solar-centre threshold. Named-site details use 360 horizon values, much longer reach, and the solar-limb threshold. The map can therefore disagree with the detailed site result.

    Use the same visibility definition and mark the overview resolution clearly. Draw the selected-site state from the detailed calculation, with a local detailed inset if useful. Validate concordance at representative sites and explain remaining resolution differences at the point of use. Relevant code is `web/src/lib/terrain.ts` around `computeShadow`.

11. **Medium — terrain and scientific labels overstate some results.**

    The local finder says "Ice within" but uses distance to permanent shadow. This is a potential cold-trap proxy. It is not a measured ice deposit or a traversable route. A coarse slope likewise describes regional terrain and cannot establish lander-footprint safety. Outside the polar DEM, results use a smooth sphere. CSV model metadata currently gives a generic LOLA-horizon description even for those sphere-only locations. The method text also says there are no heater loads despite a working heater input.

    Name the measured quantity in the control, carry terrain coverage, resolution, height support, and horizon source into exports, and make the survival outcome explicitly an energy-model result. Add measured ice or thermal layers only with verified data provenance and a defined decision they affect. [NASA on polar ice evidence](https://science.nasa.gov/solar-system/moon/nasas-lro-lunar-ice-deposits-are-widespread/)

12. **Medium — year boundaries and nearest-future searches restrict otherwise valid missions.**

    The model uses one calendar year. Late-December missions cannot complete even when the next year is supported. The first survivable date is searched on a six-hour grid and only forward from the selected date. A no-result message currently says no date in the year works, which is broader than the search performed.

    Generate a padded ephemeris window extending through the longest mission plus the desired scheduling uncertainty. Refine the first passing six-hour interval to the supported event resolution. State the searched period and search resolution in the result. Test year-end, leap-year, and exact-final-interval missions.

13. **Medium — several evidence tests inspect saved numbers without rerunning the changed calculation.**

    `evidence.test.mjs` asserts thresholds in committed JSON. Those tests can remain green after a calculation changes while the JSON remains stale. The geometry and synthetic battery tests do execute code, but the battery timing test demonstrates that an incorrect expected result can also pass.

    Add a small independent numerical regression set that reruns the core pipeline. Bind large generated evidence files to source/configuration/data fingerprints. Keep analytical tests for energy and event times. For recommendation tests, apply the displayed value and check the result through the same user-facing path.

14. **Medium — interface and state handoff need focused user testing.**

    At the inspected 1280×720 viewport, the layout has three dense columns, small secondary text, and lower timeline controls extending below the first view. A six-step tour exists. Most controls are exposed before the user has chosen a task. Sharing encodes the core lander scenario but omits comparison selections and finder limits. The local finder performs a full million-cell classification and sort synchronously, creating a performance risk that was not benchmarked here.

    Start with a ready-to-run mission and one prominent result. Put detailed assumptions beside the result or behind an explicit edit action. Offer a baseline and revised scenario with the consequence stated in hours, energy, and contact outages. Persist comparison/finder state and model version in shareable scenarios. Measure cold start and control responsiveness on a phone and a modest laptop before choosing worker/caching changes. Use a worker for expensive calculations if measurements justify it.

    Suggested usability acceptance is that three unfamiliar users can identify the limiting factor, change one assumption, and explain why the recommendation changes without coaching. This is a proposed product test, not a competition requirement. No user study was conducted in this audit.

Recommended build sequence

| Order | Work | Completion evidence |
|---|---|---|
| 1 | Fix exact-location consistency, actionable sizing, and depletion timing | Named/typed/shared results agree. Every displayed fix passes when applied. Analytical depletion case returns 80 hours. |
| 2 | Introduce solar-disc irradiance and consistent heater handling | Partial-disc tests, energy checks, and rerun of all existing scenarios. |
| 3 | Consolidate site/date evaluation around energy reserve and chosen contact requirements | Window button, comparison, date grid, and export reproduce the same evaluation. |
| 4 | Repair finder source coordinates, constraint selection, and area semantics | Selected points reproduce source metrics and satisfy constraints at their stated resolution. |
| 5 | Add explicit sensitivity scenarios and schedule-slip comparison | A user can see which option still passes under every tested assumption and why. |
| 6 | Add independent regression cases, evidence fingerprints, complete scenario sharing, and three usability sessions | Reproducible saved scenarios and recorded task outcomes. |

The distinctive user journey should be concrete. A user enters a 14-day mission and a permitted radio outage, sees why the initial site/date is marginal, compares delaying arrival or changing the power design, and chooses an option that passes the selected adverse scenarios. The result should show the evaluated coordinates, date interval, minimum reserve, longest visibility outage, limiting condition, and assumptions. This extends capabilities already present and directly addresses the decision-oriented pattern in the historical examples.

Unverified work remains outside this audit's claims. Rival models were not rerun, the full long-duration NASA comparison was not regenerated, mobile performance was not measured, and no real users or flight planners were interviewed. No application source was edited as part of this analysis.

---

## Status after the fix pass (15 Nov 2026, local build, not yet deployed)

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | Same coordinates, conflicting answers | **Fixed** | Typing −88.45, 292.141 now resolves to de Gerlache Rim 2 (same spot within 5 m) and shows the identical verdict, sizing and sunlight state, with a note saying so. Other points keep 5-decimal precision, use a bilinear coarse horizon with the same 150 km reach, and are labelled **Preliminary**. Detailed 80 m tiles for arbitrary points remain future work. |
| 2 | Recommended battery can fail | **Fixed** | Sizing finds the threshold, rounds to the input step (100 Wh / 0.1 m²), re-runs that exact value and climbs until it passes. Battery-only and panel-only fixes are separate, each with a "Use" button. Checked in the browser: applying 7.3 kWh, 0.3 m² and 27.2 kWh through the controls all survive. Tests check that the displayed value passes and the step below fails. |
| 3 | A sliver of Sun gives full power | **Fixed** | Visible solar-disc fraction (0 → 0.5 → 1) drives panel power in every path. Heaters run while less than half the disc is up. Tests cover none/half/full and monotonic power. The NASA any-part definition is kept only for the visibility comparison. |
| 4 | Best windows ignore lander settings | **Fixed** | Landing dates, earliest survivable date, ranking, date grid, comparison, stress test, sizing and exports all call the one `simulateMission`. The earliest date is refined to 30 minutes, and the searched range is stated. |
| 5 | Finder advertises one point, opens another | **Fixed** | Each ~600 m cell keeps three candidate 60 m spots (sunniest; sunniest ≤ 8°; sunniest ≤ 4°) with their exact pixel. Distance to permanent shadow is computed per 60 m pixel (exact EDT). The stat reads "cells containing a passing 60 m spot". A test reproduces NASA's raster value at each stored pixel and confirms flatter spots are kept. |
| 6 | "Connected" overstates radio | **Fixed** | Relabelled "Earth in view / hidden". An optional "Longest time without Earth in view" requirement fails the mission with an explanation. A test shows a zero-contact mission fails only when contact is required. |
| 8 | Uncertainty does not reach the verdict | **Fixed for the tested cases** | Eight cases: as planned; 6 h / 1 d / 3 d late; −20% panel output; +20% load; 80% initial charge; and a **terrain case** that raises the skyline until this year's sunlight drops by 6.8 points, our measured RMS disagreement with NASA at the 105 published sites. The card names the **limiting condition** (earliest failure) and the **single changes that pass every case**: a later landing time, the smallest battery, the smallest panel area, other NASA sites on the same date, and **nearby positions 1–2 km away** (8 directions). Every alternative is run on all 8 cases with a terrain case calibrated on that exact spot (a test checks each site's drop is 6.8 ± 0.15 points and that raising hills never adds sunlight). Each nearby position has its own full 80 m LOLA skyline, computed with the same code as the named sites (`npm run nearby`, which first checks it reproduces every site's shipped skyline within 0.01°); slope there is not checked. A nearby position opens, and shares by link (`near=`), with the same skyline it was judged on. Example (2027, default lander): de Gerlache Rim 2 on 15 Feb passes 5/8; the 14.5 kWh battery gives 8/8; Malapert Massif is the only other site that passes all 8 once each site's own terrain case is included (Haworth and Mons Mouton drop out); all 16 nearby positions see less Sun over the year, yet 1 km north-east, 2 km north and 2 km north-east pass this window, and applying 1 km north-east shows 8/8, also after reloading its link. |
| 9 | Depletion timestamp one step early | **Fixed** | Interpolated within the step; the analytical 80 h case returns exactly 80 h. |
| 10 | Map and detail use different Sun criteria | **Fixed (criterion)** | The map now also uses any part of the disc. Its 16-direction, 19 km horizon remains coarser and is labelled in the method text. |
| 11 | Labels overstate | **Fixed** | "Ice within" became "Permanent shadow within"; CSV states the horizon source per site and the timestamp convention; the method text describes heaters. |
| 12 | Year-end missions cut off | **Fixed** | The data runs 31 days past 31 December; late-December landings are evaluated. |
| — | Reserve requirement (from #2) | **Added** | "Battery reserve to keep" (0/10/20/30%) joins the requirements and sizing. |
| 7 | Validation of events, not just averages | **Partly** | New regression fixture from NASA JPL Horizons (90 days, hourly): sunrise and sunset times of the Sun's upper limb on a flat horizon match within 0.2 min at Apollo 11 and within ~10 min at de Gerlache Rim 2 (the Sun crawls along the horizon there; tests allow 2 and 20 min). Held-out terrain sites and darkness-duration checks against an independent terrain model remain open. |
| 13, 14 | Evidence fingerprints, user testing | **Open** | Not attempted in this pass. |

### Second review pass (15 Nov 2026, evening)

| Gap | Status | Evidence |
|---|---|---|
| Earliest-landing search skipped short windows (6-hour scan, refined only after a hit) | **Fixed** | `earliestSurvivable` checks every half-hour start; the robust "land later" option checks every start too (late-arrival cases are screened exactly with one pass of the nominal mission). Test: a series where only starts 100–101 survive is found at 100, and every 6-hour start fails. Worst case on real data (30-day mission, nothing survives): 35 ms. |
| Missing stress results counted as passes | **Fixed** | `allCasesPass` requires every case to be evaluated and to survive; a case past the data shows "? unknown" and the plan is not shown as passing. The data now runs 34 days past the year (30-day mission + 3-day late case + 1 day), so no landing in the year has an unknown case. Test covers both. |
| CSV said "battery dies" for every failure | **Fixed** | The CSV (now `src/lib/export.ts`) states the actual reason (Earth hidden longer than the limit, battery reaching zero or the reserve), the time, initial charge, reserve, maximum Earth outage, lowest charge, longest outage and every stress case. Compare table, date-grid tooltips, legend and mission brief now distinguish Earth failures. Test checks an Earth-failure export. |
| Finder kept only three spots per cell | **Fixed** | Each cell keeps every 60 m spot not beaten on Sun, Earth, slope and shadow distance (at the sliders' steps) by a spot that ranks at least as high: 864,369 spots, mean 3.3 and max 30 per cell, 6.2 MB (4.1 MB gzipped). The build brute-forces 108,120 random limit sets on sampled cells against every pixel and stops if any answer differs; none does. A test checks no kept spot is redundant. |
| Nearby positions and the terrain case lacked independent validation | **Validated; one method rejected** | `npm run validate:nearby` (result in `research/validation/nearby.json`) compares, at 144 nearby points, the first-pass shortcut (site skyline adjusted by our ~600 m grid) and a full 80 m skyline at the point against NASA's 18.6-year sunlight (AVGVISIB_85S_060M_201608, 96 points inside its 85–90°S coverage). **The shortcut failed**: r = 0.17, bias +12.8 points, RMSE 21.7; only 35% of the landings it would have offered (647 of 1,869) also passed on the full skyline. **Full skylines agree with NASA**: r = 0.961, bias −0.03 points, RMSE 3.8, 90 of 96 within 5 points. The app now ships full skylines for every nearby position (`web/public/terrain/nearby.json`, 289 kB). The terrain case (−6.8 points) is exceeded by our real error (our sunlight above NASA's by more than 6.8 points) at 4.8% of the 105 published sites and at 2 of the 96 nearby points. These points were not used to choose any method or parameter. Not yet done: comparison of event timing with an independent terrain model (NASA's product is a long-run average, not a time series). |

Build sequence: steps 1–5 done. Step 5's decision-level tests (`web/tests/decisions.test.mjs`) run on real site data: every offered battery, landing time and site passes all 8 cases when applied, and 100 Wh less fails. Step 6 (held-out terrain validation, evidence fingerprints, three usability sessions) is open.

Tests: 48 pass (lint clean, production build passes).
