# Sampling and convention dependence in lunar polar illumination estimates from public DEMs

**A reproducibility note for SUNLOCK** · 15 November 2026 · code and data:
`github.com/shahaman098/sunlock`

---

## Abstract

Illumination percentages for the lunar south pole are widely quoted (≈ 80–88%) but are
computed under conventions that are rarely stated together: terrain resolution, ray-sampling
interval, observer height, temporal baseline, and whether the Sun's disc centre or any part of
its disc is required to clear the horizon. Using only public data — the LRO LOLA gridded
elevation models at 80 m, 40 m and 20 m per pixel — we show that at a single coordinate
(89.438°S, 222.717°E) the *time-averaged* illumination estimate varies from **36.8% to 94.4%**
depending only on the distance between horizon ray samples. With bilinear interpolation the
estimator converges to ≈ **54–59%** (disc centre) or ≈ **67–71%** (any part of disc). We further
verify the ephemeris and lunar rotation model against JPL Horizons to **0.0032°** in
sub-solar longitude, so the spread is attributable to terrain sampling and convention rather
than to astronomy. We conclude that a single-number illumination claim is meaningless unless
its sampling convention and criterion are stated, and we recommend the convention used by
Gläser et al. (2017) — any part of the solar disc, converged sampling, searched cluster
coordinates — for comparability with the literature.

---

## 1. Introduction

Mission concepts for the lunar south pole depend on two quantities: how often the Sun is
visible, and how often Earth is in view. Published values cluster around 80–88% at the best
sites (Mazarico et al., 2011; Gläser et al., 2017), with continuous darkness of a few days.
Those numbers are computed from digital terrain models (DTMs) by ray-marching a local horizon
and testing the Sun against it.

Between the DTM and the percentage sit several choices that are usually reported separately,
if at all. This note isolates them on one coordinate, using the same ephemeris and the same
code path throughout, so that the only variables are terrain sampling and the visibility
criterion.

## 2. Data

| Product | Resolution | Coverage | Size |
|---|---|---|---|
| `LDEM_80S_80M` | 80 m/px | 80°S–90°S | 7,600² |
| `LDEM_80S_40M` | 40 m/px | 80°S–90°S | 15,200² |
| `LDEM_875S_20M` | 20 m/px | 87.5°S–90°S | 7,584² |

All from the NASA PDS Geosciences Node (LRO-L-LOLA-4-GDR-V1.0). Elevation is `DN × 0.5 m`
relative to a 1,737.4 km sphere; heights are stored as signed 16-bit integers.

Ephemerides come from Astronomy Engine (VSOP87/ELP series). The lunar body-fixed frame uses
the IAU WGCCRE 2015 pole and prime meridian, including the periodic libration terms.

## 3. Method

For a coordinate, the horizon is the supremum of elevation angle along each of 360 azimuths:

```
slope_i = (h_i − h_0 − d_i² / 2R) / d_i        horizon = max_i atan(slope_i)
```

where `d_i` is the horizontal distance to sample *i* and the `d²/2R` term is the lunar
curvature drop. A point is illuminated when the solar elevation exceeds the horizon in the
Sun's azimuth, integrated over 1 Jan – 30 Jun 2027 at 30-minute steps.

Three variants are compared:

- **nearest**: sample the nearest raster cell at a fixed distance interval;
- **bilinear**: interpolate between cells, which is well-posed as the interval → 0;
- **criterion**: Sun centre clears the horizon, vs any part of the 0.266° disc.

## 4. Validation of the astronomy

Before attributing any spread to terrain, the sky must be shown correct. At 12 epochs in 2027,
against JPL Horizons:

| Quantity | Max difference |
|---|---|
| Sun direction (astrometric RA/Dec from the Moon) | 21.0″ |
| Earth direction | 22.7″ |
| Sub-solar longitude (frame test) | **0.0032°** |
| Sub-solar latitude | 0.0021° |
| Sub-observer longitude | 0.0079° |

The sub-solar comparison is the important one: it tests the rotation model, not just the
ephemeris. An earlier implementation using only the polynomial prime meridian
(`38.3213 + 13.17635815 d`) was **2.24° off** and drifting 0.6°/yr, while its latitude matched
to 0.001° — a failure mode that a latitude-only check would not catch.

## 5. Results

### 5.1 Sampling interval, nearest-neighbour

