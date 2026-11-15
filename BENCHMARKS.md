# Benchmarks and validation

Everything here is produced by committed scripts against the modules the app ships.
**Re-run date: 15 Nov 2026, after the azimuth fix described in §1.**

```bash
cd web
npm run validate   # map-wide comparison against NASA's LOLA visibility product
npm run verify     # JPL Horizons: geometry + frame
npm run bench      # disc, position, azimuth sensitivity
npm run bench:ray  # ray-sampling interval study
npm run bench:conv # convergence + disc-criterion study
```

---

## 1. Map-wide validation against NASA's own reference product

The decisive test. We compare our illumination field with the LOLA team's published
average visibility map (`AVGVISIB_85S_060M_201608`, PGDA product 69): 18.6 years of
hourly illumination at 60 m/pixel, computed by Mazarico et al. from their own terrain —
an independent pipeline from ours.

Sample: fixed seed, 85°S–90°S, 451 paired points after dropping permanent shadow.

| Metric | Value | Pre-registered threshold |
|---|---|---|
| Pearson r | **0.995** | ≥ 0.90 ✓ |
| RMSE | **1.36 pp** | — |
| Mean bias | **−0.15 pp** | \|bias\| ≤ 5 ✓ |

Bias by illumination band: −0.10 pp (0–20%), −0.19 pp (20–50%). The agreement holds
across the range, not just in aggregate.

The shipped sampling convention (nearest-neighbour, 160 m step, 64 km reach) measures
r = 0.991, RMSE 1.79 pp on 270 points — slightly weaker, still far inside the threshold.

### What this validation caught

**A 180° azimuth error.** Our horizon was being looked up half a turn from the Sun's
azimuth, i.e. every site was tested against the terrain on the *opposite side*. The map is
broadly symmetric enough that this looked plausible: the south pole itself was unaffected
(6% change), but a permanently shadowed crater floor is decisive.

At 84.9°S 35.5°W (Cabeus):

| | Before fix | After fix | NASA reference |
|---|---|---|---|
| Illumination | 30.5% | **0.0%** | **0.0%** |
| de Gerlache | 4.0% | **14.5%** | 14.4% |
| Connecting Ridge | 54.8% | 56.7% | 51.6% |
| Pole | 28.0% | 29.6% | 27.0% |

Across 60 test points the correlation with the reference rose from **−0.18 to +0.98** when
the lookup was rotated 180°. The fix is applied in `scripts/build-terrain.mjs` and
`web/src/lib/terrain.ts`.

**Every illumination number in this repository changed as a result.** The peak near
Shackleton went from 86% to 73% over the 180-day window.

---

## 2. Against JPL Horizons (unchanged by the fix)

Twelve epochs, Horizons API.

| Quantity | Max difference |
|---|---|
| Sun direction (astrometric RA/Dec from the Moon) | 21.0″ |
| Earth direction | 22.7″ |
| Sub-solar longitude (frame) | **0.0032°** |
| Sub-solar latitude | 0.0021° |
| Sub-observer longitude | 0.0079° |

The frame test is the important one: an earlier implementation using only the polynomial
prime meridian was 2.24° off and drifting 0.6°/yr, while its latitude matched to 0.001°.

---

## 3. Sensitivity (recomputed after the fix)

| Effect | Magnitude |
|---|---|
| Finite solar disc vs centre-of-disc | ≤ 0.26% |
| Landing point moved ±250 m (horizon fixed) | σ ≤ 0.08% |
| Horizon azimuth sampled at 4° instead of 1° | ≤ 0.24% |
| Ray interval 80 → 320 m (nearest-neighbour) | 60.6% → 81.8% |

The first three are negligible. The fourth is real and is *sampling* sensitivity, not a bug:
coarser ray intervals step over ridges and inflate sunlight. The shipped choice (160 m, 2 px)
is the one that scores r = 0.991 against NASA, which is the empirical justification for it.

### Convergence with bilinear sampling

| Step | Disc centre | Any part of disc |
|---|---|---|
| 80 m | 58.2% | 63.8% |
| 40 m | 58.2% | 62.8% |
| 20 m | 57.7% | 62.1% |
| 10 m | 55.8% | 61.8% |

Stable to a couple of points — much better behaved than the pre-fix measurements, which
mixed a rotated horizon into the comparison.

---

## 4. What is *not* validated

- **LROC WAC image-based comparison** (planned as H3) is not done. The image-derived
  product is a stronger truth set than altimetry, because it records real shadows.
- **Permanent-shadow IoU** (H2) is not computed as a separate statistic; the map
  comparison already includes shadowed points, but an explicit confusion matrix is missing.
- **Earth-visibility map comparison** (H4) is not run, although the same machinery applies.
- No thermal, dust or power-system model. Array output is first-order.
- Physical libration enters only through the IAU series; no SPICE cross-check.

Each is a named next step with a dataset attached, not a hand-wave.
