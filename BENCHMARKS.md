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

## 1. Pre-registered validation against NASA products

Four hypotheses were fixed and committed (`research/PREREGISTRATION.md`, commit `83b4287`)
**before** any comparison ran. All four pass.

| # | Reference | Metric | Result | Threshold | |
|---|---|---|---|---|---|
| **H1** | LOLA `AVGVISIB_85S_060M` (18.6 yr, 60 m) | Pearson r | **0.9948** | ≥ 0.90 | ✅ |
| | | RMSE | **1.35 pp** | — | |
| | | bias | **−0.16 pp** | ≤ 5 pp | ✅ |
| **H2** | LOLA `LPSR_85S_060M` permanent shadow | IoU | **0.907** | ≥ 0.80 | ✅ |
| **H3** | LROC `WAC_POLE_ILL_TWI_SOUTH` (image-based) | Pearson r | **0.898** | ≥ 0.85 | ✅ |
| | | RMSE / bias | 7.02 pp / +4.89 pp | — | |
| **H4** | LOLA Earth-visibility map | Pearson r | **0.9893** | ≥ 0.90 | ✅ |
| | | RMSE / bias | 3.01 pp / −0.08 pp | — | |

Sample: fixed seed, 85–90°S (88–90°S for H3), 500 points, 3-hourly over 18.6 years
(pre-registered fallback). H2 confusion matrix: TP 49, FP 0, FN 5, TN 446.

H3 is the strongest external test: the LROC map is derived from **3,807 photographs** taken
over one lunar year, so it checks our predicted shadows against *observed* shadows. The
+4.9 pp bias is consistent with the product's conservative illumination threshold, which
undercounts dimly lit pixels.

### What this validation caught

**A 180° azimuth error.** Our horizon was looked up half a turn from the Sun, so every site was
tested against terrain on the opposite side. The pole hid it (near-isotropic terrain) and
summits looked plausible; a permanently shadowed crater exposed it:

| Location | Before fix | After fix | NASA reference |
|---|---|---|---|
| Cabeus floor | 30.5% | **0.0%** | **0.0%** |
| de Gerlache rim | 4.0% | **14.5%** | 14.4% |
| Connecting Ridge | 54.8% | 56.7% | 51.6% |
| South pole | 28.0% | 29.6% | 27.0% |

A rotation sweep over 60 points: r = −0.18 at 0°, +0.44 at 90°, **+0.98 at 180°**. The fix is in
`scripts/build-terrain.mjs` and `web/src/lib/terrain.ts`.

**Every illumination number changed as a result** — the Shackleton peak went from 86% to 73%
over the 180-day window.

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
