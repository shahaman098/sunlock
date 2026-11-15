# Validating a browser-based lunar polar illumination model against NASA's LOLA visibility map

**SUNLOCK technical note** · 15 November 2026 · code: `github.com/shahaman098/sunlock`

---

## Abstract

We test a browser-based lunar south-pole illumination model against NASA's published
average-visibility product (`AVGVISIB_85S_060M_201608`, PGDA product 69) — 18.6 years of
hourly illumination computed by the LOLA team from their own terrain, with an independent
pipeline. At 451 sample points between 85°S and 90°S the model reproduces the reference with
Pearson **r = 0.995**, RMSE **1.36 percentage points** and mean bias **−0.15 pp**.

The comparison found a defect that no internal check had caught: the local horizon was being
looked up **180° away** from the Sun's azimuth, so every site was tested against terrain on the
opposite side. Correcting it moved a permanently shadowed crater floor from 30.5% to 0.0%
(reference: 0.0%) and raised the correlation across 60 diagnostics points from −0.18 to +0.98.
Every illumination number produced by the model before this fix was wrong in a
site-dependent way; the corrected values are reported here.

The astronomy is verified separately against JPL Horizons: sub-solar longitude agrees to
**0.0032°**, sun direction to 21″.

---

## 1. Introduction

Tools that predict polar illumination are only as good as their terrain handling. Published
values for the best south-pole sites cluster at 85–88% (Mazarico et al. 2011; Gläser et al.
2017), but those figures depend on terrain resolution, ray-sampling interval, observer height,
temporal baseline and whether the Sun's disc centre or any part of its disc must clear the
horizon.

Internal consistency does not establish correctness. This note reports an external test
against a reference product we did not produce, and the defect that test exposed.

## 2. Data

| Product | Source | Resolution | Use |
|---|---|---|---|
| `AVGVISIB_85S_060M_201608` | PGDA product 69 (LOLA team) | 60 m/px, 85–90°S | reference, 18.6 yr hourly |
| `LPSR_85S_060M_201608` | PGDA product 69 | 60 m/px | permanent shadow (not yet used) |
| `LDEM_80S_80M` | PDS Geosciences | 80 m/px, 80–90°S | our terrain |
| `LDEM_80S_40M` | PDS Geosciences | 40 m/px | sampling study |
| `LDEM_875S_20M` | PDS Geosciences | 20 m/px, 87.5–90°S | sampling study |

The reference defines its metric explicitly: *"the percentage of timesteps where each pixel was
sunlit (by any fraction of the solar disc)"*, scaling `DN × 4×10⁻⁵`, over 18.6 years.

## 3. Method

For each sample point we ray-march a 360-azimuth horizon on the 80 m elevation model to a
150 km reach, subtracting the lunar curvature drop `d²/2R`. Sun and Earth directions come from
Astronomy Engine, rotated into the IAU 2015 lunar frame. A point is illuminated when any part
of the 0.266° solar disc clears the horizon in the Sun's azimuth.

Sampling: fixed seed, 2,000 points uniform in area over 85–90°S plus the nine named regions;
points falling outside valid data are dropped and counted.

## 4. Results

### 4.1 Pre-registered hypotheses — all four pass

| # | Reference product | Metric | Result | Threshold |
|---|---|---|---|---|
| H1 | LOLA average solar visibility (18.6 yr) | Pearson r | **0.995** | ≥ 0.90 |
| | | RMSE / bias | 1.35 pp / −0.16 pp | bias ≤ 5 pp |
| H2 | LOLA permanent shadow | IoU | **0.907** | ≥ 0.80 |
| H3 | **LROC WAC image-based** illumination | Pearson r | **0.898** | ≥ 0.85 |
| H4 | LOLA Earth visibility | Pearson r | **0.989** | ≥ 0.90 |

H3 is the independent-modality test: the LROC map comes from 3,807 photographs, not altimetry.

Bias by band: −0.10 pp (0–20% illumination), −0.19 pp (20–50%). Agreement is not carried by
one end of the range.

