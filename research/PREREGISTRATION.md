# Pre-registration — validation against NASA reference illumination products

**Written and committed before any comparison was run.** 15 Nov 2026, 00:5x GMT.
Commit order in `git log` is the evidence that this preceded the analysis.

## Purpose

Test whether SUNLOCK's illumination and Earth-visibility model reproduces NASA's own
published reference maps, rather than merely being internally consistent.

## Reference products (independent of our pipeline)

| ID | Product | Resolution | Coverage | Definition |
|---|---|---|---|---|
| LOLA-PGDA-69 | `AVGVISIB_85S_060M_201608` | 60 m/px | 85°S–90°S | average solar visibility over 18.6 yr, hourly |
| LOLA-PGDA-69 | `LPSR_85S_060M_201608` | 60 m/px | 85°S–90°S | permanent shadow (binary) |
| LOLA-PGDA-69 | `AVGEARTH_85S_060M_201608` (name to confirm) | 60 m/px | 85°S–90°S | average Earth visibility |
| LROC | `WAC_POLE_ILL_TWI_SOUTH` | 100 m/px | 88°S–90°S | time-weighted illumination from 3,807 WAC images, 15 Feb 2010 – 5 Feb 2011 |

Terrain: `LDEM_80S_80M` (80 m/px), the same product the app ships.

## Hypotheses and acceptance criteria

| # | Hypothesis | Acceptance |
|---|---|---|
| H1 | Our solar visibility reproduces `AVGVISIB` | Pearson **r ≥ 0.90** and **\|bias\| ≤ 5 percentage points** |
| H2 | Our permanent-shadow mask reproduces `LPSR` | intersection-over-union **≥ 0.80** |
| H3 | Our illumination reproduces the LROC WAC map over its own year | **r ≥ 0.85** |
| H4 | Our Earth visibility reproduces the LOLA Earth-visibility map | **r ≥ 0.90** |

H3's threshold is lower a priori because the WAC product is built from a finite image set and
its near-zero values inside shadow are contaminated by scattered light.

## Sampling

- **Seed:** 20261511 (fixed before running).
- **N:** 2,000 random points uniformly in area within 85°S–90°S, plus the 9 named regions.
- Points falling outside the reference raster or outside valid data are dropped and counted.
- Sampling is fixed now; the same points are used for every hypothesis.

## Method (fixed before results)

- Horizon: 360 azimuths, 64 km reach, lunar curvature drop `d²/2R` subtracted.
- **Two conventions are evaluated and both reported:**
  - *shipped*: nearest-neighbour, 160 m step;
  - *converged*: bilinear interpolation, 40 m step.
  If the two disagree, the one that agrees with the reference is adopted and the change is
  documented as a decision, not a post-hoc choice of metric.
- Temporal integration: **hourly over 18.6 years** (163,000 steps) if the run completes in
  under 30 minutes. Pre-registered fallback: **3-hourly** (54,000 steps), stated explicitly in
  the results if used.
- Visibility criterion: **fraction of the solar disc above the skyline** (disc radius 0.266°),
  matching the LOLA product's finite-disc definition. Disc-centre results are reported as a
  secondary column.
- Earth visibility: same machinery with Earth's angular radius (0.95°).

## Metrics (fixed)

Pearson r, RMSE, mean bias (ours − reference), and IoU for the binary product. Report overall
and split into illumination bands (0–20%, 20–50%, 50–80%, 80–100%) because compression at the
extremes can hide disagreement in the middle.

## Commitment

- **Failed hypotheses are reported as failures**, with the numbers, and are not dropped,
  redefined, or replaced by a different metric.
- Any deviation from this plan is listed in the results with its reason.
- No metric or threshold is changed after seeing results.

## Out of scope

Thermal and dust physics; 5 m terrain products; any claim not supported by a computed number.
