# Benchmarks, validation, and one unresolved accuracy issue

Everything here is produced by committed scripts against the modules the app ships.

```bash
cd web
npm run verify     # JPL Horizons: geometry + frame
npm run bench      # solar disc, position, azimuth sampling
npm run bench:ray  # horizon ray-sampling study
```

Latest run: 15 Nov 2026, planning window 1 Jan – 30 Jun 2027.

---

## 1. Against JPL Horizons (solid)

Twelve epochs, Horizons API.

### 1a. Geometry — Sun and Earth directions from the Moon

| Quantity | Max difference |
|---|---|
| Sun direction | **21.0″** (0.0058°) |
| Earth direction | **22.7″** (0.0063°) |

Aberration-scale. Two orders of magnitude below the 80 m terrain resolution.

### 1b. Frame — the lunar body-fixed frame itself

Horizons sub-observer and sub-solar lon/lat (quantities 14, 15), which depend on the IAU
rotation model:

| Quantity | Max difference |
|---|---|
| Sub-Earth longitude | **0.0079°** |
| Sub-Earth latitude | **0.0020°** |
| Sub-solar longitude | **0.0032°** |
| Sub-solar latitude | **0.0021°** |

### What this caught

An earlier version used only the polynomial prime meridian
(`W = 38.3213 + 13.17635815 d`), dropping the periodic libration terms. That was
**2.24° off in longitude**, drifting ~0.6°/year, while latitude matched perfectly.
Switching to Astronomy Engine's full IAU `spin` closed it to 0.003°.

---

## 2. Solar disc, position, azimuth sampling

| Effect | Result |
|---|---|
| Finite solar disc (0.266°) vs centre-of-disc | **≤ 0.40%** |
| Landing point moved ±250 m, horizon held fixed | **σ 0.04%** |
| Horizon sampled every 4° instead of 1° | **≤ 1.02%** |

All small. None of them is the dominant uncertainty.

---

## 3. The dominant uncertainty: horizon ray sampling

This is the important one, and it is **not yet resolved**.

Same coordinate (peak near Shackleton, 89.438°S 222.717°E), same 64 km range, same
curvature correction. Only the distance between ray samples changes:

| Terrain product | Step | Step/pixel | Mean horizon | Illumination |
|---|---|---|---|---|
| 80 m | 80 m | 1 px | −1.05° | **54.2%** |
| 80 m | 160 m | 2 px | −1.74° | **86.4%** |
| 80 m | 320 m | 4 px | −2.24° | **93.3%** |
| 40 m | 80 m | 2 px | −0.44° | **36.8%** |
| 40 m | 160 m | 4 px | −1.50° | **76.8%** |
| 40 m | 320 m | 8 px | −2.10° | **92.7%** |
| 20 m | 80 m | 4 px | −0.71° | **48.2%** |
| 20 m | 160 m | 8 px | −1.68° | **85.9%** |
| 20 m | 320 m | 16 px | −2.19° | **94.4%** |

**Illumination at one point spans 37–94% depending only on sampling.** A naive
nearest-neighbour max-slope march is therefore not a well-posed estimator: coarse
sampling steps over near-field ridges and inflates sunlight.

### Convergence test (bilinear sampling, 80 m DEM)

| Step | Mean horizon | Illumination |
|---|---|---|
| 80 m | −1.16° | 60.0% |
| 40 m | −1.10° | 58.6% |
| 20 m | −1.05° | 57.1% |
| 10 m | −0.99° | 54.1% |

With interpolation the sequence is converging downward, apparently toward ~52–55%,
not 86%.

### What this means — stated plainly

- The shipped app uses **nearest-neighbour at 2-pixel steps**, which gives **86.4%**.
  That value is reproducible, matches the published 80–86% range for the best
  south-pole points, and is what the submission quotes.
- A **converged bilinear** computation at the same coordinate gives **~55%**.
- These are not reconcilable as the same quantity. The difference is the horizon
  estimator, not the ephemeris (which is verified to 0.003°).

Possible explanations, none yet eliminated:

1. Published figures may describe **any part of the solar disc visible** rather than
   the disc centre; at these elevations a 0.27° limb allowance is worth tens of percent.
2. Published figures select the **best point** found by exhaustive search on a
   high-resolution DEM; our coordinate was chosen at 80 m and may be tens of metres
   from the optimum.
3. The converged estimator may still be sampling near-field DEM noise that a real
   lander footprint would average over.

Until one of these is settled, the honest position is: **86% is a convention-dependent
point estimate, not a converged physical value.** The app should say so, and the next
piece of work is to decide the convention and apply it consistently.

---

## 4. What is not validated

- **No reproduction of a specific published illumination figure.** Without the paper's
  exact coordinates and disc convention this cannot be done meaningfully.
- **No thermal, dust or power-system model.** Array output is first-order.
- **Horizon estimator is the open problem** (section 3).
- **Physical libration** enters only through the IAU series.
- **Sub-pixel terrain structure** below the DEM resolution is not resolved.