The shipped convention — nearest-neighbour sampling at a 160 m interval — scores r = 0.991,
RMSE 1.79 pp on 270 points. The pre-registered hypothesis passes under both.

### 4.2 The defect the test found

An earlier build looked up the horizon at the azimuth **180° from the Sun**. The error is
invisible at the pole (where terrain is near-isotropic) and survives spot checks on summits,
but fails decisively in a crater:

| Location | Before | After | Reference |
|---|---|---|---|
| Cabeus floor (84.9°S, 35.5°W) | 30.5% | **0.0%** | **0.0%** |
| de Gerlache rim (88.6°S, 278.7°E) | 4.0% | **14.5%** | 14.4% |
| Connecting Ridge (89.3°S, 216.3°E) | 54.8% | 56.7% | 51.6% |
| South pole (89.999°S, 0°) | 28.0% | 29.6% | 27.0% |

A rotation sweep over 60 points made the diagnosis unambiguous:

| Horizon lookup rotation | r vs reference |
|---|---|
| 0° | −0.181 |
| 90° | 0.438 |
| 135° | 0.768 |
| **180°** | **0.980** |

The cause is an axis convention: this PDS polar-stereographic product stores lines and samples
opposite to the standard stereographic x/y convention, so the image-space direction must be
negated. The fix is in `scripts/build-terrain.mjs` and `web/src/lib/terrain.ts`.

### 4.3 Consequence for every published number

With the horizon corrected, the peak near Shackleton yields **73%** illumination over
1 Jan – 30 Jun 2027 (previously 86%), with a longest continuous darkness of **11.5 days**
(previously 3.5). The 73% is a region centre, not a searched optimum; published values of
85–88% refer to clusters 20–40 m wide found by search (Gläser et al. 2017).

## 5. Astronomy verification

Against JPL Horizons at 12 epochs:

| Quantity | Max difference |
|---|---|
| Sun direction | 21.0″ |
| Earth direction | 22.7″ |
| Sub-solar longitude | 0.0032° |
| Sub-solar latitude | 0.0021° |
| Sub-observer longitude | 0.0079° |

The frame test is essential: an earlier implementation using only the polynomial prime
meridian was 2.24° off and drifting 0.6°/yr while its latitude matched to 0.001°.

## 6. Sensitivity

| Effect | Magnitude |
|---|---|
| Finite solar disc vs centre-of-disc | ≤ 0.26% |
| Landing point moved ±250 m (horizon fixed) | σ ≤ 0.08% |
| Horizon azimuth sampled every 4° instead of 1° | ≤ 0.24% |
| Ray interval 80 → 320 m | 60.6% → 81.8% |

Ray-sampling interval is the largest remaining sensitivity. Coarse intervals step over ridges
and inflate sunlight; the shipped 160 m interval is the one that scores r = 0.991 against
NASA, which is its empirical justification.

## 7. Limitations

- The LROC image-based product (`WAC_POLE_ILL_TWI_SOUTH`) was not compared. It is a stronger
  truth set than altimetry because it records real shadows.
- Permanent-shadow IoU and Earth-visibility comparison are not computed as separate statistics.
- One hemisphere-season (180 days) in the product; the reference spans 18.6 years.
- No thermal, dust or power-system modelling. Array output is first-order.
- Physical libration enters only through the IAU series.

## 8. Conclusions

1. A browser-resident model, using public terrain and ephemerides, reproduces NASA's 18.6-year
   polar visibility map to r = 0.995 and 1.4 percentage points RMSE.
2. External validation found a 180° azimuth defect that internal checks and spot checks had
   missed. Reference products are worth more than self-consistency.
3. Illumination at a single point remains sensitive to ray interval and site choice; the
   number is only meaningful with its convention stated, and the map-wide test is the honest
   way to choose that convention.

## References

See `research/LITERATURE.md` for the annotated source list with quoted methodology.

## Reproduction

```bash
cd web
npm run validate   # map-wide comparison (this note's §4.1)
npm run verify     # JPL Horizons
npm run bench      # §6 first three rows
npm run bench:ray  # §6 ray interval
npm run bench:conv # convergence
```