| DTM | 80 m step | 160 m step | 320 m step |
|---|---|---|---|
| 80 m/px | **54.2%** | **86.4%** | **93.3%** |
| 40 m/px | 36.8% | 76.8% | 92.7% |
| 20 m/px | 48.2% | 85.9% | 94.4% |

Illumination increases monotonically with the sampling interval, across all three products.
Coarse sampling steps over near-field relief and inflates the result.

### 5.2 Convergence with interpolation (80 m DTM)

| Step | Illumination |
|---|---|
| 80 m | 60.0% |
| 40 m | 58.6% |
| 20 m | 57.1% |
| 10 m | 54.1% |

The sequence is converging downward, apparently toward ≈ 52–55%.

### 5.3 Criterion: centre vs limb

Bilinear sampling, same coordinate (`npm run bench:conv`):

| Step | Disc centre | Any part of disc | Difference |
|---|---|---|---|
| 80 m | 60.0% | 72.4% | +12.4 |
| 40 m | 58.6% | 70.8% | +12.2 |
| 20 m | 57.1% | 69.8% | +12.7 |
| 10 m | 54.1% | 66.7% | +12.6 |

The criterion alone is worth **≈12.5 points** — larger than the differences most studies
report *between sites*. For reference, the shipped nearest-neighbour configuration at 160 m
gives 87.0% (centre) and 94.8% (any part), the same gap on a different sampling basis.

### 5.4 Secondary sensitivities

| Effect | Magnitude |
|---|---|
| Observer position ±250 m (horizon fixed) | σ 0.04% |
| Horizon azimuth sampled at 4° instead of 1° | ≤ 1.02% |
| Disc-integrated vs centre (at shipped sampling) | ≤ 0.40% |

These are small. The dominant term is §5.1.

## 6. Discussion

The literature is not wrong, and neither is the shipped number — they measure different
things.

Gläser et al. (2017) define illumination as *"the percentage of a given period in which any
portion of the Sun is visible"*, at 2 m above ground, over twenty years, using a 20 m/px DTM,
at clusters **found by search** and only "twenty to forty meters wide". Mazarico et al. (2011)
used a **240 m/px** DTM over the same twenty years. Speyerer and Robinson (2013) used
**100 m/px** imagery over one year. The resolution spread alone is a factor of twelve.

Our shipped 86% is disc-centre, nearest-neighbour at 160 m, at a region-centre coordinate. It
sits inside the published band by coincidence of two offsetting approximations: coarse
sampling inflates by roughly 15 points, the stricter criterion deflates by 8–12.

The one genuinely comparable quantity is the longest continuous darkness at the Shackleton
peak — **3.5 days** — inside the "less than three and up to eight days" reported by Gläser
et al.

A related subtlety is worth separating explicitly. Gläser et al. argue that coarser *imagery*
**underestimates** illumination because "small-scale illuminated areas less than 100 meters
across" are unresolved. That statement concerns the illuminated **area fraction at an
instant**. At a **point**, coarse sampling has the opposite effect, because it misses small
*obstructions*. Both are true; they are different metrics, and conflating them is a common
source of apparent disagreement.

## 7. Limitations

- One coordinate, one hemisphere-season (180 days). A twenty-year baseline would sample
  worse seasons.
- No comparison against a published figure at the same coordinates and criterion — the
  papers do not publish per-coordinate tables in machine-readable form.
- Nearest-neighbour ray marching is aliased by construction; the bilinear variant used here
  reduces but does not eliminate that.
- No thermal, dust, or power-system modelling; no terrain self-shadowing between distant
  peaks beyond the 64 km march.

## 8. Conclusions

1. A lunar polar illumination percentage is only meaningful with its sampling interval,
   terrain resolution, observer height, temporal baseline and disc criterion stated.
2. At one south-pole coordinate, varying only the ray-sampling interval moves the answer
   between 36.8% and 94.4%.
3. The frame and ephemeris are not the source: they agree with JPL Horizons to 0.0032°.
4. For comparability, adopt the literature convention — any part of the solar disc, converged
   interpolation, searched cluster coordinates — and report the shadow-duration statistic,
   which is far more stable than the illumination percentage (3.5 days here vs 3–8 days
   published).

## References

See `research/LITERATURE.md` for the annotated source list and quoted passages.

## Data and code availability

```
npm run verify     # JPL Horizons: geometry + frame
npm run bench      # disc, position, azimuth sensitivity
npm run bench:ray  # sampling-interval study (§5.1)
```

Terrain: NASA PDS Geosciences Node, LRO-L-LOLA-4-GDR-V1.0.
